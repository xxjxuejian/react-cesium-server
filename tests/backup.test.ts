import assert from "node:assert/strict";
import {
  mkdtempSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { copyDatabase, restoreDatabase } from "../src/databaseBackup.js";
import { applyMigrations, openDatabase } from "../src/db.js";
import { initializeAdmin } from "../src/initialize-admin.js";

test("在线备份包含 WAL 已提交数据，恢复保留账号和业务数据并撤销旧会话", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cesium-backup-"));
  const source = join(directory, "source.db");
  const snapshot = join(directory, "snapshot.db");
  const restored = join(directory, "restored.db");
  const database = openDatabase(source);
  try {
    applyMigrations(database);
    await initializeAdmin(
      database,
      "backup-admin",
      "backup-test-only-password",
    );
    database.exec("PRAGMA journal_mode = WAL");
    database.exec(`
      INSERT INTO sessions (id,user_id,token_hash,created_at,expires_at)
      SELECT 'test-session',id,'test-hash',created_at,'2099-01-01T00:00:00.000Z' FROM users;
      INSERT INTO airlines (id,name,waypoints_json,waypoint_count,length,speed,remark,created_at,updated_at)
      VALUES ('backup-airline','待恢复航线','[]',2,100,10,'恢复核对', '2026-01-01','2026-01-01');
    `);
    await copyDatabase(source, snapshot);
    // 备份后变更源库。恢复应得到备份时的数据，而不是源库当前的数据。
    database.exec("UPDATE airlines SET name = '备份后修改'");
    await restoreDatabase(snapshot, restored);
    const recovered = openDatabase(restored);
    const backupFile = openDatabase(snapshot);
    try {
      assert.equal(
        recovered.prepare("SELECT name FROM airlines").get()?.name,
        "待恢复航线",
      );
      assert.equal(
        recovered.prepare("SELECT username FROM users").get()?.username,
        "backup-admin",
      );
      assert.equal(
        recovered.prepare("SELECT COUNT(*) AS total FROM sessions").get()
          ?.total,
        0,
      );
      assert.equal(
        backupFile.prepare("SELECT COUNT(*) AS total FROM sessions").get()
          ?.total,
        1,
      );
      assert.equal(
        recovered
          .prepare("SELECT COUNT(*) AS total FROM schema_migrations")
          .get()?.total,
        4,
      );
      assert.equal(
        database.prepare("SELECT name FROM airlines").get()?.name,
        "备份后修改",
      );
    } finally {
      backupFile.close();
      recovered.close();
    }
  } finally {
    database.close();
    for (const filename of readdirSync(directory))
      unlinkSync(join(directory, filename));
    rmdirSync(directory);
  }
});

test("备份拒绝覆盖、同路径、缺失源、残留日志与损坏数据库", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cesium-backup-errors-"));
  const source = join(directory, "source.db");
  const destination = join(directory, "new.db");
  const database = openDatabase(source);
  database.exec("CREATE TABLE sample (id INTEGER)");
  database.close();
  try {
    writeFileSync(destination, "原文件不能覆盖");
    await assert.rejects(copyDatabase(source, destination), /已经存在/);
    assert.equal(readFileSync(destination, "utf8"), "原文件不能覆盖");
    await assert.rejects(copyDatabase(source, source), /不能相同/);
    unlinkSync(destination);
    await assert.rejects(
      copyDatabase(join(directory, "missing.db"), destination),
    );
    assert.equal(existsSync(destination), false);
    assert.equal(existsSync(join(directory, "missing.db")), false);
    writeFileSync(destination + "-wal", "旧日志");
    await assert.rejects(copyDatabase(source, destination), /日志已经存在/);
    assert.equal(existsSync(destination), false);
    unlinkSync(destination + "-wal");
    writeFileSync(join(directory, "corrupt.db"), "不是 SQLite 数据库");
    await assert.rejects(
      copyDatabase(join(directory, "corrupt.db"), destination),
    );
    assert.equal(existsSync(destination), false);
    // 不是本应用的数据库不能冒充恢复成功，也不能残留一个可被误用的恢复文件。
    await assert.rejects(restoreDatabase(source, destination));
    assert.equal(existsSync(destination), false);
  } finally {
    for (const filename of readdirSync(directory))
      unlinkSync(join(directory, filename));
    rmdirSync(directory);
  }
});
