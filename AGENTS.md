# 后端项目协作约定

本项目用于前端开发者学习 Node.js 后端，默认使用中文回复和中文说明。

- 可读性优先，按实际执行顺序写代码，避免通用 CRUD 基类、多余封装和复杂泛型。
- 拆分文件或引入架构前，说明解决的问题和增加的理解成本。
- 使用 TypeScript、ES Modules、pnpm；新增类型及字段补充中文 JSDoc。
- 关键流程补充中文注释，尤其是请求处理、数据库事务、密码与会话、资源清理。
- 保持前端现有接口路径和 { code, message, data } 契约；变更契约时同步文档。
- 不提交密码、token、.env、数据库文件、node_modules 或 dist。
- 提交前运行 pnpm lint、pnpm typecheck、pnpm test、pnpm build。
- 当前只实现 HTTP 骨架；下一步是 SQLite 连接、迁移和管理员初始化，详见 README.md。
