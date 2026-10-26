// My Maps sync (PRD: Nightly sync · ADR 0002)
// ดึง KML -> parse -> upsert ลง D1 เป็น batch -> mark deleted ที่หายไป
// ล้มเหลว (fetch ล้ม / ว่าง / น้อยผิดปกติ) = ไม่แตะข้อมูลเดิม

import { parseKml, type ParsedStation } from "./parse";

export const MYMAPS_KML_URL =
  "https://www.google.com/maps/d/kml?mid=1YKD1Z5CdoyMnSTCOf2TgLmKV-REwfmIC&forcekml=1";
export const USER_AGENT = "EV-Charger-Map/0.1 (+https://ev.thana.in.th; team internal sync)";
export const MIN_RATIO = 0.5; // parse ได้ < 50% ของจำนวน mymaps ปัจจุบัน = ผิดปกติ
const FETCH_ATTEMPTS = 3;
const BATCH_SIZE = 100;

export interface SyncResult {
  ok: boolean;
  error?: string;
  parsed?: number;
  upserted?: number;
  marked_deleted?: number;
  revived?: number;
  existing_before?: number;
}

export interface SyncOptions {
  fetchImpl?: typeof fetch;
  /** ใช้ใน test เพื่อไม่ต้องรอ backoff จริง */
  sleep?: (ms: number) => Promise<void>;
  url?: string;
  now?: () => Date;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchKml(opts: SyncOptions): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  let lastErr = "unknown";
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await doFetch(opts.url ?? MYMAPS_KML_URL, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/vnd.google-earth.kml+xml, application/xml, */*" },
      });
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`HTTP ${res.status}`);
      }
      const text = await res.text();
      if (!text.trim()) throw new Error("empty response");
      return text;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (attempt < FETCH_ATTEMPTS) await sleep(1000 * 2 ** (attempt - 1)); // 1s, 2s
    }
  }
  throw new Error(`fetch failed after ${FETCH_ATTEMPTS} attempts: ${lastErr}`);
}

const UPSERT_SQL = `INSERT INTO stations
  (id, source, name, name_en, address, hours, operator, operator_raw, lat, lng, connectors_json, raw_json, updated_at, deleted, deleted_by, deleted_at)
  VALUES (?, 'mymaps', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, name_en = excluded.name_en, address = excluded.address, hours = excluded.hours,
    operator = excluded.operator, operator_raw = excluded.operator_raw, lat = excluded.lat, lng = excluded.lng,
    connectors_json = excluded.connectors_json, raw_json = excluded.raw_json, updated_at = excluded.updated_at,
    deleted = 0, deleted_by = NULL, deleted_at = NULL
  WHERE stations.source = 'mymaps'`;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function syncMyMaps(env: { DB: D1Database }, opts: SyncOptions = {}): Promise<SyncResult> {
  const db = env.DB;
  try {
    const before = await db
      .prepare("SELECT COUNT(*) AS n FROM stations WHERE source = 'mymaps' AND deleted = 0")
      .first<{ n: number }>();
    const existing = before?.n ?? 0;

    const xml = await fetchKml(opts);
    const parsedAll = parseKml(xml);
    // id ซ้ำใน KML (ชื่อ+พิกัดเดียวกัน) -> upsert ตัวเดียว
    const byId = new Map<string, ParsedStation>();
    for (const s of parsedAll) if (!byId.has(s.id)) byId.set(s.id, s);
    const stations = [...byId.values()];

    if (stations.length === 0) throw new Error("KML parsed to 0 stations");
    if (existing > 0 && stations.length < existing * MIN_RATIO) {
      throw new Error(`KML has only ${stations.length} stations (< ${MIN_RATIO * 100}% of current ${existing}); keeping existing data`);
    }

    const nowIso = (opts.now?.() ?? new Date()).toISOString();

    // ids ที่มีอยู่ (ทั้งที่ deleted แล้วด้วย) เพื่อรู้ว่าอันไหน revive / หายไป
    const rows = await db.prepare("SELECT id, deleted FROM stations WHERE source = 'mymaps'").all<{ id: string; deleted: number }>();
    const wasDeleted = new Set(rows.results.filter((r) => r.deleted === 1).map((r) => r.id));
    const incoming = new Set(stations.map((s) => s.id));
    const revived = stations.filter((s) => wasDeleted.has(s.id)).length;
    const missing = rows.results.filter((r) => r.deleted === 0 && !incoming.has(r.id)).map((r) => r.id);

    const upserts = stations.map((s) =>
      db.prepare(UPSERT_SQL).bind(
        s.id, s.name, s.name_en, s.address, s.hours, s.operator, s.operator_raw,
        s.lat, s.lng, JSON.stringify(s.connectors), JSON.stringify(s.raw), nowIso,
      ),
    );
    for (const group of chunk(upserts, BATCH_SIZE)) await db.batch(group);

    let markedDeleted = 0;
    for (const ids of chunk(missing, 90)) {
      const placeholders = ids.map(() => "?").join(",");
      const res = await db
        .prepare(
          `UPDATE stations SET deleted = 1, deleted_at = ?, deleted_by = 'sync' ` +
            `WHERE source = 'mymaps' AND deleted = 0 AND id IN (${placeholders})`,
        )
        .bind(nowIso, ...ids)
        .run();
      markedDeleted += res.meta.changes ?? 0;
    }

    return {
      ok: true,
      parsed: stations.length,
      upserted: stations.length,
      marked_deleted: markedDeleted,
      revived,
      existing_before: existing,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
