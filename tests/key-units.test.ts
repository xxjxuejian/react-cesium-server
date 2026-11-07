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
  createKeyUnit,
  deleteKeyUnit,
  getKeyUnit,
  listKeyUnits,
  updateKeyUnit,
  validateKeyUnit,
} from "../src/modules/key-units/service.js";
import { createAirline, getAirline } from "../src/modules/airlines/service.js";
import { createShelter, getShelter } from "../src/modules/shelters/service.js";

const base = "/system-management/key-units";
const password = "stage-six-only-password";
function values() {
  return {
    name: " 测试单位 ",
    longitude: 120.2,
    latitude: 30.25,
    address: " 行政中心 ",
    remark: " 测试备注 ",
    rings: {
      core: { radius: 300, minHeight: 20, maxHeight: 120 },
      counter: { radius: 800, minHeight: 10, maxHeight: 200 },
      warning: { radius: 1500, minHeight: 0, maxHeight: 300 },
    },
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

test("重点单位五个接口均要求管理员，全部四个管理菜单仅向管理员开放", async () => {
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

test("重点单位 CRUD 整体保存共同中心及三层范围，摘要排除备注与创建时间并保护系统字段", async () => {
  const f = await fixture();
  try {
    const token = f.admin.accessToken;
    const input = values();
    const response = await f.request(base, "POST", token, {
      ...input,
      longitude: 0,
      latitude: 0,
      id: "forged",
      createdAt: "fake",
      updatedAt: "fake",
      rings: {
        ...input.rings,
        core: { ...input.rings.core, color: "fake", longitude: 100 },
      },
    });
    assert.equal(response.status, 200);
    const record = response.data;
    assert.notEqual(record.id, "forged");
    assert.equal(record.name, "测试单位");
    assert.equal(record.address, "行政中心");
    assert.equal(record.remark, "测试备注");
    assert.equal(record.longitude, 0);
    assert.equal(record.latitude, 0);
    assert.deepEqual(record.rings, input.rings);
    assert.match(record.createdAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.deepEqual(
      (await f.request(`${base}/${record.id}`, "GET", token)).data,
      record,
    );
    const summary = (await f.request(base, "GET", token)).data.list[0];
    assert.deepEqual(Object.keys(summary).sort(), [
      "address",
      "id",
      "latitude",
      "longitude",
      "name",
      "rings",
      "updatedAt",
    ]);
    assert.deepEqual(
      JSON.parse(
        String(
          f.database
            .prepare("SELECT rings_json FROM key_units WHERE id=?")
            .get(record.id)?.rings_json,
        ),
      ),
      input.rings,
    );
    const next = {
      ...input,
      name: "新的单位名称",
      address: "",
      remark: "",
      rings: {
        core: { radius: 200, minHeight: 0, maxHeight: 100 },
        counter: { radius: 600, minHeight: 0, maxHeight: 100 },
        warning: { radius: 1200, minHeight: 0, maxHeight: 100 },
      },
    };
    const updated = await f.request(`${base}/${record.id}`, "PUT", token, {
      ...next,
      id: "other",
      createdAt: "fake",
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.id, record.id);
    assert.equal(updated.data.createdAt, record.createdAt);
    assert.deepEqual(updated.data.rings, next.rings);
    assert.equal(updated.data.address, "");
    assert.equal(updated.data.remark, "");
    assert.equal(
      (await f.request(`${base}/${record.id}`, "DELETE", token)).data,
      true,
    );
    for (const method of ["GET", "PUT", "DELETE"]) {
      const result = await f.request(
        `${base}/${record.id}`,
        method,
        token,
        method === "PUT" ? input : undefined,
      );
      assert.equal(result.status, 404);
      assert.equal(result.code, 40404);
    }
  } finally {
    await f.close();
  }
});

test("非法空值、坐标、圈层结构与数值被拒绝，所有包含关系均由后端检查，失败不改变旧数据", async () => {
  const f = await fixture();
  try {
    const token = f.admin.accessToken;
    const record = (await f.request(base, "POST", token, values())).data;
    const bad: unknown[] = [
      null,
      [],
      {},
      { ...values(), name: " " },
      { ...values(), name: "名".repeat(101) },
      { ...values(), address: "址".repeat(501) },
      { ...values(), remark: "注".repeat(2001) },
      { ...values(), address: null },
      { ...values(), remark: undefined },
      { ...values(), longitude: null },
      { ...values(), latitude: "0" },
      { ...values(), longitude: 181 },
      { ...values(), latitude: -91 },
      { ...values(), rings: null },
      { ...values(), rings: [] },
      { ...values(), rings: { core: values().rings.core } },
      { ...values(), rings: { ...values().rings, extra: values().rings.core } },
      {
        ...values(),
        rings: {
          core: values().rings.core,
          counter: values().rings.counter,
          other: values().rings.warning,
        },
      },
    ];
    for (const type of ["core", "counter", "warning"] as const) {
      bad.push({ ...values(), rings: { ...values().rings, [type]: null } });
      for (const field of ["radius", "minHeight", "maxHeight"]) {
        for (const number of [null, "100", undefined, -1])
          bad.push({
            ...values(),
            rings: {
              ...values().rings,
              [type]: { ...values().rings[type], [field]: number },
            },
          });
      }
    }
    const wrongRelations = [
      { ...values().rings, core: { ...values().rings.core, radius: 800 } },
      { ...values().rings, core: { ...values().rings.core, minHeight: 0 } },
      { ...values().rings, core: { ...values().rings.core, maxHeight: 250 } },
      {
        ...values().rings,
        counter: { ...values().rings.counter, radius: 1500 },
      },
      {
        ...values().rings,
        warning: { ...values().rings.warning, minHeight: 15 },
      },
      {
        ...values().rings,
        counter: { ...values().rings.counter, maxHeight: 350 },
      },
      { ...values().rings, core: { ...values().rings.core, maxHeight: 20 } },
    ];
    for (const rings of wrongRelations) bad.push({ ...values(), rings });
    for (const body of bad) {
      const result = await f.request(base, "POST", token, body);
      assert.equal(result.status, 400);
      assert.equal(result.code, body === null ? 40000 : 40004);
      assert.equal(
        (await f.request(`${base}/${record.id}`, "PUT", token, body)).status,
        400,
      );
    }
    for (const number of [NaN, Infinity, -Infinity]) {
      assert.throws(
        () => validateKeyUnit({ ...values(), longitude: number }),
        /有限数值/,
      );
      for (const field of ["radius", "minHeight", "maxHeight"])
        assert.throws(
          () =>
            validateKeyUnit({
              ...values(),
              rings: {
                ...values().rings,
                core: { ...values().rings.core, [field]: number },
              },
            }),
          /核心圈/,
        );
    }
    assert.deepEqual(getKeyUnit(f.database, record.id), record);
    assert.equal(listKeyUnits(f.database, {}).total, 1);
    const boundary = createKeyUnit(f.database, {
      ...values(),
      name: "名".repeat(100),
      address: "址".repeat(500),
      remark: "注".repeat(2000),
      rings: {
        core: { radius: 1e8, minHeight: 0, maxHeight: 100 },
        counter: { radius: 2e8, minHeight: 0, maxHeight: 100 },
        warning: { radius: 3e8, minHeight: 0, maxHeight: 100 },
      },
    });
    assert.equal(boundary.rings.warning.radius, 3e8);
  } finally {
    await f.close();
  }
});

test("名称按字面筛选，稳定分页与同名记录均正常，非法查询返回 400", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 12; i++) createKeyUnit(f.database, values());
    const target = createKeyUnit(f.database, { ...values(), name: "Center_%" });
    f.database
      .prepare("UPDATE key_units SET updated_at=? WHERE id=?")
      .run("2030-01-01T00:00:00.000Z", target.id);
    const token = f.admin.accessToken;
    assert.equal(
      (await f.request(`${base}?name=center_%`, "GET", token)).data.total,
      1,
    );
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
      "pageSize=101",
      "pageSize=0",
      "page=9007199254740992",
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

test("旧库新增迁移保留账号、会话和业务数据，删除单位不会删除航线或避难场所，重启持久化有效", async () => {
  const directory = mkdtempSync(join(tmpdir(), "key-unit-stage6-"));
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
    const airline = createAirline(database, {
      name: "保留航线",
      speed: 5,
      waypoints: [
        { longitude: 0, latitude: 0, altitude: 0 },
        { longitude: 1, latitude: 1, altitude: 80 },
      ],
    });
    const shelter = createShelter(database, {
      name: "保留场所",
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
      "DROP TABLE key_units; DELETE FROM schema_migrations WHERE filename='004_create_key_units.sql'",
    );
    assert.deepEqual(applyMigrations(database), ["004_create_key_units.sql"]);
    assert.equal(
      database.prepare("SELECT count(*) AS total FROM users").get()?.total,
      1,
    );
    assert.equal(
      database.prepare("SELECT count(*) AS total FROM sessions").get()?.total,
      1,
    );
    const deleted = createKeyUnit(database, values());
    deleteKeyUnit(database, deleted.id);
    assert.deepEqual(getAirline(database, airline.id), airline);
    assert.deepEqual(getShelter(database, shelter.id), shelter);
    const record = createKeyUnit(database, values());
    database.close();
    checkDatabaseReady(path);
    database = openDatabase(path);
    assert.deepEqual(applyMigrations(database), []);
    assert.deepEqual(getKeyUnit(database, record.id), record);
  } finally {
    if (database.isOpen) database.close();
    if (existsSync(path)) unlinkSync(path);
    rmdirSync(directory);
  }
});

test("共同中心与圈层使用原子写入，数据库写入失败后没有半份修改", () => {
  const database = openDatabase(":memory:");
  try {
    applyMigrations(database);
    const record = createKeyUnit(database, values());
    database.exec(
      "CREATE TRIGGER reject_key_unit_update AFTER UPDATE ON key_units BEGIN SELECT RAISE(ABORT, 'test rollback'); END",
    );
    assert.throws(
      () =>
        updateKeyUnit(database, record.id, {
          ...values(),
          name: "不应保存",
          longitude: 0,
          rings: {
            ...values().rings,
            core: { radius: 200, minHeight: 20, maxHeight: 100 },
          },
        }),
      /test rollback/,
    );
    assert.deepEqual(getKeyUnit(database, record.id), record);
    database.exec(
      "CREATE TRIGGER reject_key_unit_insert AFTER INSERT ON key_units BEGIN SELECT RAISE(ABORT, 'test rollback'); END",
    );
    assert.throws(() => createKeyUnit(database, values()), /test rollback/);
    assert.equal(listKeyUnits(database, {}).total, 1);
  } finally {
    database.close();
  }
});
