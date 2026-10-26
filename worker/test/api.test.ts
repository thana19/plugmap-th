import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { syncMyMaps } from "../src/sync/mymaps";
import { PIN, kmlOf, noSleep, okFetch, req, resetDb, type KmlStation } from "./helpers";
import fixture from "./fixtures/mymaps-sample.kml?raw";

const BKK = "100.3,13.5,100.9,14.0"; // minLng,minLat,maxLng,maxLat
const call = (r: Request) => worker.fetch(r, env as never);
const sync = (kml: string) => syncMyMaps(env, { fetchImpl: okFetch(kml), sleep: noSleep });

const A: KmlStation = { name: "สถานี A", lat: 13.75, lng: 100.5, provider: "PTT", description: "2x CCS2: 120 kW" };
const B: KmlStation = { name: "สถานี B", lat: 13.8, lng: 100.55, provider: "EA", description: "CCS2: 50 kW" };
const FAR: KmlStation = { name: "เชียงใหม่", lat: 18.79, lng: 98.98, provider: "PEA", description: "CCS2" };

async function list(bbox = BKK) {
  const res = await call(req(`/api/stations?bbox=${bbox}`));
  expect(res.status).toBe(200);
  return (await res.json()) as { stations: Array<Record<string, any>>; count: number; truncated: boolean };
}

beforeEach(resetDb);

describe("GET /api/stations?bbox", () => {
  it("คืนเฉพาะจุดใน bbox พร้อม operator_slug, speed, connectors", async () => {
    await sync(kmlOf([A, B, FAR]));
    const { stations, count, truncated } = await list();
    expect(count).toBe(2);
    expect(truncated).toBe(false);
    const a = stations.find((s) => s.name === "สถานี A")!;
    expect(a).toMatchObject({
      source: "mymaps",
      operator: "PTT EV Station PluZ",
      operator_slug: "ptt",
      speed: "dc",
      connectors: [{ type: "CCS2", kw: 120, count: 2 }],
      edited: false,
    });
    expect(stations.find((s) => s.name === "เชียงใหม่")).toBeUndefined();
  });

  it("bbox ผิดรูปแบบ = 400", async () => {
    for (const q of ["", "bbox=1,2,3", "bbox=a,b,c,d", "bbox=100,14,99,13"]) {
      expect((await call(req(`/api/stations?${q}`))).status, q).toBe(400);
    }
  });

  it("จำกัดไม่เกิน 500 จุด และบอก truncated", async () => {
    const many: KmlStation[] = Array.from({ length: 520 }, (_, i) => ({
      name: `S${i}`, lat: 13.5 + (i % 100) * 0.001, lng: 100.3 + Math.floor(i / 100) * 0.001,
    }));
    await sync(kmlOf(many));
    const r = await list();
    expect(r.count).toBe(500);
    expect(r.truncated).toBe(true);
  });

  it("GET /api/stations/:id", async () => {
    await sync(kmlOf([A]));
    const id = (await list()).stations[0].id as string;
    const res = await call(req(`/api/stations/${encodeURIComponent(id)}`));
    expect(res.status).toBe(200);
    expect((await res.json() as any).name).toBe("สถานี A");
    expect((await call(req("/api/stations/mymaps:nope"))).status).toBe(404);
  });
});

describe("เขียนต้องใช้ PIN", () => {
  const body = JSON.stringify({ name: "จุดใหม่", lat: 13.7, lng: 100.5 });

  it("ไม่มี PIN / PIN ผิด = 401 ทุก method", async () => {
    await sync(kmlOf([A]));
    const id = encodeURIComponent((await list()).stations[0].id);
    for (const pin of [null, "wrong"]) {
      expect((await call(req("/api/stations", { method: "POST", body, pin }))).status).toBe(401);
      expect((await call(req(`/api/stations/${id}`, { method: "PATCH", body: "{}", pin }))).status).toBe(401);
      expect((await call(req(`/api/stations/${id}`, { method: "DELETE", pin }))).status).toBe(401);
      expect((await call(req("/api/admin/sync", { method: "POST", pin }))).status).toBe(401);
    }
    expect((await list()).count).toBe(1); // ไม่มีอะไรถูกเขียน
  });

  it("rate limit: เกิน 30 ครั้ง/ชม./IP = 429 (นับรวม PIN ผิด) · IP อื่นไม่กระทบ", async () => {
    const ip = "198.51.100.7";
    for (let i = 0; i < 30; i++) {
      expect((await call(req("/api/stations", { method: "POST", body, pin: "wrong", ip }))).status).toBe(401);
    }
    expect((await call(req("/api/stations", { method: "POST", body, ip }))).status).toBe(429);
    expect((await call(req("/api/stations", { method: "POST", body, ip: "198.51.100.8" }))).status).toBe(201);
  });
});

describe("POST/DELETE จุดของทีม (source user)", () => {
  it("POST สร้างจุด · โผล่ใน bbox · DELETE soft delete เก็บ deleted_by/deleted_at", async () => {
    const res = await call(req("/api/stations", {
      method: "POST",
      body: JSON.stringify({
        name: "ที่จอดรถทีม", lat: 13.72, lng: 100.52, operator: "ptt",
        connectors: [{ type: "Type 2", kw: 22, count: 2 }], created_by: "หนุ่ม",
      }),
    }));
    expect(res.status).toBe(201);
    const st = (await res.json()) as any;
    expect(st.id).toMatch(/^user:/);
    expect(st).toMatchObject({ source: "user", operator: "PTT EV Station PluZ", operator_slug: "ptt", speed: "ac" });
    expect((await list()).stations.map((s) => s.id)).toContain(st.id);

    const del = await call(req(`/api/stations/${encodeURIComponent(st.id)}`, {
      method: "DELETE", body: JSON.stringify({ deleted_by: "มิกะ" }),
    }));
    expect(del.status).toBe(200);
    const row = await env.DB.prepare("SELECT deleted, deleted_by, deleted_at FROM stations WHERE id = ?").bind(st.id).first<any>();
    expect(row.deleted).toBe(1);
    expect(row.deleted_by).toBe("มิกะ");
    expect(row.deleted_at).toBeTruthy();
    expect((await list()).stations.map((s) => s.id)).not.toContain(st.id);
    expect((await call(req(`/api/stations/${encodeURIComponent(st.id)}`))).status).toBe(404);
    // ลบซ้ำ = 404
    expect((await call(req(`/api/stations/${encodeURIComponent(st.id)}`, { method: "DELETE" }))).status).toBe(404);
  });

  it("DELETE จุด source mymaps = 403 และจุดยังอยู่", async () => {
    await sync(kmlOf([A]));
    const id = (await list()).stations[0].id;
    expect((await call(req(`/api/stations/${encodeURIComponent(id)}`, { method: "DELETE" }))).status).toBe(403);
    expect((await list()).count).toBe(1);
  });

  it("POST ข้อมูลผิด = 400", async () => {
    const bad = [
      {}, { name: "x" }, { name: "x", lat: 999, lng: 100 }, { name: "x", lat: 13, lng: 100, connectors: "no" },
      { name: "x", lat: 13, lng: 100, connectors: [{ type: "CCS2", kw: -5 }] },
    ];
    for (const b of bad) expect((await call(req("/api/stations", { method: "POST", body: JSON.stringify(b) }))).status).toBe(400);
    expect((await call(req("/api/stations", { method: "POST", body: "not json" }))).status).toBe(400);
  });
});

describe("PATCH = override", () => {
  it("เขียน override ทับของเดิม และ sync รอบถัดไปไม่เขียนทับ", async () => {
    await sync(kmlOf([A]));
    const id = (await list()).stations[0].id as string;
    const patch = await call(req(`/api/stations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "ชื่อที่ทีมแก้", connectors: [{ type: "Type 2", kw: 22, count: 4 }], edited_by: "หนุ่ม" }),
    }));
    expect(patch.status).toBe(200);
    expect(await patch.json()).toMatchObject({ name: "ชื่อที่ทีมแก้", speed: "ac", edited: true });

    // KML เปลี่ยนข้อมูล (kW) แต่ id เดิม (พิกัด+ชื่อเดิม) -> override ต้องอยู่
    await sync(kmlOf([{ ...A, description: "CCS2: 200 kW" }]));
    const after = (await list()).stations.find((s) => s.id === id)!;
    expect(after.name).toBe("ชื่อที่ทีมแก้");
    expect(after.connectors).toEqual([{ type: "Type 2", kw: 22, count: 4 }]);
    const ov = await env.DB.prepare("SELECT * FROM station_overrides WHERE station_id = ?").bind(id).first<any>();
    expect(ov.edited_by).toBe("หนุ่ม");
    // ข้อมูลฐานถูก sync อัปเดตตามปกติ
    const base = await env.DB.prepare("SELECT connectors_json FROM stations WHERE id = ?").bind(id).first<any>();
    expect(JSON.parse(base.connectors_json)).toEqual([{ type: "CCS2", kw: 200, count: 1 }]);
  });

  it("PATCH ครั้งที่สองที่ส่งคนละฟิลด์ ไม่ล้างฟิลด์ที่แก้ไว้ก่อน", async () => {
    await sync(kmlOf([A]));
    const id = encodeURIComponent((await list()).stations[0].id);
    await call(req(`/api/stations/${id}`, { method: "PATCH", body: JSON.stringify({ name: "N1" }) }));
    const res = await call(req(`/api/stations/${id}`, { method: "PATCH", body: JSON.stringify({ operator: "Tesla" }) }));
    expect(await res.json()).toMatchObject({ name: "N1", operator: "Tesla", operator_slug: "tesla" });
  });

  it("PATCH จุดที่ไม่มี = 404 · body ว่าง = 400", async () => {
    expect((await call(req("/api/stations/mymaps:none", { method: "PATCH", body: "{}" }))).status).toBe(404);
    await sync(kmlOf([A]));
    const id = encodeURIComponent((await list()).stations[0].id);
    expect((await call(req(`/api/stations/${id}`, { method: "PATCH", body: "{}" }))).status).toBe(400);
  });
});

describe("sync", () => {
  it("fixture จริง: import ครบ 10 จุด", async () => {
    const r = await sync(fixture);
    expect(r).toMatchObject({ ok: true, parsed: 10, upserted: 10, marked_deleted: 0 });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM stations WHERE source='mymaps' AND deleted=0").first<any>();
    expect(n.n).toBe(10);
  });

  it("จุดที่หายจาก KML -> deleted=1 (ไม่โผล่ใน bbox) · กลับมา -> deleted=0", async () => {
    await sync(kmlOf([A, B]));
    expect((await list()).count).toBe(2);

    const r2 = await sync(kmlOf([A]));
    expect(r2).toMatchObject({ ok: true, marked_deleted: 1 });
    const gone = await env.DB.prepare("SELECT deleted FROM stations WHERE name = 'สถานี B'").first<any>();
    expect(gone.deleted).toBe(1);
    expect((await list()).stations.map((s) => s.name)).toEqual(["สถานี A"]);

    const r3 = await sync(kmlOf([A, B]));
    expect(r3).toMatchObject({ ok: true, revived: 1 });
    expect((await list()).count).toBe(2);
  });

  it("ไม่แตะจุด source user ตอน mark deleted", async () => {
    await sync(kmlOf([A, B]));
    const created = await call(req("/api/stations", { method: "POST", body: JSON.stringify({ name: "ของทีม", lat: 13.7, lng: 100.5 }) }));
    expect(created.status).toBe(201);
    await sync(kmlOf([A]));
    expect((await list()).stations.map((s) => s.name).sort()).toEqual(["ของทีม", "สถานี A"]);
  });

  it("override ที่ station id หายจาก KML = orphan เก็บไว้ ไม่ถูกลบ", async () => {
    await sync(kmlOf([A, B]));
    const idB = (await list()).stations.find((s) => s.name === "สถานี B")!.id as string;
    await call(req(`/api/stations/${encodeURIComponent(idB)}`, { method: "PATCH", body: JSON.stringify({ name: "B แก้" }) }));
    await sync(kmlOf([A]));
    const ov = await env.DB.prepare("SELECT COUNT(*) AS n FROM station_overrides WHERE station_id = ?").bind(idB).first<any>();
    expect(ov.n).toBe(1);
  });

  describe("ล้มเหลว = ข้อมูลเดิมยังอยู่", () => {
    beforeEach(async () => {
      await sync(kmlOf([A, B]));
    });
    const stillThere = async () => expect((await list()).count).toBe(2);

    it("ตอบ 5xx ทุกครั้ง -> retry 3 ครั้ง (backoff 2 รอบ) แล้ว fail", async () => {
      let calls = 0;
      const sleeps: number[] = [];
      const r = await syncMyMaps(env, {
        fetchImpl: (async () => { calls++; return new Response("boom", { status: 503 }); }) as unknown as typeof fetch,
        sleep: async (ms) => { sleeps.push(ms); },
      });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/503/);
      expect(calls).toBe(3);
      expect(sleeps).toEqual([1000, 2000]);
      await stillThere();
    });

    it("fetch throw (network error)", async () => {
      const r = await syncMyMaps(env, { fetchImpl: (async () => { throw new Error("network down"); }) as unknown as typeof fetch, sleep: noSleep });
      expect(r).toMatchObject({ ok: false });
      expect(r.error).toMatch(/network down/);
      await stillThere();
    });

    it("ตอบ 200 แต่ว่าง / ไม่มี Placemark", async () => {
      expect((await sync("")).ok).toBe(false);
      expect((await sync("<kml><Document></Document></kml>")).ok).toBe(false);
      await stillThere();
    });

    it("parse ได้น้อยผิดปกติ (< 50% ของปัจจุบัน) = fail ไม่ลบอะไร", async () => {
      // ปัจจุบัน 2 จุด -> KML เหลือ 0 จุดที่ valid เป็นกรณี 0; ใช้ 4 จุดแล้วส่ง 1 จุด
      await sync(kmlOf([A, B, { ...A, name: "C", lat: 13.9 }, { ...A, name: "D", lat: 13.95 }]));
      const r = await sync(kmlOf([A]));
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/keeping existing/);
      expect((await list()).count).toBe(4);
    });

    it("ล้มครั้งแรก สำเร็จครั้งที่ 3 -> ok", async () => {
      let n = 0;
      const r = await syncMyMaps(env, {
        fetchImpl: (async () => (++n < 3 ? new Response("x", { status: 500 }) : new Response(kmlOf([A, B])))) as unknown as typeof fetch,
        sleep: noSleep,
      });
      expect(r.ok).toBe(true);
      expect(n).toBe(3);
    });

    it("ส่ง User-Agent", async () => {
      let ua: string | null = null;
      await syncMyMaps(env, {
        fetchImpl: (async (_u: unknown, init?: RequestInit) => { ua = new Headers(init?.headers).get("User-Agent"); return new Response(kmlOf([A, B])); }) as unknown as typeof fetch,
        sleep: noSleep,
      });
      expect(ua).toMatch(/EV-Charger/);
    });
  });

  it("POST /api/admin/sync: ล้มเหลว -> 502 (fetch จริงในเทสต์ถูกแทนที่ไม่ได้ จึงเช็คแค่ PIN ผ่านแล้วไม่ 401)", async () => {
    // ไม่ยิงเน็ตจริง: ใช้ globalThis.fetch mock ชั่วคราว
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(kmlOf([A]), { status: 200 })) as typeof fetch;
    try {
      const res = await call(req("/api/admin/sync", { method: "POST" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, parsed: 1 });
    } finally {
      globalThis.fetch = orig;
    }
  });
});

void PIN;
