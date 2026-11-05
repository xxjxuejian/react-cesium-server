import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { createApp } from "../src/app.js";
import { applyMigrations, openDatabase } from "../src/db.js";

const database = openDatabase(":memory:");
applyMigrations(database);
const app = createApp(database);

// 使用随机空闲端口，避免测试占用平时开发使用的 3000 端口。
const server = app.listen(0, "127.0.0.1");
let baseUrl = "";
before(async () => {
  if (!server.listening) await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  database.close();
});

test("健康检查返回约定的成功结构", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    code: 0,
    message: "服务运行正常",
    data: { status: "ok", service: "react-cesium-server" },
  });
});
test("未知接口返回 JSON 404", async () => {
  const response = await fetch(`${baseUrl}/api/not-found`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    code: 40400,
    message: "接口不存在",
    data: null,
  });
});
test("损坏的 JSON 返回 400，不泄漏解析堆栈", async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    code: 40000,
    message: "请求体必须是合法的 JSON",
    data: null,
  });
});
test("超过请求体限制时返回 413", async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "a".repeat(1024 * 1024) }),
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, 41300);
});
