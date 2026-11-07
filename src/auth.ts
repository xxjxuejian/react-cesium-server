import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Router, type RequestHandler } from "express";

import { getAvailableRoutes } from "./available-routes.js";
import { verifyPassword } from "./password.js";

/** 可安全返回给浏览器的用户资料。 */
interface AuthUser {
  /** 用户在数据库中的唯一标识。 */
  id: string;
  /** 登录时使用的用户名。 */
  username: string;
  /** 页面显示的昵称。 */
  nickname: string;
  /** admin 为管理员，viewer 为普通用户。 */
  role: "admin" | "viewer";
}

const sessionLifetime = 8 * 60 * 60 * 1000;
// 无此账号时也做同等成本的密码计算，让错误响应不暴露账号是否存在。
const dummyPasswordHash = `scrypt$32768$8$3$${"0".repeat(32)}$${"0".repeat(128)}`;

function hashToken(token: string) {
  // 令牌由随机字节生成，已经有足够熵。数据库只需要 SHA-256 摘要来查找会话。
  return createHash("sha256").update(token).digest("hex");
}

export function requireLogin(database: DatabaseSync): RequestHandler {
  const findSession = database.prepare(`
    SELECT sessions.id AS sessionId, users.id, users.username, users.nickname, users.role
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.status = 'enabled'
  `);

  return (request, response, next) => {
    const token = /^Bearer ([\w-]{43})$/i.exec(request.get("Authorization") ?? "")?.[1];
    const session = token
      ? findSession.get(hashToken(token), new Date().toISOString())
      : undefined;
    if (!session) {
      response.set("WWW-Authenticate", "Bearer");
      response.status(401).json({ code: 10002, message: "登录状态已失效", data: null });
      return;
    }

    // 每次查当前用户的状态和角色。权限变更后，旧令牌不能继续沿用之前的角色。
    const { sessionId, id, username, nickname, role } = session;
    response.locals.sessionId = sessionId;
    response.locals.user = { id, username, nickname, role };
    next();
  };
}

// 管理接口依次使用 requireLogin、requireAdmin；不能仅依赖前端菜单隐藏。
export const requireAdmin: RequestHandler = (_request, response, next) => {
  const user = response.locals.user as AuthUser | undefined;
  if (!user) {
    response.set("WWW-Authenticate", "Bearer");
    response.status(401).json({ code: 10002, message: "登录状态已失效", data: null });
    return;
  }
  if (user.role !== "admin") {
    response.status(403).json({ code: 40300, message: "没有管理员权限", data: null });
    return;
  }
  next();
};

export function createAuthRouter(database: DatabaseSync) {
  const router = Router();
  const authenticate = requireLogin(database);
  const findUser = database.prepare(
    "SELECT id, username, nickname, role, status, password_hash FROM users WHERE username = ?",
  );
  const createSession = database.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
    SELECT ?, id, ?, ?, ? FROM users WHERE id = ? AND status = 'enabled' AND password_hash = ?
  `);
  const deleteSession = database.prepare("DELETE FROM sessions WHERE id = ?");
  const deleteExpiredSessions = database.prepare("DELETE FROM sessions WHERE expires_at <= ?");

  // 小型单进程服务用固定窗口限流。限制单个 IP，也限制全局总数，避免哈希任务堆积。
  const loginAttempts = new Map<string, number>();
  let windowEndsAt = 0;
  let totalAttempts = 0;

  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  router.post("/login", async (request, response) => {
    const now = Date.now();
    if (now >= windowEndsAt) {
      loginAttempts.clear();
      windowEndsAt = now + 60_000;
      totalAttempts = 0;
    }
    const ip = request.ip ?? request.socket.remoteAddress ?? "unknown";
    const attempts = loginAttempts.get(ip) ?? 0;
    if (attempts >= 12 || totalAttempts >= 120) {
      response.set("Retry-After", String(Math.ceil((windowEndsAt - now) / 1000)));
      response.status(429).json({ code: 42900, message: "登录尝试过多，请稍后重试", data: null });
      return;
    }
    loginAttempts.set(ip, attempts + 1);
    totalAttempts += 1;

    const username = typeof request.body?.username === "string" ? request.body.username.trim() : "";
    const password = request.body?.password;
    if (!username || username.length > 64 ||
        typeof password !== "string" || !password || password.length > 128) {
      response.status(400).json({ code: 40000, message: "请输入有效的用户名和密码", data: null });
      return;
    }

    const account = findUser.get(username);
    const passwordHash = typeof account?.password_hash === "string"
      ? account.password_hash
      : dummyPasswordHash;
    const passwordMatches = await verifyPassword(password, passwordHash);
    if (!account || account.status !== "enabled" || !passwordMatches) {
      response.status(401).json({ code: 10001, message: "用户名或密码错误", data: null });
      return;
    }

    // 密码校验是异步的。写入时再检查账号未停用、密码未变化，防止创建无效会话。
    const accessToken = randomBytes(32).toString("base64url");
    const issuedAt = Date.now();
    const createdAt = new Date(issuedAt).toISOString();
    const expiresAt = new Date(issuedAt + sessionLifetime).toISOString();
    deleteExpiredSessions.run(createdAt);
    const inserted = createSession.run(
      randomUUID(), hashToken(accessToken), expiresAt, createdAt, account.id, passwordHash,
    );
    if (Number(inserted.changes) === 0) {
      response.status(401).json({ code: 10001, message: "用户名或密码错误", data: null });
      return;
    }

    // 异步密码计算期间资料或角色可能改变，按编号读取最新记录，避免沿用旧权限。
    const { id, username: currentUsername, nickname, role } = database.prepare(
      "SELECT id, username, nickname, role FROM users WHERE id = ?",
    ).get(account.id)!;
    response.json({
      code: 0,
      message: "登录成功",
      data: { accessToken, user: { id, username: currentUsername, nickname, role }, routes: getAvailableRoutes(String(role)) },
    });
  });

  router.get("/session", authenticate, (_request, response) => {
    response.json({
      code: 0,
      message: "获取登录用户成功",
      data: { user: response.locals.user, routes: getAvailableRoutes(String(response.locals.user.role)) },
    });
  });

  router.post("/logout", authenticate, (_request, response) => {
    // 删除服务端记录。即使旧令牌仍留在别处，也不能再用于恢复登录。
    deleteSession.run(response.locals.sessionId);
    response.json({ code: 0, message: "退出成功", data: true });
  });

  return router;
}
