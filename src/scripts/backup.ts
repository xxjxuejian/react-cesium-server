import { getDatabasePath } from "../db.js";
import { copyDatabase } from "../databaseBackup.js";

try {
  const destination = process.argv[2];
  if (!destination || process.argv.length !== 3) {
    throw new Error("用法：pnpm db:backup <新的备份文件路径>");
  }
  const path = await copyDatabase(getDatabasePath(), destination);
  console.log(`数据库备份完成，完整性及外键检查通过：${path}`);
} catch (error) {
  console.error(
    "数据库备份失败：",
    error instanceof Error ? error.message : "未知错误",
  );
  process.exitCode = 1;
}
