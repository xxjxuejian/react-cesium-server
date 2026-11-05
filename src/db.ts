import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

// src/db.ts 和 dist/db.js 都位于根目录下一层，因此开发和编译后使用同一路径。
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const migrationsDirectory = new URL("../migrations/", import.meta.url);

export function getDatabasePath() {
  return resolve(projectRoot, process.env.DATABASE_PATH?.trim() || "data/app.db");
}

export function openDatabase(databasePath = getDatabasePath()) {
  mkdirSync(dirname(databasePath), { recursive: true });
  return new DatabaseSync(databasePath, {
    enableForeignKeyConstraints: true,
    timeout: 5000,
  });
}

function getMigrationFiles() {
  const files = readdirSync(migrationsDirectory)
    .filter((filename) => /^\d{3}_.+\.sql$/.test(filename))
    .sort();
  if (files.length === 0) throw new Error("未找到数据库迁移文件");
  return files;
}

export function applyMigrations(database: DatabaseSync) {
  const files = getMigrationFiles();
  const appliedFiles: string[] = [];

  // 先获得写锁，再检查记录，避免两个迁移命令同时对同一数据库建表。
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT
    `);

    const findMigration = database.prepare(
      "SELECT filename FROM schema_migrations WHERE filename = ?",
    );
    const recordMigration = database.prepare(
      "INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)",
    );

    for (const filename of files) {
      if (findMigration.get(filename)) continue;
      // 只执行仓库随代码发布的 SQL 文件，不从 HTTP 请求读取 SQL。
      const sql = readFileSync(new URL(filename, migrationsDirectory), "utf8");
      database.exec(sql);
      recordMigration.run(filename, new Date().toISOString());
      appliedFiles.push(filename);
    }

    // 表结构和迁移记录一起提交。失败时，下次运行可重新应用整批迁移。
    database.exec("COMMIT");
    return appliedFiles;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function checkDatabaseReady(databasePath = getDatabasePath()) {
  // 只读检查不会创建空文件或执行迁移。建表由管理员显式运行命令。
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const migration = database.prepare(
      "SELECT filename FROM schema_migrations WHERE filename = ?",
    );
    for (const filename of getMigrationFiles()) {
      if (!migration.get(filename)) throw new Error(`缺少迁移：${filename}`);
    }
  } finally {
    database.close();
  }
}
