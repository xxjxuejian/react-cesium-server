-- 三个圈共用一个中心，圈层参数整体保存为 JSON，不与航线或避难场所建立删除关联。
CREATE TABLE key_units (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  longitude REAL NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  latitude REAL NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  address TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  rings_json TEXT NOT NULL CHECK (json_valid(rings_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
