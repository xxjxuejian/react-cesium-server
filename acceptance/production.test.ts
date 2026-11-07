import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// 单独执行的生产验收使用编译产物和真实子进程，不依赖开发库、.env 或 Vite。
const root = fileURLToPath(new URL("../", import.meta.url));
const password = "production-test-only-password";

test(
  "空库初始化、四模块、重启、在线备份及恢复后的真实 HTTP 闭环",
  { timeout: 90_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "cesium-production-"));
    const source = join(directory, "app.db");
    const snapshot = join(directory, "backup.db");
    const recovered = join(directory, "recovered.db");
    const portReservation = createServer().listen(0, "127.0.0.1");
    await once(portReservation, "listening");
    const address = portReservation.address();
    assert.ok(address && typeof address !== "string");
    await new Promise<void>((resolve) =>
      portReservation.close(() => resolve()),
    );
    const url = `http://127.0.0.1:${address.port}/api`;
    let activePath = source;
    let child: ChildProcess | undefined;
    let output = "";
    const environment = () => ({
      ...process.env,
      DATABASE_PATH: activePath,
      HOST: "127.0.0.1",
      PORT: String(address.port),
      ADMIN_USERNAME: "acceptance-admin",
      ADMIN_PASSWORD: password,
    });
    function command(script: string, args: string[] = []) {
      const result = spawnSync(
        process.execPath,
        [join(root, "dist", "scripts", script + ".js"), ...args],
        {
          cwd: root,
          env: environment(),
          encoding: "utf8",
          timeout: 20_000,
        },
      );
      output += result.stdout + result.stderr;
      assert.equal(result.status, 0, `${script} 失败：${result.stderr}`);
    }
    async function start() {
      child = spawn(process.execPath, [join(root, "dist", "server.js")], {
        cwd: root,
        env: environment(),
      });
      child.stdout?.on("data", (data) => {
        output += String(data);
      });
      child.stderr?.on("data", (data) => {
        output += String(data);
      });
      for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null)
          throw new Error(`生产进程提前退出：${output}`);
        try {
          const response = await fetch(url + "/health", {
            signal: AbortSignal.timeout(500),
          });
          if (response.ok) return;
        } catch {
          /* 端口尚未就绪时稍后重试。 */
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("生产服务启动超时");
    }
    async function stop() {
      if (!child || child.exitCode !== null) return;
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
      child = undefined;
    }
    async function request(
      path: string,
      method = "GET",
      token?: string,
      body?: unknown,
    ) {
      const response = await fetch(url + path, {
        method,
        signal: AbortSignal.timeout(5000),
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await response.json();
      return { status: response.status, ...json };
    }
    const login = (username = "acceptance-admin", enteredPassword = password) =>
      request("/auth/login", "POST", undefined, {
        username,
        password: enteredPassword,
      });
    try {
      command("migrate");
      command("migrate");
      command("seed");
      command("seed");
      await start();
      assert.equal((await login("acceptance-admin", "wrong")).status, 401);
      const admin = await login();
      assert.equal(admin.status, 200);
      const token = admin.data.accessToken;
      assert.equal(
        admin.data.routes.find(
          (route: { path: string }) => route.path === "system-management",
        ).children.length,
        4,
      );
      assert.equal((await request("/auth/session", "GET", token)).status, 200);
      const userValues = {
        username: "acceptance-viewer",
        nickname: "验收用户",
        role: "viewer",
        status: "enabled",
        gender: "unknown",
        password,
      };
      const createdUser = await request(
        "/system-management/users",
        "POST",
        token,
        userValues,
      );
      assert.equal(createdUser.status, 200);
      const userId = createdUser.data.id;
      assert.equal(
        (await request("/system-management/users", "POST", token, userValues))
          .status,
        409,
      );
      const viewer = await login(userValues.username);
      assert.equal(viewer.status, 200);
      assert.ok(
        viewer.data.routes.every(
          (route: { path: string }) => route.path !== "system-management",
        ),
      );
      for (const module of ["users", "shelters", "airlines", "key-units"]) {
        assert.equal(
          (await request(`/system-management/${module}`)).status,
          401,
        );
        assert.equal(
          (
            await request(
              `/system-management/${module}`,
              "GET",
              viewer.data.accessToken,
            )
          ).status,
          403,
        );
      }
      const shelterValues = {
        name: "生产验收场所",
        facilityType: "school",
        shelterUsage: "temporary",
        operationStatus: "open",
        capacity: 100,
        availableCapacity: 80,
        facilities: [],
        address: "验收地址",
        location: { longitude: 120.2, latitude: 30.2 },
        managementUnit: "验收单位",
        contactName: "测试联系人",
        contactPhone: "13800000001",
      };
      const airlineValues = {
        name: "生产验收航线",
        speed: 10,
        waypoints: [
          { longitude: 120.2, latitude: 30.2, altitude: 50 },
          { longitude: 120.21, latitude: 30.21, altitude: 100 },
        ],
      };
      const keyUnitValues = {
        name: "生产验收重点单位",
        longitude: 120.2,
        latitude: 30.2,
        address: "验收地址",
        remark: "验收备注",
        rings: {
          core: { radius: 300, minHeight: 20, maxHeight: 120 },
          counter: { radius: 800, minHeight: 10, maxHeight: 200 },
          warning: { radius: 1500, minHeight: 0, maxHeight: 300 },
        },
      };
      // 三个模块都经过真实 API 创建、编辑、摘要、空查询和详情，保留结果以核对恢复。
      const expected = [];
      for (const [module, values] of [
        ["shelters", shelterValues],
        ["airlines", airlineValues],
        ["key-units", keyUnitValues],
      ] as const) {
        const path = `/system-management/${module}`;
        assert.equal((await request(path, "GET", token)).data.total, 0);
        const created = await request(path, "POST", token, values);
        assert.equal(created.status, 200);
        const detailPath = `${path}/${created.data.id}`;
        const edited = await request(detailPath, "PUT", token, {
          ...values,
          name: values.name + "已编辑",
        });
        assert.equal(edited.status, 200);
        const detail = await request(detailPath, "GET", token);
        assert.equal(detail.status, 200);
        assert.equal(detail.data.name, values.name + "已编辑");
        assert.equal(
          (await request(path + "?name=无此数据", "GET", token)).data.total,
          0,
        );
        assert.equal(
          (await request(path + "?page=2&pageSize=1", "GET", token)).data.list
            .length,
          0,
        );
        assert.equal(
          (await request(path + "?page=0", "GET", token)).status,
          400,
        );
        expected.push({ path: detailPath, record: detail.data });
      }
      // 停用、启用、重置密码都要影响真实登录及旧会话。
      assert.equal(
        (
          await request(`/system-management/users/${userId}`, "PUT", token, {
            ...userValues,
            status: "disabled",
          })
        ).status,
        200,
      );
      assert.equal(
        (await request("/auth/session", "GET", viewer.data.accessToken)).status,
        401,
      );
      assert.equal((await login(userValues.username)).status, 401);
      assert.equal(
        (
          await request(
            `/system-management/users/${userId}`,
            "PUT",
            token,
            userValues,
          )
        ).status,
        200,
      );
      const viewerAgain = await login(userValues.username);
      const newPassword = password + "-changed";
      assert.equal(
        (
          await request(
            `/system-management/users/${userId}/password`,
            "PUT",
            token,
            { password: newPassword },
          )
        ).status,
        200,
      );
      assert.equal(
        (await request("/auth/session", "GET", viewerAgain.data.accessToken))
          .status,
        401,
      );
      assert.equal((await login(userValues.username)).status, 401);
      assert.equal((await login(userValues.username, newPassword)).status, 200);
      assert.equal((await request("/missing")).status, 404);
      const malformed = await fetch(url + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      });
      assert.equal(malformed.status, 400);
      await malformed.arrayBuffer();
      assert.equal(
        (
          await request("/auth/login", "POST", undefined, {
            text: "x".repeat(1024 * 1024),
          })
        ).status,
        413,
      );
      // 真实运行中执行备份，而不是只测试没有打开连接的文件。
      command("backup", [snapshot]);
      await stop();
      await start();
      assert.equal((await request("/auth/session", "GET", token)).status, 200);
      for (const item of expected)
        assert.deepEqual(
          (await request(item.path, "GET", token)).data,
          item.record,
        );
      for (const item of expected)
        assert.equal((await request(item.path, "DELETE", token)).status, 200);
      for (const item of expected)
        assert.equal((await request(item.path, "GET", token)).status, 404);
      await stop();
      command("restore", [snapshot, recovered]);
      activePath = recovered;
      command("migrate");
      await start();
      assert.equal((await request("/auth/session", "GET", token)).status, 401);
      const restoredAdmin = await login();
      assert.equal(restoredAdmin.status, 200);
      const restoredToken = restoredAdmin.data.accessToken;
      for (const item of expected)
        assert.deepEqual(
          (await request(item.path, "GET", restoredToken)).data,
          item.record,
        );
      assert.equal((await login(userValues.username, newPassword)).status, 200);
      assert.equal(
        (
          await request(
            `/system-management/users/${userId}`,
            "DELETE",
            restoredToken,
          )
        ).status,
        200,
      );
      assert.equal((await login(userValues.username, newPassword)).status, 401);
      assert.equal(
        (await request("/auth/logout", "POST", restoredToken)).status,
        200,
      );
      assert.equal(
        (await request("/auth/session", "GET", restoredToken)).status,
        401,
      );
      // 进程与维护命令的输出都不能出现测试密码或实际生成的令牌。
      for (const secret of [
        password,
        newPassword,
        token,
        restoredToken,
        viewer.data.accessToken,
      ])
        assert.ok(!output.includes(secret));
    } finally {
      await stop();
      for (const filename of readdirSync(directory))
        unlinkSync(join(directory, filename));
      rmdirSync(directory);
    }
  },
);
