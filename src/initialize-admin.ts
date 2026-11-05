import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { hashPassword } from "./password.js";

export async function initializeAdmin(
  database: DatabaseSync,
  username: string,
  password: string | undefined,
) {
  if (database.prepare("SELECT id FROM users WHERE role = 'admin'").get()) {
    return false;
  }
  if (username.length === 0 || username.length > 64) {
    throw new Error("管理员用户名长度须为 1～64 个字符");
  }
  if (!password || password.length < 15 || password.length > 128) {
    throw new Error("请设置 15～128 个字符的 ADMIN_PASSWORD");
  }

  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();

  // 哈希期间可能有另一个初始化命令运行。写入时再判断，保证不会创建第二个初始管理员。
  // 问号是参数占位符，用户名与密码哈希作为数据传入，不会被当作 SQL 执行。
  const result = database.prepare(`
    INSERT INTO users (id, username, password_hash, nickname, role, created_at, updated_at)
    SELECT ?, ?, ?, ?, 'admin', ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')
    ON CONFLICT(username) DO NOTHING
  `).run(randomUUID(), username, passwordHash, "系统管理员", now, now);

  if (Number(result.changes) > 0) return true;
  if (database.prepare("SELECT id FROM users WHERE role = 'admin'").get()) {
    return false;
  }
  throw new Error("管理员用户名已被占用，请更换 ADMIN_USERNAME");
}
