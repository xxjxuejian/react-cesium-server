import { app } from "./app.js";
import { checkDatabaseReady } from "./db.js";

// NodeNext 下源码也写 .js：编译后 Node.js 会加载 dist/app.js。
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT 必须是 1～65535 之间的整数");
}

// 在监听端口之前检查数据库。检查完成后会关闭这次只读连接。
try {
  checkDatabaseReady();
} catch (error) {
  console.error("数据库未就绪，请检查 DATABASE_PATH 并运行 pnpm db:migrate。");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const server = app.listen(port, host);
server.on("listening", () => {
  console.log(`后端已启动：http://${host}:${port}/api/health`);
});
server.on("error", (error) => {
  console.error("后端启动失败：", error.message);
  process.exitCode = 1;
});

// Ctrl+C 或部署停止信号到来时，先停止接收新连接，让已有请求结束。
function shutdown() {
  server.close((error) => {
    if (error) {
      console.error("关闭服务失败：", error.message);
      process.exitCode = 1;
    }
  });
  // 避免未完成的连接让进程一直无法退出。
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
