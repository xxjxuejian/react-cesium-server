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

完成数据库迁移和管理员初始化后启动后端，再在前端运行 `pnpm dev`。浏览器通过 Vite 的 `/api` 代理访问本机后端，登录使用自己初始化的账号。

| 方法和路径 | 用途 |
| --- | --- |
| POST `/api/auth/login` | 校验密码，返回随机令牌、用户资料和已开放路由 |
| GET `/api/auth/session` | 根据 Bearer 令牌恢复用户资料和路由 |
| POST `/api/auth/logout` | 撤销本次会话 |

`src/auth.ts` 中的 `requireLogin` 用令牌摘要查找未过期的会话，并确认账号仍启用。管理接口再经过 `requireAdmin`。认证失效返回 401，角色不足返回 403。会话固定有效 8 小时，刷新页面不会续期。登录限流按进程和请求来源计数，每分钟每个来源最多 12 次，全进程最多 120 次。

路由描述由 `src/available-routes.ts` 提供。普通用户只返回示例页面；管理员额外返回用户、避难场所、航线和重点单位四个管理菜单。四个管理模块的真实接口均已实现，阶段 7 已完成本地完整验收、备份恢复和部署准备，实际服务器发布仍待目标环境具备后验证。

## 用户管理与密码

阶段 3 已实现 GET/POST `/api/system-management/users`、PUT/DELETE `/api/system-management/users/:id`，以及 PUT `/api/system-management/users/:id/password`。全部要求有效会话和管理员身份。列表支持用户名、昵称、状态、部门、手机号筛选，page 默认 1、pageSize 默认 10，最多 100；按创建时间倒序、编号升序分页。

新增资料必须包含 username、nickname、status、gender、role 和 15～128 个字符的 password；department、phone、email 可省略并保存为空字符串。角色固定 admin/viewer。普通资料编辑不修改密码，重置接口只需提交 `{ password }`。返回资料不会包含密码哈希或会话数据，用户名冲突返回 409。

从 `src/app.ts` 进入 `src/modules/users/routes.ts`，路由读取请求并调用 `service.ts`；后者使用资料白名单、参数化 SQL 和事务，`types.ts` 解释业务字段。异步密码哈希后再次验证管理员当前身份，防止哈希期间停用或降级后仍能写入。

停用、删除和重置密码会撤销全部会话；重新启用需要重新登录。删除通过外键级联清理会话。最后一个启用管理员的删除、停用或降级会返回 409，检查与修改位于同一个 `BEGIN IMMEDIATE` 事务内。更新资料不会覆盖编号、创建时间或密码，响应时间按北京时间返回，数据库内部保存 UTC。

前端切换到 `frontend_single` 分支并运行 `pnpm dev`。页面新增的账号可以真实登录；修改自身状态、角色或密码后前端重新恢复会话，及时更新路由或返回登录页。该前端分支已移除运行时 Mock，默认开发命令直接连接真实后端。

## 阶段进度

- 阶段 0 已完成，提供 HTTP 骨架与健康检查。
- 阶段 1 已完成，提供 users、sessions 两张表以及迁移和账号初始化命令。数据库测试使用临时文件，验证了重复迁移、回滚、外键、唯一约束、密码校验和重启持久化。
- 阶段 2 已完成，真实登录、刷新恢复、退出和权限校验已通过接口测试和前端联调。
- 阶段 3 已完成，用户管理、初始密码、密码重置、会话撤销及最后一个管理员保护均已接通。
- 阶段 4 已完成，避难场所五个真实接口、数据库迁移及前端联调通过。
- 阶段 5 已完成，航线五个真实接口、持久化、后端长度计算及地图联调通过。
- 阶段 6 已完成，重点单位五个真实接口、三层包含校验、持久化与地图联调通过。
- 阶段 7 已完成本地全流程验收、备份恢复与部署准备；实际服务器发布尚未执行。

2026-11-07 阶段 3 验收：lint、typecheck、11 项测试及 build 通过；测试覆盖真实登录、CRUD 权限、筛选分页、白名单、停用、密码重置、最后一个管理员并发修改及事务回滚。前端 lint、38 项测试、build 通过；浏览器使用独立内存数据库验证页面新增账号可登录、普通用户无管理菜单和管理员重置自身密码后返回登录页。未读写开发数据库。

每阶段验收后提交一次代码。后端与前端分仓提交，阶段 1 的实现和验收记录在本仓库。

## 避难场所管理

阶段 4 新增迁移 migrations/002_create_shelters.sql，只增加 shelters 表，保留账号、会话和旧迁移记录。升级先运行 pnpm db:migrate，再启动后端。新库的场所列表为空，不自动写演示数据。

已提供 GET/POST /api/system-management/shelters 与 GET/PUT/DELETE /api/system-management/shelters/:id，全部要求有效会话及管理员角色。列表支持名称、形态、用途、状态、管理单位与地址筛选，按更新时间倒序、编号升序分页，pageSize 为 1～100。列表与详情均返回完整资料。

src/modules/shelters/routes.ts 处理 HTTP 与权限，service.ts 执行业务校验及参数化 SQL，types.ts 说明资料含义与单位。位置拆列保存后还原为 location，设施数组存 JSON 文本。每次新增和更新用一条 SQL 整体写入，系统编号和时间不接受客户端覆盖。

容量必须为非负安全整数，可用容量不大于总容量；经纬度须为有限数值且在合法范围内，null 不能转为零。高度可省略或传 null 清空，备注可省略、null 或空白清空，数据库存 NULL，响应省略。名称允许重复，设施允许空数组且不能包含重复或非法编码。名称最多 100 字符，地址 500，管理单位 100，联系人 64，备注 2000；联系电话为 1 开头的 11 位手机号。其余枚举与前端类型保持一致。

2026-11-07 阶段 4 验收：lint、typecheck、16 项测试与 build 通过；新增测试验证全部接口权限、CRUD、全部筛选、分页、字段保护、可选值、非法参数、旧库升级和重启持久化。前端 lint、11 项测试、build 通过，浏览器以独立内存数据库验证新增、详情、编辑、刷新、查询、删除、非法容量和真实错误后保留草稿再重试。开发库只执行新增表迁移，测试场所不写入开发库。

## 重点单位管理

阶段 6 新增迁移 `migrations/004_create_key_units.sql`，只建立 key_units 表，保留用户、会话、避难场所和航线。升级先运行 `pnpm db:migrate`，再启动后端。新表不放演示数据。

接口为 GET/POST `/api/system-management/key-units` 及 GET/PUT/DELETE `/api/system-management/key-units/:id`，均要求有效会话及管理员角色。参数错误为 HTTP 400、code 40004，不存在为 HTTP 404、code 40404。列表返回共同中心和圈层摘要，不读取备注、创建时间；详情返回完整记录。名称普通子串匹配，忽略英文大小写，按更新时间倒序、编号升序分页；pageSize 为 1～100。

从 `src/app.ts` 进入 `src/modules/key-units/routes.ts`，路由检查权限；`service.ts` 独立校验资料、转换 JSON 及执行参数化 SQL，`types.ts` 说明三层参数和摘要、详情字段。名称最多 100、位置描述 500、备注 2000 个字符，后两者未填写时提交空字符串。经纬度为 WGS84，必须是范围内的有限数值，null 不能当成零；三层恰好为 core、counter、warning，半径严格递增，高度相对统一零平面且满足 0 ≤ minHeight < maxHeight，外层高度区间包含内层，允许公共高度边界。

共同中心及完整 rings_json 在单条 SQL 内保存，失败整体回滚。后端生成编号与时间并保护系统字段，更新保留 id、created_at。删除重点单位不会删除航线或避难场所。三层颜色由前端维护，仅区分类型，不代表告警。前端对极大范围跳过预览的限制不改变后端业务规则。

2026-11-07 阶段 6 验收：lint、typecheck、28 项测试、build 通过；新增 6 项测试覆盖全部接口权限、四个管理菜单、三层全部包含约束、CRUD、分页、字段保护、旧库升级、重启持久化、删除隔离及原子写入回滚。前端 lint、12 项测试、build 和 7 项重点单位页面回归通过。真实浏览器用独立内存数据库验证地图选点、半径调整取消、同一画布二维/三维切换、预览、保存刷新、只读零写请求、编辑、真实 400 后草稿保留与重试、取消新增、查询及删除。开发库只执行新增表迁移，验收不写测试单位。

## 航线管理

阶段 5 新增迁移 `migrations/003_create_airlines.sql`，只建立 airlines 表，保留已有账号、会话和避难场所。升级先执行 `pnpm db:migrate`，再启动后端。新表不放演示数据。

接口为 GET/POST `/api/system-management/airlines` 及 GET/PUT/DELETE `/api/system-management/airlines/:id`，均要求有效会话与管理员角色。列表仅返回 id、name、waypointCount、length、speed、updatedAt，按名称筛选并按更新时间倒序、编号升序分页；详情返回完整航点、备注和创建时间。参数错误为 HTTP 400、code 40003，记录不存在为 HTTP 404、code 40403。

从 `src/app.ts` 进入 `src/modules/airlines/routes.ts`，路由检查权限并读取请求；`service.ts` 校验资料、生成序号、计算长度及执行 SQL，`types.ts` 说明字段与单位。名称为 1～100 个字符，备注最多 2000 个字符，航点 2～1000 个。速度必须大于零，经纬度必须为合法有限数值，高度为相对统一地面零平面的非负有限数值。null、字符串和缺失值不能转换成零；相邻航点不能经纬度和高度三项完全一致，但允许垂直升降、交叉与手动闭合。

使用 Haversine 算法和平均地球半径 6371008.8 米累加相邻点水平距离，不计高度差，不自动闭合。服务端独立计算 length、waypointCount、order，不接受客户端覆盖系统字段。waypoints_json 与计算摘要在单条 SQL 中写入，失败整体回滚；PUT 整体替换航点并保留 id、created_at，时间按北京时间格式返回。

2026-11-07 阶段 5 验收：lint、typecheck、22 项测试与 build 通过。新增 6 项测试覆盖权限、摘要与详情、CRUD、全部参数边界、长度参考值、垂直升降、1000 航点边界、旧库升级、持久化及失败写入回滚。前端 lint、11 项测试、build 与 6 项航线页面回归通过；真实浏览器以独立内存数据库验证地图绘制、拖动、批量高度、排序、保存、刷新、查看、编辑、筛选、删除、保存失败保留草稿及取消不写库。开发库只应用新增表迁移，验收不写测试航线。


## 全流程验收、备份恢复与部署

阶段 7 新增 `pnpm test:production`，先构建，再在独立临时数据库和真实编译后进程中验证空库迁移、管理员初始化、登录权限、四模块操作、重启、运行中备份及恢复。不会读取开发 `.env` 或修改开发数据。

```powershell
pnpm test:production
# 在后端项目根目录执行，目标文件必须不存在。
pnpm db:backup D:/cesium-backups/before-upgrade.db
# 恢复前停止后端，恢复目标使用新文件，原库和备份保留。
pnpm db:restore D:/cesium-backups/before-upgrade.db D:/cesium-data/restored.db
```

备份通过 SQLite 一致性快照包含 WAL 中已提交的数据，并检查完整性及外键；命令拒绝覆盖目标和已有日志。恢复后清空恢复库中的会话，要求用户重新登录。恢复命令不自动切换服务：需将 `DATABASE_PATH` 指向新文件，再运行迁移和启动，并核对业务数据。

生产环境只有生产依赖时，使用 `node --env-file-if-exists=.env dist/scripts/backup.js <目标>` 和 `node dist/scripts/restore.js <备份> <新目标>`，无需安装 `tsx`。生产迁移和管理员初始化也可运行对应 `dist/scripts/migrate.js`、`seed.js`。

完整说明见[单实例部署与备份恢复](docs/单实例部署与备份恢复.md)，实际执行结果与限制见[阶段 7 验收记录](docs/阶段7验收记录.md)。本轮后端 lint、typecheck、31 项测试、build 及独立生产流程通过；前端 lint、12 项基础测试、27 项页面与地图工具回归和 build 通过，真实浏览器验证生产静态文件与真实后端的完整流程。

当前只验证本地单实例。Nginx、HTTPS、systemd、防火墙和开机恢复需在目标服务器验证，不代表已完成发布。
