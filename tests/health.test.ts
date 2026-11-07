import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { initializeAdmin } from "../src/initialize-admin.js";
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

test("真实数据库故障返回统一 500，响应和日志均不包含敏感错误内容", async (context) => {
  const password = "error-log-test-only-password";
  await initializeAdmin(database, "error-test-admin", password);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "error-test-admin", password }),
  });
  assert.equal(login.status, 200);
  const token = (await login.json()).data.accessToken;
  const secret = `${password}:${token}`;
  // 模拟底层异常带入敏感数据；请求必须真正经过业务路由和全局错误处理。
  database.exec(
    `CREATE TRIGGER fail_airline_insert BEFORE INSERT ON airlines BEGIN SELECT RAISE(ABORT, '${secret}'); END`,
  );
  const logs: string[] = [];
  context.mock.method(console, "error", (...args: unknown[]) =>
    logs.push(args.join(" ")),
  );
  try {
    const response = await fetch(`${baseUrl}/api/system-management/airlines`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: "日志验收航线",
        speed: 10,
        waypoints: [
          { longitude: 120, latitude: 30, altitude: 0 },
          { longitude: 121, latitude: 30, altitude: 0 },
        ],
      }),
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      code: 50000,
      message: "服务器内部错误",
      data: null,
    });
    assert.equal(logs.length, 1);
    assert.ok(
      logs.every((line) => !line.includes(password) && !line.includes(token)),
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS total FROM airlines").get()?.total,
      0,
    );
  } finally {
    database.exec("DROP TRIGGER fail_airline_insert");
  }
});
