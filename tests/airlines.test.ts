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
  calculateAirlineLength,
  createAirline,
  getAirline,
  listAirlines,
  updateAirline,
  validateAirline,
} from "../src/modules/airlines/service.js";
import { createShelter } from "../src/modules/shelters/service.js";

const base = "/system-management/airlines";
const password = "stage-five-only-password";
function values() {
  return {
    name: "  测试航线 Route A  ",
    speed: 5,
    remark: "巡检用途",
    waypoints: [
      { longitude: 120, latitude: 30, altitude: 0 },
      { longitude: 120.01, latitude: 30.01, altitude: 80 },
    ],
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

test("航线五个接口均检查身份与管理员角色，菜单只开放已完成的管理模块", async () => {
  const f = await fixture();
  try {
    const system = f.admin.routes.find(
      (route: { name: string }) => route.name === "SystemManagement",
    );
    assert.deepEqual(
      system.children.map((route: { path: string }) => route.path),
      [
        "user-management",
        "shelter-management",
        "airline-management",
        "key-unit-management",
      ],
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

test("航线真实 CRUD 的序号、数量和长度由后端计算，列表只返回摘要，更新保留编号和创建时间", async () => {
  const f = await fixture();
  try {
    const token = f.admin.accessToken;
    const input = values();
    const created = await f.request(base, "POST", token, {
      ...input,
      id: "forged",
      createdAt: "fake",
      updatedAt: "fake",
      length: 999,
      waypointCount: 999,
      waypoints: input.waypoints.map((point) => ({
        ...point,
        order: 999,
        extra: true,
      })),
    });
    assert.equal(created.status, 200);
    const record = created.data;
    assert.notEqual(record.id, "forged");
    assert.equal(record.name, "测试航线 Route A");
    assert.equal(record.waypointCount, 2);
    assert.deepEqual(
      record.waypoints,
      input.waypoints.map((point, index) => ({ ...point, order: index + 1 })),
    );
    assert.equal(record.length, calculateAirlineLength(record.waypoints));
    assert.match(record.createdAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.deepEqual(
      (await f.request(`${base}/${record.id}`, "GET", token)).data,
      record,
    );
    const summary = (await f.request(base, "GET", token)).data.list[0];
    assert.deepEqual(Object.keys(summary).sort(), [
      "id",
      "length",
      "name",
      "speed",
      "updatedAt",
      "waypointCount",
    ]);
    const updated = await f.request(`${base}/${record.id}`, "PUT", token, {
      ...input,
      name: "反向航线",
      waypoints: [...input.waypoints].reverse(),
      remark: undefined,
      id: "other",
      createdAt: "fake",
      waypointCount: 500,
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.id, record.id);
    assert.equal(updated.data.createdAt, record.createdAt);
    assert.equal(updated.data.remark, "");
    assert.deepEqual(
      updated.data.waypoints,
      [...input.waypoints]
        .reverse()
        .map((point, index) => ({ ...point, order: index + 1 })),
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
            method === "PUT" ? input : undefined,
          )
        ).status,
        404,
      );
  } finally {
    await f.close();
  }
});

test("非法航点和超限字段返回 400，失败保存保留原记录，1000 个航点边界可保存", async () => {
  const f = await fixture();
  try {
    const token = f.admin.accessToken;
    const record = (await f.request(base, "POST", token, values())).data;
    const bad: unknown[] = [
      null,
      [],
      {},
      { ...values(), name: " " },
      { ...values(), name: "长".repeat(101) },
      { ...values(), speed: 0 },
      { ...values(), speed: -1 },
      { ...values(), speed: "5" },
      { ...values(), speed: null },
      { ...values(), remark: null },
      { ...values(), remark: "长".repeat(2001) },
      { ...values(), waypoints: [] },
      { ...values(), waypoints: [values().waypoints[0]] },
      { ...values(), waypoints: [null, values().waypoints[1]] },
      {
        ...values(),
        waypoints: Array.from({ length: 1001 }, (_, index) => ({
          longitude: index / 1000,
          latitude: 0,
          altitude: 0,
        })),
      },
    ];
    for (const field of ["longitude", "latitude", "altitude"]) {
      for (const value of [
        null,
        "0",
        undefined,
        field === "longitude" ? 181 : field === "latitude" ? -91 : -1,
      ])
        bad.push({
          ...values(),
          waypoints: [
            values().waypoints[0],
            { ...values().waypoints[1], [field]: value },
          ],
        });
    }
    bad.push({
      ...values(),
      waypoints: [values().waypoints[0], values().waypoints[0]],
    });
    for (const body of bad) {
      const response = await f.request(base, "POST", token, body);
      assert.equal(response.status, 400);
      // Express 的严格 JSON 解析先拒绝顶层 null；其余对象由航线业务层校验。
      assert.equal(response.code, body === null ? 40000 : 40003);
      assert.equal(
        (await f.request(`${base}/${record.id}`, "PUT", token, body)).status,
        400,
      );
    }
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.throws(
        () => validateAirline({ ...values(), speed: value }),
        /有限数值/,
      );
      assert.throws(
        () =>
          validateAirline({
            ...values(),
            waypoints: [
              { ...values().waypoints[0], altitude: value },
              values().waypoints[1],
            ],
          }),
        /第 1 个航点高度/,
      );
    }
    assert.deepEqual(getAirline(f.database, record.id), record);
    assert.equal(listAirlines(f.database, {}).total, 1);
    const boundary = createAirline(f.database, {
      ...values(),
      name: "长".repeat(100),
      remark: "长".repeat(2000),
      waypoints: Array.from({ length: 1000 }, (_, index) => ({
        longitude: index / 1000,
        latitude: 0,
        altitude: 0,
      })),
    });
    assert.equal(boundary.waypointCount, 1000);
    assert.equal(boundary.waypoints[999].order, 1000);
    assert.equal(boundary.length, calculateAirlineLength(boundary.waypoints));
  } finally {
    await f.close();
  }
});

test("名称筛选按文本匹配，分页稳定，非法查询返回 400；相同名称允许多条记录", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 12; i++) createAirline(f.database, values());
    const target = createAirline(f.database, { ...values(), name: "Route_%" });
    f.database
      .prepare("UPDATE airlines SET updated_at=? WHERE id=?")
      .run("2030-01-01T00:00:00.000Z", target.id);
    const token = f.admin.accessToken;
    assert.equal(
      (await f.request(`${base}?name=route_%`, "GET", token)).data.total,
      1,
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
    assert.equal(
      (await f.request(`${base}?name=%20%20`, "GET", token)).data.total,
      13,
    );
    const first = (await f.request(`${base}?page=1&pageSize=10`, "GET", token))
      .data;
    const second = (await f.request(`${base}?page=2&pageSize=10`, "GET", token))
      .data;
    assert.equal(first.list[0].id, target.id);
    assert.equal(first.list.length, 10);
    assert.equal(second.list.length, 3);
    assert.equal(
      new Set([...first.list, ...second.list].map((item) => item.id)).size,
      13,
    );
    assert.deepEqual((await f.request(`${base}?page=10`, "GET", token)).data, {
      list: [],
      total: 13,
    });
    for (const query of [
      "page=0",
      "page=-1",
      "page=1.2",
      "page=NaN",
      "page=9007199254740992",
      "pageSize=101",
      "pageSize=0",
      "name=a&name=b",
      `name=${"长".repeat(101)}`,
    ])
      assert.equal(
        (await f.request(`${base}?${query}`, "GET", token)).status,
        400,
      );
  } finally {
    await f.close();
  }
});

test("水平长度符合球面参考值，允许垂直升降、路径交叉、非相邻重复点与手动闭合", () => {
  const database = openDatabase(":memory:");
  try {
    applyMigrations(database);
    const point = (longitude: number, latitude: number, altitude = 0) => ({
      longitude,
      latitude,
      altitude,
      order: 0,
    });
    const degree = (6371008.8 * Math.PI) / 180;
    const length = calculateAirlineLength([
      point(0, 0),
      point(1, 0, 999),
      point(1, 1),
    ]);
    assert.ok(Math.abs(length - 2 * degree) < 0.001);
    assert.equal(calculateAirlineLength([]), 0);
    assert.equal(calculateAirlineLength([point(0, 0)]), 0);
    assert.ok(
      Math.abs(
        calculateAirlineLength([point(179, 0), point(-179, 0)]) - 2 * degree,
      ) < 0.001,
    );
    assert.ok(
      Math.abs(
        calculateAirlineLength([point(0, 0), point(180, 0)]) -
          Math.PI * 6371008.8,
      ) < 0.001,
    );
    const vertical = createAirline(database, {
      ...values(),
      waypoints: [point(0, 0), point(0, 0, 80)],
    });
    assert.equal(vertical.length, 0);
    for (const waypoints of [
      [point(0, 0), point(1, 1), point(0, 1), point(1, 0)],
      [point(0, 0), point(1, 0), point(0, 0)],
    ]) {
      const record = createAirline(database, { ...values(), waypoints });
      assert.equal(record.waypointCount, waypoints.length);
    }
  } finally {
    database.close();
  }
});

test("迁移保留旧账号与场所，航点及摘要重启持久化，写入中途失败时整条更新回滚", async () => {
  const directory = mkdtempSync(join(tmpdir(), "airline-stage5-"));
  const path = join(directory, "app.db");
  let database = openDatabase(path);
  try {
    applyMigrations(database);
    await initializeAdmin(database, "admin", password);
    const shelter = createShelter(database, {
      name: "旧场所",
      facilityType: "park",
      shelterUsage: "temporary",
      operationStatus: "open",
      capacity: 1,
      availableCapacity: 1,
      facilities: [],
      address: "测试地址",
      location: { longitude: 0, latitude: 0 },
      managementUnit: "单位",
      contactName: "联系人",
      contactPhone: "13800000001",
    });
    database.exec(
      "DROP TABLE airlines; DELETE FROM schema_migrations WHERE filename='003_create_airlines.sql'",
    );
    assert.deepEqual(applyMigrations(database), ["003_create_airlines.sql"]);
    assert.equal(
      database.prepare("SELECT count(*) AS total FROM users").get()?.total,
      1,
    );
    assert.ok(
      database.prepare("SELECT id FROM shelters WHERE id=?").get(shelter.id),
    );
    const record = createAirline(database, values());
    // AFTER UPDATE 的触发器在写入后主动失败，证明 SQLite 会撤销整条语句的修改。
    database.exec(
      "CREATE TRIGGER reject_airline_update AFTER UPDATE ON airlines BEGIN SELECT RAISE(ABORT, 'test rollback'); END",
    );
    assert.throws(
      () =>
        updateAirline(database, record.id, {
          ...values(),
          name: "不应保留",
          waypoints: [...values().waypoints].reverse(),
        }),
      /test rollback/,
    );
    assert.deepEqual(getAirline(database, record.id), record);
    database.close();
    checkDatabaseReady(path);
    database = openDatabase(path);
    assert.deepEqual(applyMigrations(database), []);
    assert.deepEqual(getAirline(database, record.id), record);
    assert.equal(listAirlines(database, {}).list[0].length, record.length);
  } finally {
    if (database.isOpen) database.close();
    if (existsSync(path)) unlinkSync(path);
    rmdirSync(directory);
  }
});
