import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import { createApp } from "../src/app.js";
import { requireAdmin, requireLogin } from "../src/auth.js";
import { applyMigrations, openDatabase } from "../src/db.js";
import { initializeAdmin } from "../src/initialize-admin.js";

test("真实会话支持登录、恢复、角色校验、过期、停用和撤销", async () => {
  const database = openDatabase(":memory:");
  const app = express();
  const password = "auth-test-only-password";
  const login = (url: string, username: string, enteredPassword = password) =>
    fetch(`${url}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: enteredPassword }),
    });

  applyMigrations(database);
  await initializeAdmin(database, "admin", password);
  // 复制测试账号的密码哈希来创建 viewer，实际环境由用户管理创建账号。
  database.exec(`
    INSERT INTO users (id, username, password_hash, nickname, role, created_at, updated_at)
    SELECT 'viewer-id', 'viewer', password_hash, '访客', 'viewer', created_at, updated_at
    FROM users WHERE username = 'admin'
  `);
  app.get("/test/admin", requireLogin(database), requireAdmin, (_request, response) => {
    response.sendStatus(204);
  });
  app.use(createApp(database));
  const server = app.listen(0, "127.0.0.1");

  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
    const session = (token: string) => fetch(`${url}/api/auth/session`, auth(token));
    assert.equal((await fetch(`${url}/test/admin`)).status, 401);

    const wrongPassword = await login(url, "admin", "wrong");
    const unknownUser = await login(url, "unknown");
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownUser.status, 401);
    assert.deepEqual(await wrongPassword.json(), await unknownUser.json());

    const adminResponse = await login(url, "admin");
    assert.equal(adminResponse.status, 200);
    assert.equal(adminResponse.headers.get("Cache-Control"), "no-store");
    const admin = (await adminResponse.json()).data;
    assert.equal(admin.user.role, "admin");
    assert.equal(admin.user.password_hash, undefined);
    assert.ok(admin.routes.some((route: { path: string }) => route.path === "home"));
    assert.ok(admin.routes.some((route: { path: string }) => route.path === "system-management"));
    assert.equal((await fetch(`${url}/test/admin`, auth(admin.accessToken))).status, 204);

    const stored = database.prepare("SELECT token_hash, expires_at, created_at FROM sessions").get();
    assert.equal(stored?.token_hash, createHash("sha256").update(admin.accessToken).digest("hex"));
    assert.notEqual(stored?.token_hash, admin.accessToken);
    assert.equal(Date.parse(String(stored?.expires_at)) - Date.parse(String(stored?.created_at)), 8 * 3600_000);
    const restored = (await (await session(admin.accessToken)).json()).data;
    assert.deepEqual(restored, { user: admin.user, routes: admin.routes });

    const viewer = (await (await login(url, "viewer")).json()).data;
    assert.equal(viewer.user.role, "viewer");
    assert.ok(viewer.routes.every((route: { path: string }) => route.path !== "system-management"));
    assert.equal((await fetch(`${url}/test/admin`, auth(viewer.accessToken))).status, 403);
    database.exec("UPDATE users SET role = 'admin' WHERE username = 'viewer'");
    assert.equal((await fetch(`${url}/test/admin`, auth(viewer.accessToken))).status, 204);
    database.exec("UPDATE users SET status = 'disabled' WHERE username = 'viewer'");
    assert.equal((await session(viewer.accessToken)).status, 401);
    assert.equal((await login(url, "viewer")).status, 401);

    const logout = await fetch(`${url}/api/auth/logout`, { method: "POST", ...auth(admin.accessToken) });
    assert.equal((await logout.json()).data, true);
    assert.equal((await session(admin.accessToken)).status, 401);
    const renewed = (await (await login(url, "admin")).json()).data;
    assert.notEqual(renewed.accessToken, admin.accessToken);
    database.exec("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'");
    assert.equal((await session(renewed.accessToken)).status, 401);

    // 此前已经尝试六次。再用无效输入占满窗口，验证限流先于昂贵的密码计算。
    for (let i = 0; i < 6; i++) {
      assert.equal((await login(url, "")).status, 400);
    }
    const limited = await login(url, "admin");
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("Retry-After")) > 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  }
});
