-- 航点整体存 JSON，数量和水平长度由后端计算后与资料同时写入。
-- 新增独立表，保留既有账号、会话及避难场所。
CREATE TABLE airlines (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  speed REAL NOT NULL CHECK (speed > 0),
  remark TEXT NOT NULL DEFAULT '',
  waypoints_json TEXT NOT NULL CHECK (json_valid(waypoints_json)),
  waypoint_count INTEGER NOT NULL CHECK (waypoint_count >= 2 AND waypoint_count <= 1000),
  length REAL NOT NULL CHECK (length >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
