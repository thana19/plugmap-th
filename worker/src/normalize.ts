// Operator normalizer (PRD: Operator normalization · ADR 0003)
// KML `Provider` -> ชื่อมาตรฐาน + operator_slug (ใช้หาโลโก้ public/logos/<slug>.png)

export interface OperatorInfo {
  slug: string;
  name: string;
}

/** key = Provider ใน KML (lowercase) */
const ALIASES: Record<string, OperatorInfo> = {
  ptt: { slug: "ptt", name: "PTT EV Station PluZ" },
  pea: { slug: "pea", name: "PEA Volta" },
  ea: { slug: "ea", name: "EA Anywhere" },
  elex: { slug: "elexa", name: "EleXA (EGAT)" },
  sharge: { slug: "sharge", name: "Sharge" },
  mg: { slug: "mg", name: "MG" },
  altervim: { slug: "altervim", name: "Altervim" },
  tesla: { slug: "tesla", name: "Tesla" },
  galvanic: { slug: "galvanic", name: "Galvanic" },
  evolt: { slug: "evolt", name: "EVolt" },
  gwm: { slug: "gwm", name: "GWM" },
  mea: { slug: "mea", name: "MEA EV" },
  onecharge: { slug: "onecharge", name: "OneCharge" },
  haup: { slug: "haup", name: "Haup" },
};

export const OPERATOR_SLUGS: string[] = Object.values(ALIASES).map((o) => o.slug);
export const UNSPECIFIED_OPERATOR = "ไม่ระบุ";

// lookup เพิ่มเติม: ชื่อมาตรฐาน และ slug (ใช้กับ override ที่ทีมพิมพ์ชื่อยี่ห้อเอง)
const BY_ANY: Map<string, OperatorInfo> = new Map();
for (const [k, v] of Object.entries(ALIASES)) {
  BY_ANY.set(k, v);
  BY_ANY.set(v.slug, v);
  BY_ANY.set(v.name.toLowerCase(), v);
}

function key(s: string): string {
  return s.trim().toLowerCase();
}

/** หา operator จาก Provider / ชื่อมาตรฐาน / slug · ไม่ match = null */
export function lookupOperator(raw: string | null | undefined): OperatorInfo | null {
  if (!raw) return null;
  return BY_ANY.get(key(raw)) ?? null;
}

export interface NormalizedOperator {
  operator: string; // ชื่อมาตรฐาน หรือค่าดิบ หรือ "ไม่ระบุ"
  operator_slug: string | null;
}

export function normalizeProvider(raw: string | null | undefined): NormalizedOperator {
  const info = lookupOperator(raw);
  if (info) return { operator: info.name, operator_slug: info.slug };
  const trimmed = (raw ?? "").trim();
  return { operator: trimmed || UNSPECIFIED_OPERATOR, operator_slug: null };
}

/** slug จากชื่อ operator ที่เก็บใน D1 (หลัง override) */
export function slugForOperator(operator: string | null | undefined): string | null {
  return lookupOperator(operator)?.slug ?? null;
}
