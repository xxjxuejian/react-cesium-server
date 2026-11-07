import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue, SQLOutputValue } from "node:sqlite";
import type {
  DefenseRing,
  DefenseRings,
  KeyUnitListItem,
  KeyUnitRecord,
  KeyUnitValues,
} from "./types.js";

/** 可以向前端展示的重点单位参数或记录错误。 */
export class KeyUnitError extends Error {
  /** HTTP 状态码：400 参数错误，404 记录不存在。 */
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const summaryColumns = `id, name, longitude, latitude, address, rings_json,
  strftime('%Y-%m-%d %H:%M:%S', updated_at, '+8 hours') AS updatedAt`;
const detailColumns = `${summaryColumns}, remark,
  strftime('%Y-%m-%d %H:%M:%S', created_at, '+8 hours') AS createdAt`;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new KeyUnitError(400, `${label}必须是对象`);
  return value as Record<string, unknown>;
}
function text(
  value: unknown,
  label: string,
  maximum: number,
  required = false,
) {
  if (
    typeof value !== "string" ||
    (required && !value.trim()) ||
    value.trim().length > maximum
  )
    throw new KeyUnitError(
      400,
      `${label}须为${required ? " 1～" : " 0～"}${maximum} 个字符的文本`,
    );
  return value.trim();
}
function finiteNumber(value: unknown, label: string) {
  // 保留零值，拒绝 null、字符串和缺失值，防止把尚未填写的参数保存为零。
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new KeyUnitError(400, `${label}必须是有限数值`);
  return value;
}
function readRing(input: unknown, label: string): DefenseRing {
  const ring = object(input, label);
  const radius = finiteNumber(ring.radius, `${label}半径`);
  const minHeight = finiteNumber(ring.minHeight, `${label}最低高度`);
  const maxHeight = finiteNumber(ring.maxHeight, `${label}最高高度`);
  if (radius <= 0) throw new KeyUnitError(400, `${label}半径必须大于 0`);
  if (minHeight < 0)
    throw new KeyUnitError(400, `${label}最低高度必须大于等于 0`);
  if (maxHeight <= minHeight)
    throw new KeyUnitError(400, `${label}最高高度必须大于最低高度`);
  // 只保留三个合法数值，忽略圈层中伪造的圆心、颜色或系统字段。
  return { radius, minHeight, maxHeight };
}
function checkContainment(
  inner: DefenseRing,
  outer: DefenseRing,
  innerLabel: string,
  outerLabel: string,
) {
  if (inner.radius >= outer.radius)
    throw new KeyUnitError(400, `${innerLabel}半径必须小于${outerLabel}半径`);
  if (inner.minHeight < outer.minHeight)
    throw new KeyUnitError(
      400,
      `${innerLabel}最低高度不能低于${outerLabel}最低高度`,
    );
  if (inner.maxHeight > outer.maxHeight)
    throw new KeyUnitError(
      400,
      `${innerLabel}最高高度不能超过${outerLabel}最高高度`,
    );
}
export function validateKeyUnit(input: unknown): KeyUnitValues {
  const body = object(input, "重点单位资料");
  const name = text(body.name, "单位名称", 100, true);
  const longitude = finiteNumber(body.longitude, "中心经度");
  const latitude = finiteNumber(body.latitude, "中心纬度");
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90)
    throw new KeyUnitError(
      400,
      "中心经度须在 -180～180，纬度须在 -90～90 之间",
    );
  const address = text(body.address, "位置描述", 500);
  const remark = text(body.remark, "备注", 2000);
  const rawRings = object(body.rings, "三层防御范围");
  if (
    Object.keys(rawRings).length !== 3 ||
    !["core", "counter", "warning"].every((key) => Object.hasOwn(rawRings, key))
  )
    throw new KeyUnitError(400, "仅允许核心圈、反制圈和警戒圈各一个");
  const rings: DefenseRings = {
    core: readRing(rawRings.core, "核心圈"),
    counter: readRing(rawRings.counter, "反制圈"),
    warning: readRing(rawRings.warning, "警戒圈"),
  };
  checkContainment(rings.core, rings.counter, "核心圈", "反制圈");
  checkContainment(rings.counter, rings.warning, "反制圈", "警戒圈");
  return { name, longitude, latitude, address, remark, rings };
}

function toSummary(row: Record<string, SQLOutputValue>): KeyUnitListItem {
  return {
    id: String(row.id),
    name: String(row.name),
    longitude: Number(row.longitude),
    latitude: Number(row.latitude),
    address: String(row.address),
    rings: JSON.parse(String(row.rings_json)) as DefenseRings,
    updatedAt: String(row.updatedAt),
  };
}
export function getKeyUnit(database: DatabaseSync, id: string): KeyUnitRecord {
  const row = database
    .prepare(`SELECT ${detailColumns} FROM key_units WHERE id=?`)
    .get(id);
  if (!row) throw new KeyUnitError(404, "重点单位不存在");
  return {
    ...toSummary(row),
    remark: String(row.remark),
    createdAt: String(row.createdAt),
  };
}
export function listKeyUnits(
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
    throw new KeyUnitError(400, "分页参数必须为正整数");
  const page = Number(pageText);
  const pageSize = Number(sizeText);
  if (
    !Number.isSafeInteger(page) ||
    pageSize > 100 ||
    !Number.isSafeInteger((page - 1) * pageSize)
  )
    throw new KeyUnitError(400, "分页参数超出范围，每页最多 100 条");
  if (
    query.name !== undefined &&
    (typeof query.name !== "string" || query.name.trim().length > 100)
  )
    throw new KeyUnitError(400, "名称筛选须为不超过 100 个字符的文本");
  const keyword = typeof query.name === "string" ? query.name.trim() : "";
  const where = keyword ? "WHERE instr(lower(name), lower(?)) > 0" : "";
  const parameters: SQLInputValue[] = keyword ? [keyword] : [];
  const total = Number(
    database
      .prepare(`SELECT count(*) AS total FROM key_units ${where}`)
      .get(...parameters)?.total,
  );
  // 列表沿用范围摘要，不读取备注及创建时间。
  const list = database
    .prepare(
      `SELECT ${summaryColumns} FROM key_units ${where} ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?`,
    )
    .all(...parameters, pageSize, (page - 1) * pageSize)
    .map(toSummary);
  return { list, total };
}
export function createKeyUnit(database: DatabaseSync, input: unknown) {
  const values = validateKeyUnit(input);
  const id = randomUUID();
  const now = new Date().toISOString();
  // 共同中心和完整三层参数一次写入；SQL 失败时整条记录不会保存。
  database
    .prepare(
      `INSERT INTO key_units (id,name,longitude,latitude,address,remark,rings_json,created_at,updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      values.name,
      values.longitude,
      values.latitude,
      values.address,
      values.remark,
      JSON.stringify(values.rings),
      now,
      now,
    );
  return getKeyUnit(database, id);
}
export function updateKeyUnit(
  database: DatabaseSync,
  id: string,
  input: unknown,
) {
  getKeyUnit(database, id);
  const values = validateKeyUnit(input);
  database
    .prepare(
      `UPDATE key_units SET name=?,longitude=?,latitude=?,address=?,remark=?,rings_json=?,updated_at=? WHERE id=?`,
    )
    .run(
      values.name,
      values.longitude,
      values.latitude,
      values.address,
      values.remark,
      JSON.stringify(values.rings),
      new Date().toISOString(),
      id,
    );
  return getKeyUnit(database, id);
}
export function deleteKeyUnit(database: DatabaseSync, id: string) {
  const result = database.prepare("DELETE FROM key_units WHERE id=?").run(id);
  if (Number(result.changes) === 0)
    throw new KeyUnitError(404, "重点单位不存在");
  return true;
}
