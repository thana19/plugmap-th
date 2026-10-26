import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { escapeLike, searchPatterns } from "../src/index";
import { syncMyMaps } from "../src/sync/mymaps";
import { kmlOf, noSleep, okFetch, req, resetDb, type KmlStation } from "./helpers";

const call = (r: Request) => worker.fetch(r, env as never);
const sync = (list: KmlStation[]) => syncMyMaps(env, { fetchImpl: okFetch(kmlOf(list)), sleep: noSleep });
const search = async (qs: string) => {
  const res = await call(req(`/api/stations?${qs}`, { pin: null }));
  return { res, body: (await res.json()) as any };
};
const names = (b: any) => b.stations.map((s: any) => s.name);

beforeEach(resetDb);

describe("search helpers", () => {
  it("escapeLike escape % _ \\", () => {
    expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
  });
  it("searchPatterns แยก token ด้วยช่องว่างหลายตัว/ขอบ และจำกัด 5", () => {
    expect(searchPatterns("  ปตท   หัวหิน ")).toEqual(["%ปตท%", "%หัวหิน%"]);
    expect(searchPatterns("a b c d e f g")).toHaveLength(5);
  });
});

describe("GET /api/stations?q=", () => {
  it("ทุก token ต้องตรง (AND) ข้ามฟิลด์ name/operator", async () => {
    await sync([
      { name: "ปตท หัวหิน", lat: 12.57, lng: 99.95, provider: "PTT" },
      { name: "ปตท เชียงใหม่", lat: 18.79, lng: 98.98, provider: "PTT" },
      { name: "เซ็นทรัล หัวหิน", lat: 12.55, lng: 99.96, provider: "EA" },
    ]);
    expect(names((await search("q=" + encodeURIComponent("ปตท หัวหิน"))).body)).toEqual(["ปตท หัวหิน"]);
    expect(names((await search("q=" + encodeURIComponent("หัวหิน"))).body).sort()).toEqual(["ปตท หัวหิน", "เซ็นทรัล หัวหิน"].sort());
    // token ตรงกับ operator ของ EA + ชื่อ
    expect(names((await search("q=" + encodeURIComponent("EA เซ็นทรัล"))).body)).toEqual(["เซ็นทรัล หัวหิน"]);
    expect((await search("q=" + encodeURIComponent("ปตท ภูเก็ต"))).body.count).toBe(0);
  });

  it("จุด deleted=1 ไม่โผล่", async () => {
    await sync([{ name: "ซ่อนฉัน", lat: 13.7, lng: 100.5 }]);
    await env.DB.prepare("UPDATE stations SET deleted = 1").run();
    expect((await search("q=ซ่อนฉัน")).body.count).toBe(0);
  });

  it("สูงสุด 20 จุด", async () => {
    await sync(Array.from({ length: 30 }, (_, i) => ({ name: `Hub ${i}`, lat: 13.7 + i * 0.001, lng: 100.5 })));
    expect((await search("q=Hub")).body.count).toBe(20);
  });

  it("q สั้น/ว่าง/ไม่มี/ยาวเกิน 100 = 400 · ขอบ 2 และ 100 ผ่าน", async () => {
    for (const qs of ["q=", "q=a", "q=%20%20a%20", `q=${"x".repeat(101)}`]) {
      expect((await search(qs)).res.status, qs).toBe(400);
    }
    expect((await search("q=ab")).res.status).toBe(200);
    expect((await search(`q=${"x".repeat(100)}`)).res.status).toBe(200);
  });

  it("ไม่ต้องมี bbox เมื่อมี q และไม่กระทบ bbox ปกติ", async () => {
    await sync([{ name: "Alpha", lat: 13.7, lng: 100.5 }]);
    expect((await search("q=Alpha")).res.status).toBe(200);
    expect((await call(req("/api/stations", { pin: null }))).status).toBe(400);
  });

  it("escape % และ _ — ไม่เป็น wildcard", async () => {
    await sync([
      { name: "AB site", lat: 13.7, lng: 100.5 },
      { name: "100% fast", lat: 13.71, lng: 100.5 },
      { name: "a_b slot", lat: 13.72, lng: 100.5 },
      { name: "axb slot", lat: 13.73, lng: 100.5 },
    ]);
    expect(names((await search("q=" + encodeURIComponent("%%"))).body)).toEqual([]);
    expect(names((await search("q=" + encodeURIComponent("0%"))).body)).toEqual(["100% fast"]);
    expect(names((await search("q=" + encodeURIComponent("a_b"))).body)).toEqual(["a_b slot"]);
    expect((await search("q=" + encodeURIComponent("__"))).body.count).toBe(0);
  });

  it("เรียงตามระยะจาก lat/lng + distance_km · ไม่ส่งพิกัดไม่มี distance_km", async () => {
    await sync([
      { name: "Test far", lat: 18.79, lng: 98.98 },
      { name: "Test near", lat: 13.75, lng: 100.5 },
      { name: "Test mid", lat: 14.9, lng: 100.9 },
    ]);
    const { body } = await search("q=Test&lat=13.7&lng=100.5");
    expect(names(body)).toEqual(["Test near", "Test mid", "Test far"]);
    expect(body.stations[0].distance_km).toBeGreaterThan(4);
    expect(body.stations[0].distance_km).toBeLessThan(7);
    expect(body.stations[0]).toMatchObject({ hub: false, bookmarked: false, operator_slug: expect.anything() });
    const noPos = await search("q=Test");
    expect(noPos.body.stations[0].distance_km).toBeUndefined();
    // lat/lng ไม่ valid = ถือว่าไม่มี
    expect((await search("q=Test&lat=abc&lng=1")).body.stations[0].distance_km).toBeUndefined();
  });

  it("ชื่อตรงมาก่อนจุดที่ตรงแค่ operator/address แม้ไกลกว่า", async () => {
    await sync([
      { name: "สถานีใกล้", lat: 13.7, lng: 100.5, provider: "EA" },
      { name: "EA สถานีไกล", lat: 18.79, lng: 98.98, provider: "PTT" },
    ]);
    const { body } = await search("q=EA&lat=13.7&lng=100.5");
    expect(names(body)[0]).toBe("EA สถานีไกล");
    expect(body.count).toBe(2);
  });
});

describe("GET /api/geocode", () => {
  afterEach(() => vi.restoreAllMocks());
  const geo = (qs: string, init: RequestInit = {}) => call(req(`/api/geocode?${qs}`, { pin: null, ...init }));
  const nominatim = (rows: unknown, status = 200) =>
    vi.spyOn(globalThis, "fetch").mockImplementation((async () => new Response(JSON.stringify(rows), { status })) as typeof fetch);

  it("q ผิด = 400 · method ไม่ใช่ GET = 405", async () => {
    const spy = nominatim([]);
    for (const qs of ["", "q=", "q=a", `q=${"x".repeat(101)}`]) expect((await geo(qs)).status, qs).toBe(400);
    expect((await geo("q=หัวหิน", { method: "POST" })).status).toBe(405);
    expect(spy).not.toHaveBeenCalled();
  });

  it("เรียก Nominatim ด้วย param + User-Agent ที่กำหนด และแปลงผลลัพธ์", async () => {
    const spy = nominatim([
      { display_name: "หัวหิน, ประจวบคีรีขันธ์", lat: "12.5684", lon: "99.9577", type: "town" },
      { display_name: "เสีย", lat: "x", lon: "y", type: "t" },
    ]);
    const res = await geo("q=" + encodeURIComponent("หัวหิน geo1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ display_name: "หัวหิน, ประจวบคีรีขันธ์", lat: 12.5684, lng: 99.9577, type: "town" }] });
    expect(spy).toHaveBeenCalledTimes(1);
    const [target, init] = spy.mock.calls[0];
    const u = new URL(String(target));
    expect(u.origin + u.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect(u.searchParams.get("countrycodes")).toBe("th");
    expect(u.searchParams.get("accept-language")).toBe("th");
    expect(u.searchParams.get("limit")).toBe("5");
    expect(u.searchParams.get("format")).toBe("jsonv2");
    expect(u.searchParams.get("q")).toBe("หัวหิน geo1");
    expect(new Headers(init?.headers).get("User-Agent")).toBe("plugmap-th/1.0 (+https://ev.thana.in.th)");
  });

  it("upstream 5xx หรือ fetch throw = 502", async () => {
    nominatim({ error: "x" }, 503);
    expect((await geo("q=err5xx")).status).toBe(502);
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    expect((await geo("q=errthrow")).status).toBe(502);
  });

  it("q เดิม (normalize แล้ว) ครั้งที่สองมาจาก cache ไม่ fetch ซ้ำ", async () => {
    const spy = nominatim([{ display_name: "X", lat: "1", lon: "2", type: "city" }]);
    const a = await geo("q=" + encodeURIComponent("Cache Me"));
    const b = await geo("q=" + encodeURIComponent("  cache   me "));
    expect(a.status).toBe(200);
    expect(await b.json()).toEqual(await a.clone().json());
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
