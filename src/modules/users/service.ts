import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { UserValues } from "./types.js";

/** 预期的用户业务错误，由路由转换为 HTTP 错误。 */
export class UserError extends Error {
  /** HTTP 状态码：400 参数错误、404 不存在、409 业务冲突。 */
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// 明确列出返回字段，密码哈希与会话数据始终不参与序列化。
const columns = `id, username, nickname, status, gender, department, role, phone, email,
  strftime('%Y-%m-%d %H:%M:%S', created_at, '+8 hours') AS createdAt`;

export function readBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UserError(400, "请求体必须是用户资料对象");
  }
  return value as Record<string, unknown>;
}

function text(
  value: unknown,
  label: string,
  maximum: number,
  required = false,
) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") throw new UserError(400, `${label}必须是文本`);
  const result = value.trim();
  if ((required && !result) || result.length > maximum) {
    throw new UserError(
      400,
      `${label}长度须为${required ? " 1～" : " 0～"}${maximum} 个字符`,
    );
  }
  return result;
}

export function validateValues(input: unknown): UserValues {
  const body = readBody(input);
  const username = text(body.username, "用户名", 64, true);
  const nickname = text(body.nickname, "昵称", 64, true);
  const department = text(body.department, "部门", 100);
  const phone = text(body.phone, "手机号码", 11);
  const email = text(body.email, "邮箱", 254);
  if (body.status !== "enabled" && body.status !== "disabled")
    throw new UserError(400, "状态必须为 enabled 或 disabled");
  if (
    body.gender !== "male" &&
    body.gender !== "female" &&
    body.gender !== "unknown"
  )
    throw new UserError(400, "性别取值不正确");
  if (body.role !== "admin" && body.role !== "viewer")
    throw new UserError(400, "角色必须为 admin 或 viewer");
  if (phone && !/^1\d{10}$/.test(phone))
    throw new UserError(400, "请输入 11 位手机号码");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new UserError(400, "邮箱格式不正确");
  return {
    username,
    nickname,
    department,
    phone,
    email,
    status: body.status,
    gender: body.gender,
    role: body.role,
  };
}

export function validatePassword(value: unknown): string {
  // 密码中的空格也有意义，不调用 trim。
  if (typeof value !== "string" || value.length < 15 || value.length > 128)
    throw new UserError(400, "密码长度须为 15～128 个字符");
  return value;
}

export function getUser(database: DatabaseSync, id: string) {
  const user = database
    .prepare(`SELECT ${columns} FROM users WHERE id = ?`)
    .get(id);
  if (!user) throw new UserError(404, "用户不存在");
  return user;
}

export function listUsers(
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
    throw new UserError(400, "分页参数必须为正整数");
  const page = Number(pageText);
  const pageSize = Number(sizeText);
  if (
    !Number.isSafeInteger(page) ||
    pageSize > 100 ||
    !Number.isSafeInteger((page - 1) * pageSize)
  )
    throw new UserError(400, "分页参数超出范围，每页最多 100 条");
  const conditions: string[] = [];
  const parameters: SQLInputValue[] = [];
  for (const field of ["username", "nickname", "department", "phone"]) {
    if (query[field] === undefined) continue;
    const keyword = text(query[field], "筛选条件", 100);
    if (keyword) {
      // instr 按字面子串匹配，% 和 _ 不会变成 SQL 通配符；字段名仅来自固定白名单。
      conditions.push(`instr(lower(${field}), lower(?)) > 0`);
      parameters.push(keyword);
    }
  }
  if (query.status !== undefined && query.status !== "") {
    if (query.status !== "enabled" && query.status !== "disabled")
      throw new UserError(400, "筛选状态不正确");
    conditions.push("status = ?");
    parameters.push(query.status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = database
    .prepare(`SELECT count(*) AS total FROM users ${where}`)
    .get(...parameters)?.total;
  const list = database
    .prepare(
      `SELECT ${columns} FROM users ${where} ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?`,
    )
    .all(...parameters, pageSize, (page - 1) * pageSize);
  return { list, total: Number(total) };
}

function ensureUnique(database: DatabaseSync, username: string, id = "") {
  if (
    database
      .prepare("SELECT id FROM users WHERE username = ? AND id <> ?")
      .get(username, id)
  )
    throw new UserError(409, "用户名已存在");
}

function protectLastAdmin(
  database: DatabaseSync,
  id: string,
  next?: UserValues,
) {
  const current = getUser(database, id);
  if (
    current.role === "admin" &&
    current.status === "enabled" &&
    (next?.role !== "admin" || next.status !== "enabled")
  ) {
    const count = database
      .prepare(
        "SELECT count(*) AS total FROM users WHERE role = 'admin' AND status = 'enabled'",
      )
      .get();
    if (Number(count?.total) <= 1)
      throw new UserError(409, "不能删除、停用或降级最后一个启用的管理员");
  }
}

// 回调里只有同步 SQL，不能放 await。写锁保证检查与修改之间没有其他写入插队。
function writeTransaction(database: DatabaseSync, write: () => void) {
  database.exec("BEGIN IMMEDIATE");
  try {
    write();
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function createUser(
  database: DatabaseSync,
  values: UserValues,
  passwordHash: string,
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  writeTransaction(database, () => {
    ensureUnique(database, values.username);
    database
      .prepare(
        `INSERT INTO users (id, username, nickname, status, gender, department, role, phone, email, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        values.username,
        values.nickname,
        values.status,
        values.gender,
        values.department,
        values.role,
        values.phone,
        values.email,
        passwordHash,
        now,
        now,
      );
  });
  return getUser(database, id);
}

export function updateUser(
  database: DatabaseSync,
  id: string,
  values: UserValues,
) {
  writeTransaction(database, () => {
    protectLastAdmin(database, id, values);
    ensureUnique(database, values.username, id);
    database
      .prepare(
        `UPDATE users SET username=?, nickname=?, status=?, gender=?, department=?, role=?, phone=?, email=?, updated_at=? WHERE id=?`,
      )
      .run(
        values.username,
        values.nickname,
        values.status,
        values.gender,
        values.department,
        values.role,
        values.phone,
        values.email,
        new Date().toISOString(),
        id,
      );
    if (values.status === "disabled")
      database.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
  });
  return getUser(database, id);
}

export function deleteUser(database: DatabaseSync, id: string) {
  writeTransaction(database, () => {
    protectLastAdmin(database, id);
    // 外键的 ON DELETE CASCADE 会在同一事务中删除关联会话。
    database.prepare("DELETE FROM users WHERE id=?").run(id);
  });
  return true;
}

export function resetPassword(
  database: DatabaseSync,
  id: string,
  passwordHash: string,
) {
  writeTransaction(database, () => {
    getUser(database, id);
    database
      .prepare("UPDATE users SET password_hash=?, updated_at=? WHERE id=?")
      .run(passwordHash, new Date().toISOString(), id);
    database.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
  });
  return true;
}
