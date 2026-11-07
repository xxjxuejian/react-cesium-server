import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue, SQLOutputValue } from "node:sqlite";
import type {
  AirlineListItem,
  AirlineRecord,
  AirlineValues,
  AirlineWaypoint,
} from "./types.js";

/** 可直接向调用方解释的航线业务错误。 */
export class AirlineError extends Error {
  /** 400 表示参数错误，404 表示航线不存在。 */
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const summaryColumns = `id, name, speed, waypoint_count, length,
  strftime('%Y-%m-%d %H:%M:%S', updated_at, '+8 hours') AS updatedAt`;
const detailColumns = `${summaryColumns}, remark, waypoints_json,
  strftime('%Y-%m-%d %H:%M:%S', created_at, '+8 hours') AS createdAt`;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AirlineError(400, `${label}必须是对象`);
  return value as Record<string, unknown>;
}
function finiteNumber(value: unknown, label: string) {
  // 不做隐式数值转换，null 和空字符串不能被当成零坐标或零高度。
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new AirlineError(400, `${label}必须是有限数值`);
  return value;
}

export function validateAirline(input: unknown): AirlineValues {
  const body = object(input, "航线资料");
  if (
    typeof body.name !== "string" ||
    !body.name.trim() ||
    body.name.trim().length > 100
  )
    throw new AirlineError(400, "航线名称须为 1～100 个字符");
  const speed = finiteNumber(body.speed, "飞行速度");
  if (speed <= 0) throw new AirlineError(400, "飞行速度必须大于 0");
  if (
    body.remark !== undefined &&
    (typeof body.remark !== "string" || body.remark.length > 2000)
  )
    throw new AirlineError(400, "备注必须是不超过 2000 个字符的字符串");
  if (
    !Array.isArray(body.waypoints) ||
    body.waypoints.length < 2 ||
    body.waypoints.length > 1000
  )
    throw new AirlineError(400, "航线须包含 2～1000 个航点");
  const waypoints: AirlineWaypoint[] = [];
  for (let index = 0; index < body.waypoints.length; index += 1) {
    const label = `第 ${index + 1} 个航点`;
    const point = object(body.waypoints[index], label);
    const longitude = finiteNumber(point.longitude, `${label}经度`);
    const latitude = finiteNumber(point.latitude, `${label}纬度`);
    const altitude = finiteNumber(point.altitude, `${label}高度`);
    if (longitude < -180 || longitude > 180)
      throw new AirlineError(400, `${label}经度必须在 -180～180 度之间`);
    if (latitude < -90 || latitude > 90)
      throw new AirlineError(400, `${label}纬度必须在 -90～90 度之间`);
    if (altitude < 0) throw new AirlineError(400, `${label}高度必须大于等于 0`);
    const previous = waypoints[index - 1];
    if (
      previous &&
      previous.longitude === longitude &&
      previous.latitude === latitude &&
      previous.altitude === altitude
    )
      throw new AirlineError(400, `${label}与前一个航点的位置和高度完全相同`);
    // 显式组装资料，忽略请求带来的 order、时间、长度等系统字段。
    waypoints.push({ longitude, latitude, altitude, order: index + 1 });
  }
  return {
    name: body.name.trim(),
    speed,
    remark: body.remark === undefined ? "" : (body.remark as string),
    waypoints,
  };
}

/** 使用平均地球半径计算水平长度，不叠加高度、不自动连接终点和起点。 */
export function calculateAirlineLength(waypoints: AirlineWaypoint[]) {
  const earthRadius = 6371008.8;
  const degreesToRadians = Math.PI / 180;
  let length = 0;
  for (let index = 1; index < waypoints.length; index += 1) {
    const previous = waypoints[index - 1];
    const current = waypoints[index];
    const previousLatitude = previous.latitude * degreesToRadians;
    const currentLatitude = current.latitude * degreesToRadians;
    const latitudeDifference = currentLatitude - previousLatitude;
    const longitudeDifference =
      (current.longitude - previous.longitude) * degreesToRadians;
    const haversine =
      Math.sin(latitudeDifference / 2) ** 2 +
      Math.cos(previousLatitude) *
        Math.cos(currentLatitude) *
        Math.sin(longitudeDifference / 2) ** 2;
    // 浮点误差可能略超出 [0,1]，限定范围后再计算反三角函数，避免 NaN。
    const centralAngle =
      2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
    length += earthRadius * centralAngle;
  }
  return length;
}

function toSummary(row: Record<string, SQLOutputValue>): AirlineListItem {
  return {
    id: String(row.id),
    name: String(row.name),
    waypointCount: Number(row.waypoint_count),
    length: Number(row.length),
    speed: Number(row.speed),
    updatedAt: String(row.updatedAt),
  };
}
export function getAirline(database: DatabaseSync, id: string): AirlineRecord {
  const row = database
    .prepare(`SELECT ${detailColumns} FROM airlines WHERE id=?`)
    .get(id);
  if (!row) throw new AirlineError(404, "航线不存在");
  return {
    ...toSummary(row),
    remark: String(row.remark),
    createdAt: String(row.createdAt),
    waypoints: JSON.parse(String(row.waypoints_json)) as AirlineWaypoint[],
  };
}
export function listAirlines(
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
    throw new AirlineError(400, "分页参数必须是正整数");
  const page = Number(pageText);
  const pageSize = Number(sizeText);
  if (
    !Number.isSafeInteger(page) ||
    pageSize > 100 ||
    !Number.isSafeInteger((page - 1) * pageSize)
  )
    throw new AirlineError(400, "分页参数超出范围，每页最多 100 条");
  if (
    query.name !== undefined &&
    (typeof query.name !== "string" || query.name.trim().length > 100)
  )
    throw new AirlineError(400, "航线名称筛选须为不超过 100 个字符的字符串");
  const keyword = typeof query.name === "string" ? query.name.trim() : "";
  // instr 按普通文本查找，% 和 _ 不会变为 SQL 通配符。
  const where = keyword ? "WHERE instr(lower(name), lower(?)) > 0" : "";
  const parameters: SQLInputValue[] = keyword ? [keyword] : [];
  const total = Number(
    database
      .prepare(`SELECT count(*) AS total FROM airlines ${where}`)
      .get(...parameters)?.total,
  );
  // SQL 本身只读取摘要，不读航点 JSON 和备注。
  const list = database
    .prepare(
      `SELECT ${summaryColumns} FROM airlines ${where} ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?`,
    )
    .all(...parameters, pageSize, (page - 1) * pageSize)
    .map(toSummary);
  return { list, total };
}
export function createAirline(database: DatabaseSync, input: unknown) {
  const values = validateAirline(input);
  const id = randomUUID();
  const now = new Date().toISOString();
  const length = calculateAirlineLength(values.waypoints);
  // 一条 INSERT 同时保存完整航点与计算摘要，数据库异常时整条写入失败。
  database
    .prepare(
      `INSERT INTO airlines (id,name,speed,remark,waypoints_json,waypoint_count,length,created_at,updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      values.name,
      values.speed,
      values.remark,
      JSON.stringify(values.waypoints),
      values.waypoints.length,
      length,
      now,
      now,
    );
  return getAirline(database, id);
}
export function updateAirline(
  database: DatabaseSync,
  id: string,
  input: unknown,
) {
  getAirline(database, id);
  const values = validateAirline(input);
  const length = calculateAirlineLength(values.waypoints);
  database
    .prepare(
      `UPDATE airlines SET name=?,speed=?,remark=?,waypoints_json=?,waypoint_count=?,length=?,updated_at=? WHERE id=?`,
    )
    .run(
      values.name,
      values.speed,
      values.remark,
      JSON.stringify(values.waypoints),
      values.waypoints.length,
      length,
      new Date().toISOString(),
      id,
    );
  return getAirline(database, id);
}
export function deleteAirline(database: DatabaseSync, id: string) {
  const result = database.prepare("DELETE FROM airlines WHERE id=?").run(id);
  if (Number(result.changes) === 0) throw new AirlineError(404, "航线不存在");
  return true;
}
