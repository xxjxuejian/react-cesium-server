import { restoreDatabase } from "../databaseBackup.js";

try {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination || process.argv.length !== 4) {
    throw new Error(
      "先停止后端，再运行：pnpm db:restore <备份文件路径> <新的数据库路径>",
    );
  }
  const path = await restoreDatabase(source, destination);
  console.log(`数据库恢复完成，完整性及外键检查通过：${path}`);
  console.log(
    "请将 DATABASE_PATH 指向恢复后的文件，执行迁移，再启动并核对业务数据。",
  );
  console.log("恢复库中的旧会话已清空，所有用户需要重新登录。");
} catch (error) {
  console.error(
    "数据库恢复失败：",
    error instanceof Error ? error.message : "未知错误",
  );
  process.exitCode = 1;
}
