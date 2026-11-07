import { Router, type ErrorRequestHandler } from "express";
import type { DatabaseSync } from "node:sqlite";
import { requireAdmin, requireLogin } from "../../auth.js";
import {
  createShelter,
  deleteShelter,
  getShelter,
  listShelters,
  ShelterError,
  updateShelter,
} from "./service.js";

export function createSheltersRouter(database: DatabaseSync) {
  const router = Router();
  router.use(requireLogin(database), requireAdmin);
  router.get("/", (request, response) => {
    response.json({
      code: 0,
      message: "查询避难场所列表成功",
      data: listShelters(database, request.query),
    });
  });
  router.get("/:id", (request, response) => {
    response.json({
      code: 0,
      message: "查询避难场所详情成功",
      data: getShelter(database, String(request.params.id)),
    });
  });
  router.post("/", (request, response) => {
    response.json({
      code: 0,
      message: "新增避难场所成功",
      data: createShelter(database, request.body),
    });
  });
  router.put("/:id", (request, response) => {
    response.json({
      code: 0,
      message: "更新避难场所成功",
      data: updateShelter(database, String(request.params.id), request.body),
    });
  });
  router.delete("/:id", (request, response) => {
    response.json({
      code: 0,
      message: "删除避难场所成功",
      data: deleteShelter(database, String(request.params.id)),
    });
  });
  const handleShelterError: ErrorRequestHandler = (
    error: unknown,
    _request,
    response,
    next,
  ) => {
    if (!(error instanceof ShelterError)) return next(error);
    response
      .status(error.status)
      .json({
        code: error.status === 404 ? 40402 : 40002,
        message: error.message,
        data: null,
      });
  };
  router.use(handleShelterError);
  return router;
}
