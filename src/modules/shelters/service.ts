import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue, SQLOutputValue } from "node:sqlite";
import type { ShelterRecord, ShelterValues } from "./types.js";

/** 可直接展示给前端的场所业务错误。 */
export class ShelterError extends Error {
  /** HTTP 状态：400 参数错误，404 记录不存在。 */
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const facilityTypes = [
  "school",
  "stadium",
  "park",
  "communityCenter",
  "undergroundSpace",
  "other",
];
const usages = [
  "temporary",
  "longTerm",
  "medicalAid",
  "supplyDistribution",
  "comprehensive",
];
const statuses = ["open", "full", "maintenance", "closed"];
const facilities = [
  "drinkingWater",
  "foodSupply",
  "medicalAid",
  "toilet",
  "powerSupply",
  "communication",
  "barrierFree",
  "parking",
  "warehouse",
];
const columns = `id, name, facility_type, shelter_usage, operation_status, capacity, available_capacity,
  facilities_json, address, longitude, latitude, height, management_unit, contact_name, contact_phone, description,
  strftime('%Y-%m-%d %H:%M:%S', created_at, '+8 hours') AS createdAt,
  strftime('%Y-%m-%d %H:%M:%S', updated_at, '+8 hours') AS updatedAt`;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ShelterError(400, `${label}必须是对象`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, maximum: number) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maximum
  )
    throw new ShelterError(400, `${label}须为 1～${maximum} 个字符`);
  return value.trim();
}
function choice(value: unknown, options: string[], label: string) {
  if (typeof value !== "string" || !options.includes(value))
    throw new ShelterError(400, `${label}取值不正确`);
  return value;
}
function number(value: unknown, label: string) {
  // 不调用 Number(value)，避免 null、空白文本被转为合法的零坐标或零容量。
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new ShelterError(400, `${label}必须是有限数值`);
  return value;
}
export function validateShelter(input: unknown): ShelterValues {
  const body = object(input, "场所资料");
  const location = object(body.location, "位置");
  const capacity = number(body.capacity, "总容量");
  const availableCapacity = number(body.availableCapacity, "可用容量");
  if (
    !Number.isSafeInteger(capacity) ||
    capacity < 0 ||
    !Number.isSafeInteger(availableCapacity) ||
    availableCapacity < 0 ||
    availableCapacity > capacity
  )
    throw new ShelterError(
      400,
      "容量必须是非负安全整数，且可用容量不能大于总容量",
    );
  const longitude = number(location.longitude, "经度");
  const latitude = number(location.latitude, "纬度");
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90)
    throw new ShelterError(400, "经度须在 -180～180，纬度须在 -90～90 之间");
  const height =
    location.height == null ? undefined : number(location.height, "高度");
  if (
    !Array.isArray(body.facilities) ||
    body.facilities.length > facilities.length ||
    body.facilities.some(
      (item) => typeof item !== "string" || !facilities.includes(item),
    ) ||
    new Set(body.facilities).size !== body.facilities.length
  )
    throw new ShelterError(400, "设施能力须为不重复的合法编码数组");
  const contactPhone = text(body.contactPhone, "联系电话", 11);
  if (!/^1\d{10}$/.test(contactPhone))
    throw new ShelterError(400, "请输入 11 位手机号码");
  let description: string | undefined;
  if (body.description != null) {
    if (
      typeof body.description !== "string" ||
      body.description.trim().length > 2000
    )
      throw new ShelterError(400, "备注须为不超过 2000 个字符的文本");
    description = body.description.trim() || undefined;
  }
  return {
    name: text(body.name, "场所名称", 100),
    facilityType: choice(body.facilityType, facilityTypes, "场所形态"),
    shelterUsage: choice(body.shelterUsage, usages, "应急用途"),
    operationStatus: choice(body.operationStatus, statuses, "运营状态"),
    capacity,
    availableCapacity,
    facilities: [...body.facilities],
    address: text(body.address, "地址", 500),
    location: {
      longitude,
      latitude,
      ...(height === undefined ? {} : { height }),
    },
    managementUnit: text(body.managementUnit, "管理单位", 100),
    contactName: text(body.contactName, "联系人", 64),
    contactPhone,
    ...(description === undefined ? {} : { description }),
  };
}

function toShelter(row: Record<string, SQLOutputValue>): ShelterRecord {
  // SQL 列转换成页面已使用的 location 对象；NULL 的可选字段按契约省略。
  return {
    id: String(row.id),
    name: String(row.name),
    facilityType: String(row.facility_type),
    shelterUsage: String(row.shelter_usage),
    operationStatus: String(row.operation_status),
    capacity: Number(row.capacity),
    availableCapacity: Number(row.available_capacity),
    facilities: JSON.parse(String(row.facilities_json)) as string[],
    address: String(row.address),
    location: {
      longitude: Number(row.longitude),
      latitude: Number(row.latitude),
      ...(row.height === null ? {} : { height: Number(row.height) }),
    },
    managementUnit: String(row.management_unit),
    contactName: String(row.contact_name),
    contactPhone: String(row.contact_phone),
    ...(row.description === null
      ? {}
      : { description: String(row.description) }),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}
export function getShelter(database: DatabaseSync, id: string) {
  const row = database
    .prepare(`SELECT ${columns} FROM shelters WHERE id=?`)
    .get(id);
  if (!row) throw new ShelterError(404, "避难场所不存在");
  return toShelter(row);
}

export function listShelters(
  database: DatabaseSync,
  query: Record<string, unknown>,
) {
  const pageText = query.page ?? "1";
  const sizeText = query.pageSize ?? "10";
  if (
    typeof pageText !== "string" ||
    !/^[1-9]\d*$/.test(pageText) ||
    typeof sizeText !== "string" ||
    !/^[1-9]\d*$/.test(sizeText)
  )
    throw new ShelterError(400, "分页参数必须为正整数");
  const page = Number(pageText),
    pageSize = Number(sizeText);
  if (
    !Number.isSafeInteger(page) ||
    pageSize > 100 ||
    !Number.isSafeInteger((page - 1) * pageSize)
  )
    throw new ShelterError(400, "分页参数超出范围，每页最多 100 条");
  const conditions: string[] = [];
  const parameters: SQLInputValue[] = [];
  for (const [field, column] of [
    ["name", "name"],
    ["managementUnit", "management_unit"],
    ["address", "address"],
  ]) {
    const value = query[field];
    if (value === undefined || value === "") continue;
    if (typeof value === "string" && !value.trim()) continue;
    const keyword = text(value, "筛选条件", field === "address" ? 500 : 100);
    conditions.push(`instr(lower(${column}), lower(?)) > 0`);
    parameters.push(keyword);
  }
  for (const [field, column, options] of [
    ["facilityType", "facility_type", facilityTypes],
    ["shelterUsage", "shelter_usage", usages],
    ["operationStatus", "operation_status", statuses],
  ] as const) {
    if (query[field] === undefined || query[field] === "") continue;
    conditions.push(`${column}=?`);
    parameters.push(choice(query[field], options, "筛选条件"));
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = Number(
    database
      .prepare(`SELECT count(*) AS total FROM shelters ${where}`)
      .get(...parameters)?.total,
  );
  const list = database
    .prepare(
      `SELECT ${columns} FROM shelters ${where} ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?`,
    )
    .all(...parameters, pageSize, (page - 1) * pageSize)
    .map(toShelter);
  return { list, total };
}

// 新增与更新都显式展开白名单字段。单条 SQL 同时写入资料、设施和位置，不会留下半份记录。
function parameters(values: ShelterValues): SQLInputValue[] {
  return [
    values.name,
    values.facilityType,
    values.shelterUsage,
    values.operationStatus,
    values.capacity,
    values.availableCapacity,
    JSON.stringify(values.facilities),
    values.address,
    values.location.longitude,
    values.location.latitude,
    values.location.height ?? null,
    values.managementUnit,
    values.contactName,
    values.contactPhone,
    values.description ?? null,
  ];
}
export function createShelter(database: DatabaseSync, input: unknown) {
  const values = validateShelter(input),
    id = randomUUID(),
    now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO shelters (name,facility_type,shelter_usage,operation_status,capacity,available_capacity,facilities_json,address,longitude,latitude,height,management_unit,contact_name,contact_phone,description,id,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(...parameters(values), id, now, now);
  return getShelter(database, id);
}
export function updateShelter(
  database: DatabaseSync,
  id: string,
  input: unknown,
) {
  getShelter(database, id);
  const values = validateShelter(input);
  database
    .prepare(
      `UPDATE shelters SET name=?,facility_type=?,shelter_usage=?,operation_status=?,capacity=?,available_capacity=?,facilities_json=?,address=?,longitude=?,latitude=?,height=?,management_unit=?,contact_name=?,contact_phone=?,description=?,updated_at=? WHERE id=?`,
    )
    .run(...parameters(values), new Date().toISOString(), id);
  return getShelter(database, id);
}
export function deleteShelter(database: DatabaseSync, id: string) {
  const result = database.prepare("DELETE FROM shelters WHERE id=?").run(id);
  if (Number(result.changes) === 0)
    throw new ShelterError(404, "避难场所不存在");
  return true;
}
