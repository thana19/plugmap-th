// KML parser (PRD: Nightly sync / connectors_json / Station id)
// ไม่ใช้ DOM (Workers ไม่มี DOMParser) — ใช้ regex scan ทีละ Placemark ทน 3.8 MB ได้

import { normalizeProvider } from "../normalize";
import type { Connector } from "../speed";

export interface ParsedStation {
  id: string;
  name: string;
  name_en: string | null;
  address: string | null;
  hours: string | null;
  operator: string;
  operator_raw: string;
  operator_slug: string | null;
  lat: number;
  lng: number;
  connectors: Connector[];
  /** ExtendedData ดิบที่ไม่มีคอลัมน์ของตัวเอง (Operator, Dealership, Power, Description, layer) */
  raw: Record<string, string>;
}

// ---------- XML helpers ----------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

/** ถอด CDATA (ไม่ decode ข้างใน) และ decode entity ส่วนที่อยู่นอก CDATA */
function xmlText(s: string): string {
  let out = "";
  let last = 0;
  for (const m of s.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    out += decodeEntities(s.slice(last, m.index));
    out += m[1];
    last = m.index + m[0].length;
  }
  out += decodeEntities(s.slice(last));
  return out.trim();
}

// ---------- Station id ----------

/** cyrb53 — hash 53 บิต แบบ sync ใช้ได้ทุก runtime */
function cyrb53(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** `mymaps:<hash>` ของ (lat,lng ปัด 5 ตำแหน่ง + name) */
export function stationId(lat: number, lng: number, name: string): string {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}|${name.trim()}`;
  return "mymaps:" + cyrb53(key).toString(16).padStart(14, "0");
}

// ---------- Description -> connectors ----------

/** "120 kW" -> 120 · ไม่ใช่ตัวเลข -> null */
export function parsePower(power: string | null | undefined): number | null {
  if (!power) return null;
  const m = /(\d+(?:\.\d+)?)/.exec(power);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return n > 0 ? n : null;
}

function canonicalType(raw: string): string {
  const t = raw.replace(/\s+/g, "").toLowerCase();
  if (t.startsWith("ccs")) return "CCS2";
  if (t === "chademo") return "CHAdeMO";
  if (t.startsWith("gb/t")) return "GB/T DC";
  return t === "type1" ? "Type 1" : "Type 2";
}

const DC_CANONICAL = new Set(["CCS2", "CHAdeMO", "GB/T DC", "Tesla Supercharger"]);

/** แยกด้วย , ที่อยู่นอกวงเล็บ */
function splitOutsideParens(line: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of line) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// [N x] TYPE [:] [N x] [KW kW]
const ITEM_RE =
  /^(?:(\d+)\s*x\s*)?(CCS\s*2|CHAdeMO|GB\/T(?:\s*DC)?|Type\s*[12])(?![A-Za-z0-9])\s*:?\s*(?:(\d+)\s*x\s*)?(?:(\d+(?:\.\d+)?)\s*kW)?/i;
const SUPERCHARGER_RE = /^(\d+)\s*Superchargers?\b/i;

export function parseConnectors(description: string | null | undefined, power?: string | number | null): Connector[] {
  const powerKw = typeof power === "number" ? power : parsePower(power);
  const items: Connector[] = [];

  for (const line of (description ?? "").split(/\r?\n/)) {
    for (const part of splitOutsideParens(line)) {
      const item = part.replace(/\([^)]*\)/g, " ").trim(); // (300A), (1000V 200A) ข้ามได้
      if (!item) continue;
      const m = ITEM_RE.exec(item);
      if (m) {
        const count = m[1] ?? m[3];
        items.push({
          type: canonicalType(m[2]),
          kw: m[4] ? parseFloat(m[4]) : null,
          count: count ? parseInt(count, 10) : 1,
        });
        continue;
      }
      const s = SUPERCHARGER_RE.exec(item);
      if (s) items.push({ type: "Tesla Supercharger", kw: null, count: parseInt(s[1], 10) });
      // ข้อความอื่น (CLOSED, Parking, 200A, เวลาเปิด ฯลฯ) ไม่ใช่หัวชาร์จ -> ข้าม
    }
  }

  // fallback kW จาก Power: ใช้เมื่อมีหัว DC ชนิดเดียวใน Description
  if (powerKw !== null) {
    const dcTypes = new Set(items.filter((c) => c.type && DC_CANONICAL.has(c.type)).map((c) => c.type));
    if (dcTypes.size === 1) {
      for (const c of items) if (c.type && DC_CANONICAL.has(c.type) && c.kw === null) c.kw = powerKw;
    }
  }

  // รวมรายการที่ type+kw เหมือนกัน (เช่น บรรทัดซ้ำใน Description)
  const merged: Connector[] = [];
  for (const c of items) {
    const same = merged.find((x) => x.type === c.type && x.kw === c.kw);
    if (same) same.count = (same.count ?? 1) + (c.count ?? 1);
    else merged.push({ ...c });
  }

  if (merged.length === 0 && powerKw !== null) return [{ type: null, kw: powerKw, count: null }];
  return merged;
}

// ---------- KML ----------

function parsePlacemark(block: string, layer: string | null): ParsedStation | null {
  const data: Record<string, string> = {};
  for (const m of block.matchAll(/<Data\s+name="([^"]*)"\s*>\s*(?:<value\s*\/>|<value>([\s\S]*?)<\/value>)?\s*<\/Data>/g)) {
    data[xmlText(m[1])] = m[2] === undefined ? "" : xmlText(m[2]);
  }

  // พิกัด: <coordinates>lng,lat[,alt]</coordinates> (เฉพาะ Point) · fallback Latitude/Longitude
  let lat = NaN;
  let lng = NaN;
  const pt = /<Point>[\s\S]*?<coordinates>\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)/.exec(block);
  if (pt) {
    lng = parseFloat(pt[1]);
    lat = parseFloat(pt[2]);
  } else if (!/<(LineString|Polygon|MultiGeometry)\b/.test(block)) {
    lat = parseFloat(data["Latitude"]);
    lng = parseFloat(data["Longitude"]);
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  // ชื่อ Placemark = <name> แรก (ก่อน ExtendedData)
  const nm = /<name>([\s\S]*?)<\/name>/.exec(block);
  const nameEn = data["Name-EN"] || null;
  const name = (nm ? xmlText(nm[1]) : "") || nameEn || "(ไม่มีชื่อ)";

  const providerRaw = data["Provider"] ?? "";
  const op = normalizeProvider(providerRaw);

  const raw: Record<string, string> = {};
  for (const k of ["Description", "Power", "Operator", "Dealership"]) if (data[k]) raw[k] = data[k];
  if (layer) raw.layer = layer;

  return {
    id: stationId(lat, lng, name),
    name,
    name_en: nameEn,
    address: data["Address"] || null,
    hours: data["Hours"] || null,
    operator: op.operator,
    operator_raw: providerRaw.trim(),
    operator_slug: op.operator_slug,
    lat,
    lng,
    connectors: parseConnectors(data["Description"], data["Power"]),
    raw,
  };
}

export function parseKml(xml: string): ParsedStation[] {
  const out: ParsedStation[] = [];
  let layer: string | null = null;
  const re = /<Folder\b[^>]*>\s*(?:<name>([\s\S]*?)<\/name>)?|<\/Folder>|<Placemark\b[\s\S]*?<\/Placemark>/g;
  for (const m of xml.matchAll(re)) {
    const tok = m[0];
    if (tok.startsWith("<Folder")) layer = m[1] ? xmlText(m[1]) : null;
    else if (tok === "</Folder>") layer = null;
    else {
      const st = parsePlacemark(tok, layer);
      if (st) out.push(st);
    }
  }
  return out;
}
