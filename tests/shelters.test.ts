import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import {
  applyMigrations,
  checkDatabaseReady,
  openDatabase,
} from "../src/db.js";
import { initializeAdmin } from "../src/initialize-admin.js";
import {
  createShelter,
  getShelter,
  listShelters,
} from "../src/modules/shelters/service.js";

const password = "stage-four-only-password";
const base = "/system-management/shelters";
function values() {
  return {
    name: "  测试避难场所  ",
    facilityType: "school",
    shelterUsage: "temporary",
    operationStatus: "open",
    capacity: 100,
    availableCapacity: 80,
    facilities: ["drinkingWater", "toilet"],
    address: "杭州滨江测试路",
    location: { longitude: 120.2, latitude: 30.2 },
    managementUnit: "应急管理中心",
    contactName: "测试联系人",
    contactPhone: "13800000001",
  };
}
async function fixture() {
  const database = openDatabase(":memory:");
  applyMigrations(database);
  await initializeAdmin(database, "admin", password);
  database.exec(`INSERT INTO users (id,username,password_hash,nickname,role,created_at,updated_at)
    SELECT 'viewer-id','viewer',password_hash,'普通用户','viewer',created_at,updated_at FROM users WHERE username='admin'`);
  const server = createApp(database).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  async function request(
    path: string,
    method = "GET",
    token?: string,
    body?: unknown,
  ) {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api${path}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    return { status: response.status, ...(await response.json()) };
  }
  const admin = (
    await request("/auth/login", "POST", undefined, {
      username: "admin",
      password,
    })
  ).data;
  const viewer = (
    await request("/auth/login", "POST", undefined, {
      username: "viewer",
      password,
    })
  ).data;
  return {
    database,
    request,
    admin,
    viewer,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      database.close();
    },
  };
}

test("场所五个接口均要求管理员，菜单只为管理员开放当前已完成模块", async () => {
  const f = await fixture();
  try {
    const system = f.admin.routes.find(
      (route: { name: string }) => route.name === "SystemManagement",
    );
    assert.deepEqual(
      system.children.map((route: { path: string }) => route.path),
      ["user-management", "shelter-management"],
    );
    assert.ok(
      !f.viewer.routes.some(
        (route: { name: string }) => route.name === "SystemManagement",
      ),
    );
    for (const [path, method, body] of [
      [base, "GET", undefined],
      [`${base}/missing`, "GET", undefined],
      [base, "POST", values()],
      [`${base}/missing`, "PUT", values()],
      [`${base}/missing`, "DELETE", undefined],
    ] as const) {
      assert.equal(
        (await f.request(path, method, undefined, body)).status,
        401,
      );
      assert.equal(
        (await f.request(path, method, f.viewer.accessToken, body)).status,
        403,
      );
    }
  } finally {
    await f.close();
  }
});

test("场所真实 CRUD 保护系统字段，零坐标有效，可选字段清空后响应省略，删除后返回 404", async () => {
  const f = await fixture();
  try {
    const token = f.admin.accessToken;
    const created = await f.request(base, "POST", token, {
      ...values(),
      location: { longitude: 0, latitude: 0, height: 0 },
      description: "  备注  ",
      id: "forged",
      createdAt: "fake",
      updatedAt: "fake",
    });
    assert.equal(created.status, 200);
    const record = created.data;
    assert.notEqual(record.id, "forged");
    assert.equal(record.name, "测试避难场所");
    assert.equal(record.description, "备注");
    assert.deepEqual(record.location, { longitude: 0, latitude: 0, height: 0 });
    assert.match(record.createdAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.deepEqual(
      (await f.request(`${base}/${record.id}`, "GET", token)).data,
      record,
    );
    const raw = f.database
      .prepare("SELECT * FROM shelters WHERE id=?")
      .get(record.id);
    assert.equal(raw?.facilities_json, JSON.stringify(values().facilities));
    assert.equal(record.facilities_json, undefined);
    assert.equal(record.longitude, undefined);
    const updated = await f.request(`${base}/${record.id}`, "PUT", token, {
      ...values(),
      location: { longitude: 120, latitude: 30, height: null },
      facilities: [],
      description: null,
      id: "other",
      createdAt: "fake",
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.id, record.id);
    assert.equal(updated.data.createdAt, record.createdAt);
    assert.equal(Object.hasOwn(updated.data.location, "height"), false);
    assert.equal(Object.hasOwn(updated.data, "description"), false);
    assert.deepEqual(updated.data.facilities, []);
    assert.equal(
      f.database
        .prepare("SELECT height,description FROM shelters WHERE id=?")
        .get(record.id)?.height,
      null,
    );
    assert.equal(
      (await f.request(`${base}/${record.id}`, "DELETE", token)).data,
      true,
    );
    for (const method of ["GET", "PUT", "DELETE"])
      assert.equal(
        (
          await f.request(
            `${base}/${record.id}`,
            method,
            token,
            method === "PUT" ? values() : undefined,
          )
        ).status,
        404,
      );
    assert.deepEqual((await f.request(base, "GET", token)).data, {
      list: [],
      total: 0,
    });
  } finally {
    await f.close();
  }
});

test("场所校验拒绝非法枚举、容量、坐标、设施和超长字段，失败写入不改变原记录", async () => {
  const f = await fixture();
  try {
    const token = f.admin.accessToken;
    const record = (await f.request(base, "POST", token, values())).data;
    const invalid = [
      null,
      [],
      {},
      { ...values(), name: " " },
      { ...values(), name: "长".repeat(101) },
      { ...values(), address: "长".repeat(501) },
      { ...values(), facilityType: "bad" },
      { ...values(), shelterUsage: "bad" },
      { ...values(), operationStatus: "bad" },
      { ...values(), capacity: -1 },
      { ...values(), capacity: 0.1 },
      { ...values(), capacity: Number.MAX_SAFE_INTEGER + 1 },
      { ...values(), availableCapacity: 101 },
      { ...values(), availableCapacity: "5" },
      { ...values(), availableCapacity: null },
      { ...values(), location: null },
      { ...values(), location: { longitude: null, latitude: 0 } },
      { ...values(), location: { longitude: "0", latitude: 0 } },
      { ...values(), location: { longitude: 181, latitude: 0 } },
      { ...values(), location: { longitude: 0, latitude: -91 } },
      { ...values(), location: { longitude: 0, latitude: 0, height: "0" } },
      { ...values(), facilities: ["invalid"] },
      { ...values(), facilities: ["toilet", "toilet"] },
      { ...values(), facilities: null },
      { ...values(), description: 0 },
      { ...values(), description: "长".repeat(2001) },
      { ...values(), contactPhone: "123" },
    ];
    for (const body of invalid) {
      assert.equal((await f.request(base, "POST", token, body)).status, 400);
      assert.equal(
        (await f.request(`${base}/${record.id}`, "PUT", token, body)).status,
        400,
      );
    }
    for (const badNumber of [NaN, Infinity, -Infinity])
      assert.throws(
        () =>
          createShelter(f.database, {
            ...values(),
            location: { longitude: badNumber, latitude: 0 },
          }),
        /有限数值/,
      );
    assert.deepEqual(
      (await f.request(`${base}/${record.id}`, "GET", token)).data,
      record,
    );
    assert.equal((await f.request(base, "GET", token)).data.total, 1);
  } finally {
    await f.close();
  }
});

test("场所全部筛选条件组合生效，分页稳定，特殊文本按字面匹配，非法分页返回 400", async () => {
  const f = await fixture();
  try {
    const token = f.admin.accessToken;
    for (let i = 0; i < 12; i++)
      createShelter(f.database, { ...values(), name: `场所${i}` });
    const target = createShelter(f.database, {
      ...values(),
      name: "Campus_%",
      facilityType: "park",
      shelterUsage: "longTerm",
      operationStatus: "maintenance",
      managementUnit: "杭州专属单位",
      address: "测试街道独特地址",
    });
    f.database
      .prepare("UPDATE shelters SET updated_at=? WHERE id=?")
      .run("2030-01-01T00:00:00.000Z", target.id);
    const result = await f.request(
      `${base}?name=campus_%&facilityType=park&shelterUsage=longTerm&operationStatus=maintenance&managementUnit=专属&address=独特`,
      "GET",
      token,
    );
    assert.equal(result.data.total, 1);
    assert.equal(result.data.list[0].id, target.id);
    const first = (await f.request(`${base}?page=1&pageSize=10`, "GET", token))
      .data;
    const second = (await f.request(`${base}?page=2&pageSize=10`, "GET", token))
      .data;
    assert.equal(first.list.length, 10);
    assert.equal(second.list.length, 3);
    assert.equal(first.list[0].id, target.id);
    assert.equal(
      new Set([...first.list, ...second.list].map((item) => item.id)).size,
      13,
    );
    assert.deepEqual((await f.request(`${base}?page=5`, "GET", token)).data, {
      list: [],
      total: 13,
    });
    assert.equal(
      (await f.request(`${base}?name=%20%20`, "GET", token)).data.total,
      13,
    );
    assert.equal(
      (
        await f.request(
          `${base}?name=${encodeURIComponent("' OR 1=1 --")}`,
          "GET",
          token,
        )
      ).data.total,
      0,
    );
    for (const query of [
      "page=0",
      "page=-1",
      "page=1.2",
      "pageSize=101",
      "pageSize=0",
      "page=9007199254740992",
      "name=a&name=b",
      "facilityType=bad",
      "shelterUsage=bad",
      "operationStatus=bad",
    ])
      assert.equal(
        (await f.request(`${base}?${query}`, "GET", token)).status,
        400,
      );
  } finally {
    await f.close();
  }
});

test("新增迁移保留旧账号与会话，场所关闭重开后仍存在，数据库约束阻止非法容量", async () => {
  const directory = mkdtempSync(join(tmpdir(), "shelter-stage4-"));
  const path = join(directory, "app.db");
  let database = openDatabase(path);
  try {
    applyMigrations(database);
    await initializeAdmin(database, "admin", password);
    const admin = database
      .prepare("SELECT id FROM users WHERE username='admin'")
      .get();
    database
      .prepare(
        "INSERT INTO sessions VALUES ('old-session', ?, 'hash', '2030-01-01', '2026-01-01')",
      )
      .run(String(admin?.id));
    // 还原为只有阶段 1 表结构的数据库，再执行新增迁移，模拟真实升级。
    database.exec(
      "DROP TABLE shelters; DELETE FROM schema_migrations WHERE filename='002_create_shelters.sql'",
    );
    assert.deepEqual(applyMigrations(database), ["002_create_shelters.sql"]);
    assert.equal(
      database.prepare("SELECT count(*) AS total FROM sessions").get()?.total,
      1,
    );
    assert.equal(
      database.prepare("SELECT count(*) AS total FROM users").get()?.total,
      1,
    );
    const record = createShelter(database, values());
    assert.throws(
      () =>
        database
          .prepare("UPDATE shelters SET available_capacity=101 WHERE id=?")
          .run(record.id),
      /CHECK/,
    );
    database.close();
    checkDatabaseReady(path);
    database = openDatabase(path);
    assert.deepEqual(applyMigrations(database), []);
    assert.deepEqual(getShelter(database, record.id), record);
    assert.equal(listShelters(database, {}).total, 1);
  } finally {
    if (database.isOpen) database.close();
    if (existsSync(path)) unlinkSync(path);
    rmdirSync(directory);
  }
});
