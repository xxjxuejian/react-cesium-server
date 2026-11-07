# React Cesium 独立后端

这是前端 `react-cesium-sandcastle` 的平级项目。采用 Node.js、TypeScript、Express 和 Node.js 内置的 SQLite。

## 当前完成范围

- 独立依赖、TypeScript 编译、开发热重载。
- `GET /api/health` 健康检查。
- 统一 JSON 响应、未知接口 404、非法 JSON 400、请求过大 413。
- 接口自动化测试与 ESLint。

- SQLite 数据库、编号迁移、管理员初始化、密码哈希与校验。

已接入真实登录、会话和管理员权限检查。

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

## 登录与前端联调

完成数据库迁移和管理员初始化后启动后端，再在前端运行 `pnpm dev:backend`。浏览器通过 Vite 的 `/api` 代理访问本机后端，登录使用自己初始化的账号。

| 方法和路径 | 用途 |
| --- | --- |
| POST `/api/auth/login` | 校验密码，返回随机令牌、用户资料和已开放路由 |
| GET `/api/auth/session` | 根据 Bearer 令牌恢复用户资料和路由 |
| POST `/api/auth/logout` | 撤销本次会话 |

`src/auth.ts` 中的 `requireLogin` 用令牌摘要查找未过期的会话，并确认账号仍启用。管理接口再经过 `requireAdmin`。认证失效返回 401，角色不足返回 403。会话固定有效 8 小时，刷新页面不会续期。登录限流按进程和请求来源计数，每分钟每个来源最多 12 次，全进程最多 120 次。

路由描述由 `src/available-routes.ts` 提供。普通用户只返回示例页面；管理员额外返回用户管理菜单。避难场所、航线和重点单位的真实接口仍待后续阶段实现。

## 用户管理与密码

阶段 3 已实现 GET/POST `/api/system-management/users`、PUT/DELETE `/api/system-management/users/:id`，以及 PUT `/api/system-management/users/:id/password`。全部要求有效会话和管理员身份。列表支持用户名、昵称、状态、部门、手机号筛选，page 默认 1、pageSize 默认 10，最多 100；按创建时间倒序、编号升序分页。

新增资料必须包含 username、nickname、status、gender、role 和 15～128 个字符的 password；department、phone、email 可省略并保存为空字符串。角色固定 admin/viewer。普通资料编辑不修改密码，重置接口只需提交 `{ password }`。返回资料不会包含密码哈希或会话数据，用户名冲突返回 409。

从 `src/app.ts` 进入 `src/modules/users/routes.ts`，路由读取请求并调用 `service.ts`；后者使用资料白名单、参数化 SQL 和事务，`types.ts` 解释业务字段。异步密码哈希后再次验证管理员当前身份，防止哈希期间停用或降级后仍能写入。

停用、删除和重置密码会撤销全部会话；重新启用需要重新登录。删除通过外键级联清理会话。最后一个启用管理员的删除、停用或降级会返回 409，检查与修改位于同一个 `BEGIN IMMEDIATE` 事务内。更新资料不会覆盖编号、创建时间或密码，响应时间按北京时间返回，数据库内部保存 UTC。

前端切换到 `frontend_single` 分支并运行 `pnpm dev:backend`。页面新增的账号可以真实登录；修改自身状态、角色或密码后前端重新恢复会话，及时更新路由或返回登录页。纯 Mock 模式仍独立维护演示列表，不会创建或修改登录账号。

## 阶段进度

- 阶段 0 已完成，提供 HTTP 骨架与健康检查。
- 阶段 1 已完成，提供 users、sessions 两张表以及迁移和账号初始化命令。数据库测试使用临时文件，验证了重复迁移、回滚、外键、唯一约束、密码校验和重启持久化。
- 阶段 2 已完成，真实登录、刷新恢复、退出和权限校验已通过接口测试和前端联调。
- 阶段 3 已完成，用户管理、初始密码、密码重置、会话撤销及最后一个管理员保护均已接通。
- 阶段 4 待开始，接入避难场所管理。

2026-11-07 验收：lint、typecheck、11 项测试及 build 通过；测试覆盖真实登录、CRUD 权限、筛选分页、白名单、停用、密码重置、最后一个管理员并发修改及事务回滚。前端 lint、38 项测试、build 通过；浏览器使用独立内存数据库验证页面新增账号可登录、普通用户无管理菜单和管理员重置自身密码后返回登录页。未读写开发数据库。

每阶段验收后提交一次代码。后端与前端分仓提交，阶段 1 的实现和验收记录在本仓库。
