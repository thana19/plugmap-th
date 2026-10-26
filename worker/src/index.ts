// Worker router (PRD: API) — static assets ถูกเสิร์ฟก่อนโดย Workers Static Assets
// request ที่ไม่ตรงไฟล์ใน public/ ตกมาที่นี่

import { checkPin, clientIp, consumeWriteQuota } from "./auth";
import { isHub, lookupOperator, normalizeProvider, slugForOperator } from "./normalize";
import { classifySpeed, type Connector, type SpeedClass } from "./speed";
import { syncMyMaps } from "./sync/mymaps";

export interface Env {
  DB: D1Database;
  TEAM_PIN?: string;
}

const MAX_BBOX_RESULTS = 500;
const MAX_SEARCH_RESULTS = 20;
const MAX_SEARCH_TOKENS = 5;
const Q_MIN = 2;
const Q_MAX = 100;
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_UA = "plugmap-th/1.0 (+https://ev.thana.in.th)";
const GEOCODE_TTL_S = 24 * 60 * 60;

interface StationRow {
  id: string;
  source: "mymaps" | "user";
  name: string;
  name_en: string | null;
  address: string | null;
  hours: string | null;
  operator: string | null;
  lat: number;
  lng: number;
  connectors_json: string;
  ov_name: string | null;
  ov_operator: string | null;
  ov_connectors_json: string | null;
  ov_edited_by: string | null;
  ov_edited_at: string | null;
  bm_station_id: string | null;
  bm_created_by?: string | null;
  bm_created_at?: string | null;
}

export interface StationDto {
  id: string;
  source: "mymaps" | "user";
  name: string;
  name_en: string | null;
  address: string | null;
  hours: string | null;
  operator: string;
  operator_slug: string | null;
  lat: number;
  lng: number;
  connectors: Connector[];
  speed: SpeedClass;
  hub: boolean;
  edited: boolean;
  bookmarked: boolean;
}

const SELECT_STATION = `SELECT s.id, s.source, s.name, s.name_en, s.address, s.hours, s.operator, s.lat, s.lng, s.connectors_json,
    o.name AS ov_name, o.operator AS ov_operator, o.connectors_json AS ov_connectors_json,
    o.edited_by AS ov_edited_by, o.edited_at AS ov_edited_at,
    b.station_id AS bm_station_id, b.created_by AS bm_created_by, b.created_at AS bm_created_at
  FROM stations s LEFT JOIN station_overrides o ON o.station_id = s.id
  LEFT JOIN bookmarks b ON b.station_id = s.id`;

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

const err = (status: number, message: string) => json({ error: message }, status);

function parseConnectorsJson(s: string | null | undefined): Connector[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as Connector[]) : [];
  } catch {
    return [];
  }
}

/** merge override (ฟิลด์ที่ไม่ null ทับของเดิม) แล้วแนบ operator_slug + speed + hub */
export function toDto(r: StationRow): StationDto {
  const operator = r.ov_operator ?? r.operator ?? "ไม่ระบุ";
  const connectors = r.ov_connectors_json != null ? parseConnectorsJson(r.ov_connectors_json) : parseConnectorsJson(r.connectors_json);
  const name = r.ov_name ?? r.name;
  return {
    id: r.id,
    source: r.source,
    name,
    name_en: r.name_en,
    address: r.address,
    hours: r.hours,
    operator,
    operator_slug: slugForOperator(operator),
    lat: r.lat,
    lng: r.lng,
    connectors,
    speed: classifySpeed(connectors),
    hub: isHub(name, r.name_en),
    edited: r.ov_edited_at != null,
    bookmarked: r.bm_station_id != null,
  };
}

// ---------- input validation ----------

function str(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") throw new Error("expected string");
  const t = v.trim();
  if (t.length > max) throw new Error(`string too long (max ${max})`);
  return t === "" ? null : t;
}

function sanitizeConnectors(v: unknown): Connector[] {
  if (!Array.isArray(v) || v.length > 20) throw new Error("connectors must be an array (max 20)");
  return v.map((c) => {
    if (typeof c !== "object" || c === null) throw new Error("invalid connector");
    const { type, kw, count } = c as Record<string, unknown>;
    const t = type == null || type === "" ? null : String(type).trim().slice(0, 40);
    const k = kw == null || kw === "" ? null : Number(kw);
    const n = count == null || count === "" ? null : Number(count);
    if (k !== null && (!Number.isFinite(k) || k <= 0 || k > 1500)) throw new Error("invalid kw");
    if (n !== null && (!Number.isInteger(n) || n <= 0 || n > 100)) throw new Error("invalid count");
    return { type: t, kw: k, count: n };
  });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new Error("invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("JSON object expected");
  return body as Record<string, unknown>;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** ตรวจ rate limit + PIN ของ request เขียน · คืน Response เมื่อไม่ผ่าน */
async function guardWrite(request: Request, env: Env): Promise<Response | null> {
  const ok = await consumeWriteQuota(env.DB, clientIp(request));
  if (!ok) return err(429, "เขียนบ่อยเกินไป ลองใหม่ภายหลัง (จำกัด 30 ครั้ง/ชั่วโมง)");
  if (!checkPin(request, env)) return err(401, "PIN ไม่ถูกต้อง");
  return null;
}

// ---------- handlers ----------

/** q ที่ผ่านการ trim และยาว 2-100 · null = ไม่ผ่าน */
function validQ(raw: string | null): string | null {
  const q = (raw ?? "").trim();
  return q.length >= Q_MIN && q.length <= Q_MAX ? q : null;
}

/** escape ตัวอักษรพิเศษของ LIKE (ใช้คู่ ESCAPE '\\') */
export function escapeLike(t: string): string {
  return t.replace(/[\\%_]/g, (c) => "\\" + c);
}

/** แยก q เป็น token ด้วยช่องว่าง (สูงสุด MAX_SEARCH_TOKENS) แล้ว escape เป็น pattern `%tok%` */
export function searchPatterns(q: string): string[] {
  return q.split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TOKENS).map((t) => `%${escapeLike(t)}%`);
}

async function searchStations(url: URL, env: Env, rawQ: string | null): Promise<Response> {
  const q = validQ(rawQ);
  if (!q) return err(400, `q ต้องยาว ${Q_MIN}-${Q_MAX} ตัวอักษร`);
  const pats = searchPatterns(q);
  const latP = url.searchParams.get("lat");
  const lngP = url.searchParams.get("lng");
  const lat = latP === null || latP.trim() === "" ? NaN : Number(latP);
  const lng = lngP === null || lngP.trim() === "" ? NaN : Number(lngP);
  const hasPos = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  const anyCol = (cols: string[]) => "(" + cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(" OR ") + ")";
  const allCols = ["s.name", "s.name_en", "s.address", "s.operator", "o.name"];
  const nameCols = ["s.name", "s.name_en", "o.name"];
  const binds: unknown[] = [];
  const conds = pats.map((p) => {
    binds.push(...allCols.map(() => p));
    return anyCol(allCols);
  });
  const nameConds = pats.map((p) => {
    binds.push(...nameCols.map(() => p));
    return anyCol(nameCols);
  });
  // จุดที่ทุก token ตรงกับชื่อมาก่อน แล้วค่อยเรียงตามระยะ (ถ้ามีพิกัด)
  let order = `CASE WHEN ${nameConds.join(" AND ")} THEN 0 ELSE 1 END ASC`;
  if (hasPos) {
    const k = Math.cos((lat * Math.PI) / 180);
    order += ", ((s.lat - ?) * (s.lat - ?) + ((s.lng - ?) * (s.lng - ?)) * ? * ?) ASC";
    binds.push(lat, lat, lng, lng, k, k);
  }
  order += ", s.id";
  binds.push(MAX_SEARCH_RESULTS);
  const { results } = await env.DB
    .prepare(`${SELECT_STATION} WHERE s.deleted = 0 AND ${conds.join(" AND ")} ORDER BY ${order} LIMIT ?`)
    .bind(...binds)
    .all<StationRow>();
  const stations = results.map((r) => {
    const dto = toDto(r);
    return hasPos ? { ...dto, distance_km: Math.round(haversineKm(lat, lng, r.lat, r.lng) * 10) / 10 } : dto;
  });
  return json({ stations, count: stations.length });
}

function haversineKm(la1: number, ln1: number, la2: number, ln2: number): number {
  const rad = Math.PI / 180;
  const dLa = (la2 - la1) * rad;
  const dLn = (ln2 - ln1) * rad;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(dLn / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

async function geocode(request: Request, url: URL): Promise<Response> {
  const q = validQ(url.searchParams.get("q"));
  if (!q) return err(400, `q ต้องยาว ${Q_MIN}-${Q_MAX} ตัวอักษร`);
  const normalized = q.toLowerCase().replace(/\s+/g, " ");
  const cacheKey = new Request(`https://geocode.cache.internal/?q=${encodeURIComponent(normalized)}`);
  const cache = (caches as unknown as { default: Cache }).default;
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return new Response(hit.body, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  } catch {
    /* cache ใช้ไม่ได้ = ข้าม */
  }
  const target = `${NOMINATIM_URL}?format=jsonv2&countrycodes=th&accept-language=th&limit=5&q=${encodeURIComponent(q)}`;
  let rows: unknown;
  try {
    const up = await fetch(target, { headers: { "User-Agent": NOMINATIM_UA, Accept: "application/json" } });
    if (!up.ok) return err(502, "geocoder error");
    rows = await up.json();
  } catch {
    return err(502, "geocoder error");
  }
  if (!Array.isArray(rows)) return err(502, "geocoder error");
  const results = rows
    .map((r: any) => ({
      display_name: String(r?.display_name ?? ""),
      lat: Number(r?.lat),
      lng: Number(r?.lon),
      type: typeof r?.type === "string" ? r.type : "",
    }))
    .filter((r) => r.display_name && Number.isFinite(r.lat) && Number.isFinite(r.lng))
    .slice(0, 5);
  const body = JSON.stringify({ results });
  try {
    await cache.put(cacheKey, new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${GEOCODE_TTL_S}` } }));
  } catch {
    /* ไม่เป็นไร */
  }
  return new Response(body, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

async function listStations(url: URL, env: Env): Promise<Response> {
  if (url.searchParams.has("q")) return searchStations(url, env, url.searchParams.get("q"));
  const hubOnly = url.searchParams.get("hub") === "1";
  const bboxParam = url.searchParams.get("bbox");
  let bb: number[] | null = null;
  if (bboxParam !== null || !hubOnly) {
    const parts = (bboxParam ?? "").split(",").map((p) => (p.trim() === "" ? NaN : Number(p)));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return err(400, "bbox=minLng,minLat,maxLng,maxLat required");
    const [minLng, minLat, maxLng, maxLat] = parts;
    if (minLng >= maxLng || minLat >= maxLat || Math.abs(minLat) > 90 || Math.abs(maxLat) > 90 || Math.abs(minLng) > 180 || Math.abs(maxLng) > 180) {
      return err(400, "invalid bbox");
    }
    bb = parts;
  }
  const where = ["s.deleted = 0"];
  const binds: unknown[] = [];
  if (bb) {
    const [minLng, minLat, maxLng, maxLat] = bb;
    where.push("s.lat BETWEEN ? AND ? AND s.lng BETWEEN ? AND ?");
    binds.push(minLat, maxLat, minLng, maxLng);
  }
  if (hubOnly) {
    // pre-filter ด้วย LIKE (กันสแกน JS ทั้งตาราง) แล้วค่อยตัดสินจริงด้วย isHub
    const cols = ["s.name", "s.name_en", "o.name"];
    where.push("(" + cols.flatMap((c) => [`${c} LIKE '%hub%'`, `${c} LIKE '%ฮับ%'`]).join(" OR ") + ")");
  }
  let order = "";
  if (bb) {
    const cLat = (bb[1] + bb[3]) / 2;
    const cLng = (bb[0] + bb[2]) / 2;
    order = "ORDER BY ((s.lat - ?) * (s.lat - ?) + (s.lng - ?) * (s.lng - ?)) ASC";
    binds.push(cLat, cLat, cLng, cLng);
  } else order = "ORDER BY s.id";
  // hub: LIMIT หลัง filter ใน JS ไม่ได้ → ดึงทั้งหมดที่ผ่าน LIKE (หลักสิบ) แล้วตัดทีหลัง
  const limit = hubOnly ? "" : "LIMIT ?";
  if (!hubOnly) binds.push(MAX_BBOX_RESULTS + 1);
  const { results } = await env.DB
    .prepare(`${SELECT_STATION} WHERE ${where.join(" AND ")} ${order} ${limit}`)
    .bind(...binds)
    .all<StationRow>();
  let dtos = results.map(toDto);
  if (hubOnly) dtos = dtos.filter((d) => d.hub);
  const truncated = dtos.length > MAX_BBOX_RESULTS;
  const stations = dtos.slice(0, MAX_BBOX_RESULTS);
  return json({ stations, count: stations.length, truncated });
}

async function getStationRow(env: Env, id: string): Promise<StationRow | null> {
  return env.DB.prepare(`${SELECT_STATION} WHERE s.id = ? AND s.deleted = 0`).bind(id).first<StationRow>();
}

async function createStation(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const name = str(body.name, 200);
  if (!name) throw new HttpError(400, "name required");
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new HttpError(400, "invalid lat/lng");
  }
  const connectors = body.connectors === undefined ? [] : sanitizeConnectors(body.connectors);
  const opInput = str(body.operator, 100) ?? null;
  const op = normalizeProvider(opInput);
  const createdBy = str(body.created_by, 100) ?? null;
  const id = `user:${crypto.randomUUID()}`;
  await env.DB
    .prepare(
      `INSERT INTO stations (id, source, name, name_en, address, hours, operator, operator_raw, lat, lng, connectors_json, raw_json, updated_at)
       VALUES (?, 'user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, name, str(body.name_en, 200) ?? null, str(body.address, 500) ?? null, str(body.hours, 200) ?? null,
      op.operator, opInput ?? "", lat, lng, JSON.stringify(connectors), JSON.stringify({ created_by: createdBy }),
      new Date().toISOString(),
    )
    .run();
  const row = await getStationRow(env, id);
  return json(toDto(row!), 201);
}

async function patchStation(request: Request, env: Env, id: string): Promise<Response> {
  const existing = await getStationRow(env, id);
  if (!existing) return err(404, "ไม่พบจุดชาร์จ");
  const body = await readJson(request);
  const name = str(body.name, 200);
  const operatorIn = str(body.operator, 100);
  const connectors = body.connectors === undefined ? undefined : sanitizeConnectors(body.connectors);
  if (name === undefined && operatorIn === undefined && connectors === undefined) {
    throw new HttpError(400, "nothing to update (name / operator / connectors)");
  }
  // operator: ถ้าตรงกับ alias ใช้ชื่อมาตรฐาน ไม่งั้นเก็บตามที่พิมพ์
  const operator = operatorIn === undefined ? undefined : operatorIn === null ? null : (lookupOperator(operatorIn)?.name ?? operatorIn);
  const editedBy = str(body.edited_by, 100) ?? null;
  const now = new Date().toISOString();
  // ฟิลด์ที่ไม่ส่งมา = คงค่า override เดิม (COALESCE กับแถวเดิม)
  await env.DB
    .prepare(
      `INSERT INTO station_overrides (station_id, name, operator, connectors_json, edited_by, edited_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(station_id) DO UPDATE SET
         name = CASE WHEN ?7 THEN ?2 ELSE station_overrides.name END,
         operator = CASE WHEN ?8 THEN ?3 ELSE station_overrides.operator END,
         connectors_json = CASE WHEN ?9 THEN ?4 ELSE station_overrides.connectors_json END,
         edited_by = ?5, edited_at = ?6`,
    )
    .bind(
      id, name ?? null, operator ?? null, connectors === undefined ? null : JSON.stringify(connectors), editedBy, now,
      name !== undefined ? 1 : 0, operator !== undefined ? 1 : 0, connectors !== undefined ? 1 : 0,
    )
    .run();
  const row = await getStationRow(env, id);
  return json(toDto(row!));
}

async function deleteStation(request: Request, env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare("SELECT id, source, deleted FROM stations WHERE id = ?").bind(id).first<{ id: string; source: string; deleted: number }>();
  if (!row || row.deleted === 1) return err(404, "ไม่พบจุดชาร์จ");
  if (row.source !== "user") return err(403, "ลบได้เฉพาะจุดที่ทีมเพิ่มเอง");
  let by: string | null = null;
  try {
    const b = await request.json<Record<string, unknown>>();
    by = typeof b?.deleted_by === "string" ? b.deleted_by.trim().slice(0, 100) || null : null;
  } catch {
    /* body ไม่บังคับ */
  }
  await env.DB
    .prepare("UPDATE stations SET deleted = 1, deleted_by = ?, deleted_at = ? WHERE id = ?")
    .bind(by, new Date().toISOString(), id)
    .run();
  return json({ ok: true, id });
}

async function listBookmarks(env: Env): Promise<Response> {
  const { results } = await env.DB
    .prepare(`${SELECT_STATION} WHERE s.deleted = 0 AND b.station_id IS NOT NULL ORDER BY b.created_at DESC`)
    .all<StationRow>();
  const stations = results.map((r) => ({
    ...toDto(r),
    bookmark: { created_by: r.bm_created_by ?? null, created_at: r.bm_created_at ?? null },
  }));
  return json({ stations, count: stations.length });
}

async function putBookmark(request: Request, env: Env, id: string): Promise<Response> {
  const row = await getStationRow(env, id);
  if (!row) return err(404, "ไม่พบจุดชาร์จ");
  // body ไม่บังคับ (ว่าง = ไม่มีชื่อ) แต่ถ้ามีต้องเป็น JSON object
  const text = await request.text();
  const body = text.trim() === "" ? {} : await readJson(new Request(request.url, { method: "POST", body: text }));
  const createdBy = str(body.created_by, 100) ?? null;
  // idempotent: ซ้ำ = คง created_at/created_by เดิม
  await env.DB
    .prepare("INSERT INTO bookmarks (station_id, created_by, created_at) VALUES (?, ?, ?) ON CONFLICT(station_id) DO NOTHING")
    .bind(id, createdBy, new Date().toISOString())
    .run();
  const fresh = await getStationRow(env, id);
  return json(toDto(fresh!));
}

async function deleteBookmark(env: Env, id: string): Promise<Response> {
  await env.DB.prepare("DELETE FROM bookmarks WHERE station_id = ?").bind(id).run();
  return json({ ok: true });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if (pathname === "/api/stations") {
    if (method === "GET") return listStations(url, env);
    if (method === "POST") {
      const denied = await guardWrite(request, env);
      return denied ?? createStation(request, env);
    }
    return err(405, "method not allowed");
  }

  const m = /^\/api\/stations\/(.+)$/.exec(pathname);
  if (m) {
    let id: string;
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      return err(400, "bad id");
    }
    if (method === "GET") {
      const row = await getStationRow(env, id);
      return row ? json(toDto(row)) : err(404, "ไม่พบจุดชาร์จ");
    }
    if (method === "PATCH" || method === "DELETE") {
      const denied = await guardWrite(request, env);
      if (denied) return denied;
      return method === "PATCH" ? patchStation(request, env, id) : deleteStation(request, env, id);
    }
    return err(405, "method not allowed");
  }

  if (pathname === "/api/geocode") {
    return method === "GET" ? geocode(request, url) : err(405, "method not allowed");
  }

  if (pathname === "/api/bookmarks") {
    return method === "GET" ? listBookmarks(env) : err(405, "method not allowed");
  }

  const bm = /^\/api\/bookmarks\/(.+)$/.exec(pathname);
  if (bm) {
    let id: string;
    try {
      id = decodeURIComponent(bm[1]);
    } catch {
      return err(400, "bad id");
    }
    if (method === "PUT" || method === "DELETE") {
      const denied = await guardWrite(request, env);
      if (denied) return denied;
      return method === "PUT" ? putBookmark(request, env, id) : deleteBookmark(env, id);
    }
    return err(405, "method not allowed");
  }

  if (pathname === "/api/admin/sync") {
    if (method !== "POST") return err(405, "method not allowed");
    const denied = await guardWrite(request, env);
    if (denied) return denied;
    const result = await syncMyMaps(env);
    return json(result, result.ok ? 200 : 502);
  }

  if (pathname.startsWith("/api/")) return err(404, "not found");
  return new Response("Not found", { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (e) {
      if (e instanceof HttpError) return err(e.status, e.message);
      if (e instanceof Error && /^(expected|string too long|invalid|connectors|JSON)/.test(e.message)) return err(400, e.message);
      console.error("unhandled", e);
      return err(500, "internal error");
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      syncMyMaps(env).then((r) => {
        if (r.ok) console.log("sync ok", JSON.stringify(r));
        else console.error("sync failed", r.error);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
