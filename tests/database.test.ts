import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  applyMigrations,
  checkDatabaseReady,
  openDatabase,
} from "../src/db.js";
import { initializeAdmin } from "../src/initialize-admin.js";
import { hashPassword, verifyPassword } from "../src/password.js";

test("迁移和初始化可重复执行，重开数据库后账号仍可校验", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "cesium-db-"));
  const path = join(directory, "test.db");
  context.after(() => {
    if (existsSync(path)) unlinkSync(path);
    rmdirSync(directory);
  });
  const password = "stage-one-test-password";
  assert.throws(() => checkDatabaseReady(path));

  const database = openDatabase(path);
  try {
    assert.deepEqual(applyMigrations(database), [
      "001_create_users_and_sessions.sql",
      "002_create_shelters.sql",
      "003_create_airlines.sql",
    ]);
    assert.deepEqual(applyMigrations(database), []);
    await assert.rejects(
      initializeAdmin(database, "admin", undefined),
      /ADMIN_PASSWORD/,
    );
    assert.equal(await initializeAdmin(database, "admin", password), true);
    assert.equal(
      await initializeAdmin(database, "other", "new-test-password"),
      false,
    );

    const insertSession = database.prepare(
      "INSERT INTO sessions VALUES (?, ?, ?, ?, ?)",
    );
    assert.throws(
      () => insertSession.run("s1", "missing", "hash", "expires", "created"),
      /FOREIGN KEY/,
    );

    const insertDuplicateUser = database.prepare(`
      INSERT INTO users (id, username, password_hash, nickname, role, created_at, updated_at)
      SELECT 'duplicate', username, password_hash, nickname, role, created_at, updated_at
      FROM users
      WHERE username = ?
    `);
    assert.throws(() => insertDuplicateUser.run("admin"), /UNIQUE/);
  } finally {
    database.close();
  }

  checkDatabaseReady(path);
  const reopened = openDatabase(path);
  try {
    const users = reopened
      .prepare("SELECT username, password_hash, role FROM users")
      .all();
    assert.equal(users.length, 1);
    assert.equal(users[0].username, "admin");
    assert.equal(users[0].role, "admin");
    const stored = users[0].password_hash;
    assert.equal(typeof stored, "string");
    assert.notEqual(stored, password);
    assert.equal(await verifyPassword(password, String(stored)), true);
    assert.equal(await verifyPassword("wrong-password", String(stored)), false);
    assert.notEqual(await hashPassword(password), stored);
    assert.equal(await verifyPassword(password, "invalid-record"), false);
  } finally {
    reopened.close();
  }
});

test("迁移中途遇到冲突时回滚建表和迁移记录", () => {
  const database = openDatabase(":memory:");
  try {
    // 预先创建同名表，让迁移在创建 users 之后失败。
    database.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY)");
    assert.throws(() => applyMigrations(database), /sessions already exists/);
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
      )
      .all();
    assert.deepEqual(
      tables.map((table) => table.name),
      ["sessions"],
    );
    database.exec("DROP TABLE sessions");
    assert.equal(applyMigrations(database).length, 3);
  } finally {
    database.close();
  }
});
