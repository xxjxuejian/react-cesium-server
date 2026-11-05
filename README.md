# React Cesium 独立后端

这是前端 `react-cesium-sandcastle` 的平级项目。采用 Node.js、TypeScript 和 Express；SQLite 将在下一步接入。

## 当前完成范围

- 独立依赖、TypeScript 编译、开发热重载。
- `GET /api/health` 健康检查。
- 统一 JSON 响应、未知接口 404、非法 JSON 400、请求过大 413。
- 接口自动化测试与 ESLint。

目前没有数据库、登录、权限或业务 CRUD。前端仍然使用原来的 Mock，健康检查成功仅代表 HTTP 服务可以运行。

## 本地启动

环境：Node.js >= 22.20.0，pnpm 11.1.1。在本目录执行：

```powershell
pnpm install
# 可选：不复制时使用默认端口 3000 和本机地址 127.0.0.1。
Copy-Item .env.example .env
pnpm dev
```

浏览器打开 http://127.0.0.1:3000/api/health，或在另一个终端执行：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

生产构建与本地验证：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

`dev` 和 `start` 都会读取可选的 `.env`；默认使用同一端口，不要同时启动。Ctrl+C 停止服务。

## 从哪里开始读代码

1. `src/server.ts` 是入口，读取端口配置并开始监听。
2. `src/app.ts` 按顺序解析 JSON、匹配接口、处理 404 和错误。
3. 请求 `GET /api/health` 时，匹配到健康检查处理函数，返回 `{ code, message, data }`。
4. `tests/health.test.ts` 在随机端口启动同一个 app，通过真实 HTTP 请求验证响应。

把 app 与监听入口分开，是为了测试时能使用随机端口；暂不增加更多目录或抽象层。

## 下一步：建立数据库基础

这是开始登录模块之前的第一项任务，按以下顺序实施：

1. 核验并安装兼容当前 Node.js 的 SQLite 驱动，建立 `src/db.ts`，数据库保存在 `data/app.db`。
2. 增加 DATABASE_PATH 配置、迁移记录及 `db:migrate` 命令；先创建 users、sessions 两张表。
3. users 保存账号资料及带随机盐的密码哈希；sessions 保存 token 哈希和有效期，登录与用户管理共用 users。
4. 增加 `db:seed` 命令，显式初始化管理员；密码由本地输入或环境变量提供，不写入代码，不在每次启动时覆盖数据。
5. 验证重复迁移不会重复建表，重启后数据仍存在，初始化不会覆盖已有管理员。

数据库基础通过后，再实现 login、session、logout 和按角色返回的路由配置。直到对应真实接口完成联调，才关闭前端 Mock 并设置 Vite 的 /api 代理。

数据库及环境文件已加入 Git 忽略清单；本阶段没有配置远程仓库或提交代码。
