import { Router, type ErrorRequestHandler } from "express";
import type { DatabaseSync } from "node:sqlite";
import { requireAdmin, requireLogin } from "../../auth.js";
import {
  createKeyUnit,
  deleteKeyUnit,
  getKeyUnit,
  KeyUnitError,
  listKeyUnits,
  updateKeyUnit,
} from "./service.js";

export function createKeyUnitsRouter(database: DatabaseSync) {
  const router = Router();
  router.use(requireLogin(database), requireAdmin);
  router.get("/", (request, response) => {
    response.json({
      code: 0,
      message: "查询重点单位列表成功",
      data: listKeyUnits(database, request.query),
    });
  });
  router.get("/:id", (request, response) => {
    response.json({
      code: 0,
      message: "查询重点单位详情成功",
      data: getKeyUnit(database, String(request.params.id)),
    });
  });
  router.post("/", (request, response) => {
    response.json({
      code: 0,
      message: "新增重点单位成功",
      data: createKeyUnit(database, request.body),
    });
  });
  router.put("/:id", (request, response) => {
    response.json({
      code: 0,
      message: "更新重点单位成功",
      data: updateKeyUnit(database, String(request.params.id), request.body),
    });
  });
  router.delete("/:id", (request, response) => {
    response.json({
      code: 0,
      message: "删除重点单位成功",
      data: deleteKeyUnit(database, String(request.params.id)),
    });
  });
  const handleKeyUnitError: ErrorRequestHandler = (
    error: unknown,
    _request,
    response,
    next,
  ) => {
    if (!(error instanceof KeyUnitError)) return next(error);
    response
      .status(error.status)
      .json({
        code: error.status === 404 ? 40404 : 40004,
        message: error.message,
        data: null,
      });
  };
  router.use(handleKeyUnitError);
  return router;
}
