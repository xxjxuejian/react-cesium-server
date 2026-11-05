import { applyMigrations, getDatabasePath, openDatabase } from "../db.js";

try {
  const database = openDatabase();
  try {
    const appliedFiles = applyMigrations(database);
    console.log(
      appliedFiles.length
        ? `已应用迁移：${appliedFiles.join("、")}`
        : "数据库已经是最新结构。",
    );
    console.log(`数据库文件：${getDatabasePath()}`);
  } finally {
    database.close();
  }
} catch (error) {
  console.error("数据库迁移失败：", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
