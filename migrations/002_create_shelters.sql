-- 位置拆成普通数值列，设施数组以 JSON 文本整体保存。
-- 本迁移只新增避难场所表，不修改已有账号与会话数据。
CREATE TABLE shelters (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  facility_type TEXT NOT NULL CHECK (facility_type IN ('school','stadium','park','communityCenter','undergroundSpace','other')),
  shelter_usage TEXT NOT NULL CHECK (shelter_usage IN ('temporary','longTerm','medicalAid','supplyDistribution','comprehensive')),
  operation_status TEXT NOT NULL CHECK (operation_status IN ('open','full','maintenance','closed')),
  capacity INTEGER NOT NULL CHECK (capacity >= 0),
  available_capacity INTEGER NOT NULL CHECK (available_capacity >= 0 AND available_capacity <= capacity),
  facilities_json TEXT NOT NULL CHECK (json_valid(facilities_json)),
  address TEXT NOT NULL,
  longitude REAL NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  latitude REAL NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  height REAL,
  management_unit TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
