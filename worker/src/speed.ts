// Speed classifier (PRD: Speed class) — dc ส้ม / ac น้ำเงิน / unknown เทา

export interface Connector {
  type: string | null;
  kw: number | null;
  count: number | null;
}

export type SpeedClass = "dc" | "ac" | "unknown";

export const DC_KW_THRESHOLD = 50;

const DC_TYPES = new Set(["ccs2", "chademo", "gb/t dc", "gb/t", "tesla supercharger"]);

export function isDcType(type: string | null | undefined): boolean {
  return !!type && DC_TYPES.has(type.trim().toLowerCase());
}

export function classifySpeed(connectors: Connector[] | null | undefined): SpeedClass {
  const list = connectors ?? [];
  let hasInfo = false;
  for (const c of list) {
    if (isDcType(c.type)) return "dc";
    if (typeof c.kw === "number" && c.kw >= DC_KW_THRESHOLD) return "dc";
    if (c.type || typeof c.kw === "number") hasInfo = true;
  }
  return hasInfo ? "ac" : "unknown";
}
