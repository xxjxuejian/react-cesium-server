import express from "express";
import type { ErrorRequestHandler } from "express";

// app 只定义请求处理规则，不占用端口，测试也可以直接使用它。
export const app = express();
app.disable("x-powered-by");
// 后续表单以 JSON 提交；限制请求体大小，避免无限制接收数据。
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  // 当前仅检查 HTTP 服务存活，尚未连接数据库。
  response.json({
    code: 0,
    message: "服务运行正常",
    data: { status: "ok", service: "react-cesium-server" },
  });
});

// 放在所有业务接口之后，未匹配的地址统一返回 JSON，而不是 HTML。
app.use((_request, response) => {
  response.status(404).json({
    code: 40400,
    message: "接口不存在",
    data: null,
  });
});

// Express 通过四个参数识别错误处理中间件，_next 即使未使用也需要保留。
const handleError: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  _next,
) => {
  // JSON 解析发生在接口之前；格式错误和体积超限都属于客户端请求问题。
  const errorType =
    typeof error === "object" && error !== null && "type" in error
      ? error.type
      : undefined;
  if (errorType === "entity.parse.failed") {
    response.status(400).json({
      code: 40000,
      message: "请求体必须是合法的 JSON",
      data: null,
    });
    return;
  }
  if (errorType === "entity.too.large") {
    response.status(413).json({
      code: 41300,
      message: "请求体不能超过 1 MB",
      data: null,
    });
    return;
  }

  // 不记录请求体，避免未来密码等敏感字段进入日志。
  console.error("请求处理失败：", error instanceof Error ? error.message : "未知错误");
  response.status(500).json({
    code: 50000,
    message: "服务器内部错误",
    data: null,
  });
};
app.use(handleError);
