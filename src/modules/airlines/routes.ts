import { Router, type ErrorRequestHandler } from "express";
import type { DatabaseSync } from "node:sqlite";
import { requireAdmin, requireLogin } from "../../auth.js";
import {
  AirlineError,
  createAirline,
  deleteAirline,
  getAirline,
  listAirlines,
  updateAirline,
} from "./service.js";

export function createAirlinesRouter(database: DatabaseSync) {
  const router = Router();
  router.use(requireLogin(database), requireAdmin);
  router.get("/", (request, response) => {
    response.json({
      code: 0,
      message: "查询航线列表成功",
      data: listAirlines(database, request.query),
    });
  });
  router.get("/:id", (request, response) => {
    response.json({
      code: 0,
      message: "查询航线详情成功",
      data: getAirline(database, String(request.params.id)),
    });
  });
  router.post("/", (request, response) => {
    response.json({
      code: 0,
      message: "新增航线成功",
      data: createAirline(database, request.body),
    });
  });
  router.put("/:id", (request, response) => {
    response.json({
      code: 0,
      message: "更新航线成功",
      data: updateAirline(database, String(request.params.id), request.body),
    });
  });
  router.delete("/:id", (request, response) => {
    response.json({
      code: 0,
      message: "删除航线成功",
      data: deleteAirline(database, String(request.params.id)),
    });
  });
  const handleAirlineError: ErrorRequestHandler = (
    error: unknown,
    _request,
    response,
    next,
  ) => {
    if (!(error instanceof AirlineError)) return next(error);
    response
      .status(error.status)
      .json({
        code: error.status === 404 ? 40403 : 40003,
        message: error.message,
        data: null,
      });
  };
  router.use(handleAirlineError);
  return router;
}
