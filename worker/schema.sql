-- EV-Charger D1 schema (PRD: "D1 schema")
-- ใช้ได้ซ้ำ (IF NOT EXISTS): wrangler d1 execute DB --local --file=worker/schema.sql

CREATE TABLE IF NOT EXISTS stations (
  id TEXT PRIMARY KEY,                 -- 'mymaps:<hash>' | 'user:<uuid>'
  source TEXT NOT NULL CHECK (source IN ('mymaps', 'user')),
  name TEXT NOT NULL,                  -- ชื่อไทย
  name_en TEXT,
  address TEXT,
  hours TEXT,
  operator TEXT,                       -- ชื่อมาตรฐาน (normalize.ts)
  operator_raw TEXT,                   -- ค่า Provider ดิบ
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  connectors_json TEXT NOT NULL DEFAULT '[]',
  raw_json TEXT,                       -- ExtendedData ดิบ (Operator, Dealership, Power, layer ...)
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_by TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_stations_lat_lng ON stations (lat, lng);

-- override ผูกกับ station id ตรง ๆ (ไม่มี FK: orphan ต้องเก็บไว้ ตาม ADR 0002)
CREATE TABLE IF NOT EXISTS station_overrides (
  station_id TEXT PRIMARY KEY,
  name TEXT,
  operator TEXT,
  connectors_json TEXT,
  edited_by TEXT,
  edited_at TEXT NOT NULL
);

-- rate limit การเขียน 30 ครั้ง/ชม./IP (fixed window รายชั่วโมง)
CREATE TABLE IF NOT EXISTS rate_limits (
  ip TEXT NOT NULL,
  window TEXT NOT NULL,                -- 'YYYY-MM-DDTHH' UTC
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, window)
);
