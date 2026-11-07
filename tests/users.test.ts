import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { applyMigrations, openDatabase } from "../src/db.js";
import { initializeAdmin } from "../src/initialize-admin.js";
import {
  resetPassword,
  updateUser,
  deleteUser,
} from "../src/modules/users/service.js";
import { hashPassword, verifyPassword } from "../src/password.js";

const password = "stage-three-test-password";
const profile = {
  username: "learner",
  nickname: "学习账号",
  role: "viewer",
  status: "enabled",
  gender: "unknown",
  department: "平台研发部",
  phone: "13800000001",
  email: "learn@example.com",
};

async function fixture() {
  const database = openDatabase(":memory:");
  applyMigrations(database);
  await initializeAdmin(database, "admin", password);
  const server = createApp(database).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  async function request(
    path: string,
    method = "GET",
    token?: string,
    body?: unknown,
  ) {
    const response = await fetch(`${url}/api${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, ...(await response.json()) };
  }
  const admin = (
    await request("/auth/login", "POST", undefined, {
      username: "admin",
      password,
    })
  ).data;
  return {
    database,
    request,
    admin,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      database.close();
    },
  };
}

test("用户 CRUD 只向管理员开放，支持全部筛选、分页和字段白名单", async () => {
  const f = await fixture();
  try {
    const { request, admin } = f;
    const base = "/system-management/users";
    assert.equal((await request(base)).status, 401);
    for (const body of [
      null,
      [],
      {},
      { ...profile, role: "超级管理员", password },
      { ...profile, password: "short" },
      { ...profile, phone: "123", password },
    ]) {
      assert.equal(
        (await request(base, "POST", admin.accessToken, body)).status,
        400,
      );
    }
    const created = await request(base, "POST", admin.accessToken, {
      ...profile,
      password,
      id: "forged",
      createdAt: "fake",
      password_hash: "fake",
    });
    assert.equal(created.status, 200);
    assert.notEqual(created.data.id, "forged");
    assert.notEqual(created.data.createdAt, "fake");
    assert.equal(created.data.password, undefined);
    assert.equal(created.data.password_hash, undefined);
    assert.equal(
      (await request(base, "POST", admin.accessToken, { ...profile, password }))
        .status,
      409,
    );
    const viewer = (
      await request("/auth/login", "POST", undefined, {
        username: profile.username,
        password,
      })
    ).data;
    assert.ok(
      !viewer.routes.some(
        (route: { name: string }) => route.name === "SystemManagement",
      ),
    );
    for (const [path, method, body] of [
      [base, "GET", undefined],
      [base, "POST", { ...profile, password }],
      [`${base}/${created.data.id}`, "PUT", profile],
      [`${base}/${created.data.id}`, "DELETE", undefined],
      [`${base}/${created.data.id}/password`, "PUT", { password }],
    ] as const) {
      assert.equal(
        (await request(path, method, viewer.accessToken, body)).status,
        403,
      );
    }
    const list = await request(
      `${base}?username=LEARN&nickname=学习&status=enabled&department=研发&phone=00001&page=1&pageSize=1`,
      "GET",
      admin.accessToken,
    );
    assert.equal(list.data.total, 1);
    assert.equal(list.data.list[0].id, created.data.id);
    assert.equal(
      (
        await request(
          `${base}?page=2&pageSize=1&username=learner`,
          "GET",
          admin.accessToken,
        )
      ).data.list.length,
      0,
    );
    for (const query of [
      "page=0",
      "page=1.2",
      "pageSize=101",
      "pageSize=-1",
      "status=bad",
      "username=a&username=b",
      "page=9007199254740992",
    ]) {
      assert.equal(
        (await request(`${base}?${query}`, "GET", admin.accessToken)).status,
        400,
      );
    }
    const updated = await request(
      `${base}/${created.data.id}`,
      "PUT",
      admin.accessToken,
      {
        ...profile,
        nickname: "新昵称",
        password: "ignored",
        createdAt: "fake",
      },
    );
    assert.equal(updated.data.nickname, "新昵称");
    assert.equal(updated.data.createdAt, created.data.createdAt);
    const stored = f.database
      .prepare("SELECT password_hash FROM users WHERE id=?")
      .get(created.data.id);
    assert.ok(await verifyPassword(password, String(stored?.password_hash)));
    assert.equal(
      (await request(`${base}/${created.data.id}`, "DELETE", admin.accessToken))
        .data,
      true,
    );
    assert.equal(
      (await request("/auth/session", "GET", viewer.accessToken)).status,
      401,
    );
    assert.equal(
      (await request(`${base}/${created.data.id}`, "DELETE", admin.accessToken))
        .status,
      404,
    );
    assert.equal(
      (
        await request(
          `${base}/${created.data.id}/password`,
          "PUT",
          admin.accessToken,
          { password },
        )
      ).status,
      404,
    );
  } finally {
    await f.close();
  }
});

test("停用撤销全部会话，重新启用不复活旧 token，重置密码使旧密码和会话失效", async () => {
  const f = await fixture();
  try {
    const { request, admin } = f;
    const base = "/system-management/users";
    const user = (
      await request(base, "POST", admin.accessToken, { ...profile, password })
    ).data;
    const login = () =>
      request("/auth/login", "POST", undefined, {
        username: profile.username,
        password,
      });
    const first = (await login()).data.accessToken;
    const second = (await login()).data.accessToken;
    assert.equal(
      (
        await request(`${base}/${user.id}`, "PUT", admin.accessToken, {
          ...profile,
          status: "disabled",
        })
      ).status,
      200,
    );
    assert.equal((await login()).status, 401);
    assert.equal(
      (await request(`${base}/${user.id}`, "PUT", admin.accessToken, profile))
        .status,
      200,
    );
    for (const token of [first, second])
      assert.equal((await request("/auth/session", "GET", token)).status, 401);
    const third = (await login()).data.accessToken;
    const nextPassword = "new-stage-three-password";
    assert.equal(
      (
        await request(`${base}/${user.id}/password`, "PUT", admin.accessToken, {
          password: nextPassword,
        })
      ).data,
      true,
    );
    assert.equal((await request("/auth/session", "GET", third)).status, 401);
    assert.equal((await login()).status, 401);
    assert.equal(
      (
        await request("/auth/login", "POST", undefined, {
          username: profile.username,
          password: nextPassword,
        })
      ).status,
      200,
    );
    // 管理员重置自己的密码同样撤销当前 token。
    assert.equal(
      (
        await request(
          `${base}/${admin.user.id}/password`,
          "PUT",
          admin.accessToken,
          { password: nextPassword },
        )
      ).status,
      200,
    );
    assert.equal(
      (await request("/auth/session", "GET", admin.accessToken)).status,
      401,
    );
  } finally {
    await f.close();
  }
});

test("最后一个启用管理员不可删除、停用、降级；两个管理员并发降级只成功一次", async () => {
  const f = await fixture();
  try {
    const { request, admin } = f;
    const base = "/system-management/users";
    const adminProfile = { ...profile, username: "admin", role: "admin" };
    for (const next of [
      { ...adminProfile, role: "viewer" },
      { ...adminProfile, status: "disabled" },
    ]) {
      assert.equal(
        (
          await request(
            `${base}/${admin.user.id}`,
            "PUT",
            admin.accessToken,
            next,
          )
        ).status,
        409,
      );
    }
    assert.equal(
      (await request(`${base}/${admin.user.id}`, "DELETE", admin.accessToken))
        .status,
      409,
    );
    const other = (
      await request(base, "POST", admin.accessToken, {
        ...profile,
        role: "admin",
        password,
      })
    ).data;
    const otherToken = (
      await request("/auth/login", "POST", undefined, {
        username: profile.username,
        password,
      })
    ).data.accessToken;
    const results = await Promise.all([
      request(`${base}/${admin.user.id}`, "PUT", admin.accessToken, {
        ...adminProfile,
        role: "viewer",
      }),
      request(`${base}/${other.id}`, "PUT", otherToken, profile),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const successIndex = results.findIndex((r) => r.status === 200);
    const demotedToken = successIndex === 0 ? admin.accessToken : otherToken;
    const session = await request("/auth/session", "GET", demotedToken);
    assert.equal(session.data.user.role, "viewer");
    assert.ok(
      !session.data.routes.some(
        (route: { name: string }) => route.name === "SystemManagement",
      ),
    );
    assert.equal((await request(base, "GET", demotedToken)).status, 403);
  } finally {
    await f.close();
  }
});

test("撤销会话或删除中途失败时事务回滚，资料、密码和会话保持原状", async () => {
  const f = await fixture();
  try {
    const { database, request, admin } = f;
    const user = (
      await request("/system-management/users", "POST", admin.accessToken, {
        ...profile,
        password,
      })
    ).data;
    const token = (
      await request("/auth/login", "POST", undefined, {
        username: profile.username,
        password,
      })
    ).data.accessToken;
    const before = database
      .prepare("SELECT * FROM users WHERE id=?")
      .get(user.id);
    database.exec(
      "CREATE TRIGGER reject_session_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'test rollback'); END",
    );
    const nextHash = await hashPassword("replacement-test-password");
    assert.throws(
      () => resetPassword(database, user.id, nextHash),
      /test rollback/,
    );
    assert.throws(
      () =>
        updateUser(database, user.id, {
          ...profile,
          role: "viewer",
          status: "disabled",
          gender: "unknown",
        }),
      /test rollback/,
    );
    assert.throws(() => deleteUser(database, user.id), /test rollback/);
    assert.deepEqual(
      database.prepare("SELECT * FROM users WHERE id=?").get(user.id),
      before,
    );
    assert.equal((await request("/auth/session", "GET", token)).status, 200);
  } finally {
    await f.close();
  }
});
