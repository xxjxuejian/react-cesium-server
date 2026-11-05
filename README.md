# React Cesium 独立后端

这是前端 `react-cesium-sandcastle` 的平级项目。采用 Node.js、TypeScript、Express 和 Node.js 内置的 SQLite。

## 当前完成范围

- 独立依赖、TypeScript 编译、开发热重载。
- `GET /api/health` 健康检查。
- 统一 JSON 响应、未知接口 404、非法 JSON 400、请求过大 413。
- 接口自动化测试与 ESLint。

- SQLite 数据库、编号迁移、管理员初始化、密码哈希与校验。

阶段 1 提供数据库和初始账号。登录和权限接口将在阶段 2 接入。

## 本地启动

环境：Node.js >= 22.20.0，pnpm 11.1.1。在本目录执行：

```powershell
pnpm install
# 可选：不复制时使用默认端口 3000 和本机地址 127.0.0.1。
Copy-Item .env.example .env
pnpm db:migrate
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

## 数据库迁移与管理员初始化

1. `pnpm db:migrate` 创建 `data/app.db`，执行 `migrations/` 中的编号 SQL。迁移记录与表结构在同一事务内提交，重复运行会跳过已完成的文件。已应用的 SQL 文件应保留，表结构变动通过新文件追加。
2. 在本地 `.env` 中填写 ADMIN_PASSWORD，长度为 15～128 个字符。可设置 ADMIN_USERNAME，省略时使用 admin。
3. 运行 `pnpm db:seed` 创建初始管理员。已有管理员时跳过。初始化后可从 `.env` 中移除 ADMIN_PASSWORD。
4. `pnpm dev` 或 `pnpm start` 先检查迁移记录，再启动 HTTP 服务。若提示数据库未就绪，先运行迁移。

DATABASE_PATH 可以是绝对路径或相对于后端项目根目录的路径，默认 data/app.db。使用默认目录时，数据库文件与本地 `.env` 均被 Git 忽略。

`src/db.ts` 负责打开连接和执行迁移。迁移文件留在项目根目录的 migrations 下，源码和编译产物都从这里读取。部署时应一起保留 migrations 目录。使用 Node.js 22.20.0 时，内置 SQLite 会打印实验特性提示。参见 [Node.js SQLite 文档](https://nodejs.org/download/release/v22.20.0/docs/api/sqlite.html)。

`src/scripts/seed.ts` 读取配置，`src/initialize-admin.ts` 校验参数并写入 users 表。密码由 `src/password.ts` 使用随机盐和异步 scrypt 派生，数据库存储参数、盐和派生结果。参数参见 [OWASP 密码存储指南](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt)。

## 阶段进度

- 阶段 0 已完成，提供 HTTP 骨架与健康检查。
- 阶段 1 已完成，提供 users、sessions 两张表以及迁移和账号初始化命令。数据库测试使用临时文件，验证了重复迁移、回滚、外键、唯一约束、密码校验和重启持久化。
- 阶段 2 待开始，接入登录、会话、退出、按角色返回路由，并联调前端。

每阶段验收后提交一次代码。后端与前端分仓提交，阶段 1 的实现和验收记录在本仓库。
