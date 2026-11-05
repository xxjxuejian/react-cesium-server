import { checkDatabaseReady, openDatabase } from "../db.js";
import { initializeAdmin } from "../initialize-admin.js";

try {
  checkDatabaseReady();
  const database = openDatabase();
  try {
    const username = process.env.ADMIN_USERNAME?.trim() || "admin";
    const created = await initializeAdmin(database, username, process.env.ADMIN_PASSWORD);
    console.log(created ? `已初始化管理员：${username}` : "管理员已存在，跳过初始化。");
  } finally {
    database.close();
  }
} catch (error) {
  console.error("管理员初始化失败：", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
