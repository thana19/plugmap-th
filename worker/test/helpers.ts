import { env } from "cloudflare:workers";
import schema from "../schema.sql?raw";

export const PIN = "test-pin-1234";

/** แยก schema.sql เป็นคำสั่ง (D1.exec ต้องคำสั่งละบรรทัด จึงใช้ prepare+batch) */
function statements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function resetDb(): Promise<void> {
  await env.DB.batch(statements(schema).map((s) => env.DB.prepare(s)));
  await env.DB.batch(["stations", "station_overrides", "rate_limits", "bookmarks"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
}

export interface KmlStation {
  name: string;
  lat: number;
  lng: number;
  provider?: string;
  description?: string;
  power?: string;
}

/** สร้าง KML ขั้นต่ำให้ตรงรูปแบบของ My Maps */
export function kmlOf(stations: KmlStation[]): string {
  const pm = stations
    .map(
      (s) => `<Placemark><name>${s.name}</name><ExtendedData>
<Data name="Description"><value>${s.description ?? "CCS2"}</value></Data>
<Data name="Provider"><value>${s.provider ?? "PTT"}</value></Data>
${s.power ? `<Data name="Power"><value>${s.power}</value></Data>` : ""}
</ExtendedData><Point><coordinates>${s.lng},${s.lat},0</coordinates></Point></Placemark>`,
    )
    .join("\n");
  return `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>T</name>${pm}</Folder></Document></kml>`;
}

export const okFetch = (body: string): typeof fetch => (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
export const noSleep = async () => {};

export function req(path: string, init: RequestInit & { pin?: string | null; ip?: string } = {}): Request {
  const { pin = PIN, ip = "203.0.113.1", ...rest } = init;
  const headers = new Headers(rest.headers);
  if (pin) headers.set("X-Team-Pin", pin);
  headers.set("CF-Connecting-IP", ip);
  if (rest.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return new Request(`https://ev.test${path}`, { ...rest, headers });
}
