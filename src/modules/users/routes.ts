import { Router, type ErrorRequestHandler } from "express";
import type { DatabaseSync } from "node:sqlite";
import { requireAdmin, requireLogin } from "../../auth.js";
import { hashPassword } from "../../password.js";
import {
  createUser,
  deleteUser,
  listUsers,
  readBody,
  resetPassword,
  updateUser,
  UserError,
  validatePassword,
  validateValues,
} from "./service.js";
import type { UserValues } from "./types.js";

export function createUsersRouter(database: DatabaseSync) {
  const router = Router();
  const authenticate = requireLogin(database);
  router.use(authenticate, requireAdmin);
  router.get("/", (request, response) => {
    response.json({
      code: 0,
      message: "查询用户列表成功",
      data: listUsers(database, request.query),
    });
  });
  router.post(
    "/",
    async (request, response, next) => {
      response.locals.values = validateValues(request.body);
      response.locals.passwordHash = await hashPassword(
        validatePassword(readBody(request.body).password),
      );
      next();
    },
    authenticate,
    requireAdmin,
    (_request, response) => {
      // 哈希期间管理员可能被停用或降级，因此写数据库之前再次校验当前会话。
      const data = createUser(
        database,
        response.locals.values as UserValues,
        response.locals.passwordHash as string,
      );
      response.json({ code: 0, message: "新增用户成功", data });
    },
  );
  router.put(
    "/:id/password",
    async (request, response, next) => {
      response.locals.passwordHash = await hashPassword(
        validatePassword(readBody(request.body).password),
      );
      next();
    },
    authenticate,
    requireAdmin,
    (request, response) => {
      response.json({
        code: 0,
        message: "重置密码成功，请使用新密码重新登录",
        data: resetPassword(
          database,
          String(request.params.id),
          response.locals.passwordHash as string,
        ),
      });
    },
  );
  router.put("/:id", (request, response) => {
    response.json({
      code: 0,
      message: "更新用户成功",
      data: updateUser(
        database,
        String(request.params.id),
        validateValues(request.body),
      ),
    });
  });
  router.delete("/:id", (request, response) => {
    response.json({
      code: 0,
      message: "删除用户成功",
      data: deleteUser(database, String(request.params.id)),
    });
  });
  const handleUserError: ErrorRequestHandler = (
    error: unknown,
    _request,
    response,
    next,
  ) => {
    if (!(error instanceof UserError)) return next(error);
    response
      .status(error.status)
      .json({
        code: error.status * 100 + (error.status === 404 ? 1 : 0),
        message: error.message,
        data: null,
      });
  };
  router.use(handleUserError);
  return router;
}
