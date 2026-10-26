// Team PIN + rate limit การเขียน (PRD: Team PIN)

export const WRITE_LIMIT_PER_HOUR = 30;

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // เทียบเต็มความยาวที่ยาวกว่า เพื่อไม่รั่วความยาว PIN ผ่านเวลา
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/** true เมื่อ X-Team-Pin ตรงกับ TEAM_PIN (ไม่ได้ตั้ง TEAM_PIN = ปฏิเสธเสมอ) */
export function checkPin(request: Request, env: { TEAM_PIN?: string }): boolean {
  const expected = env.TEAM_PIN;
  if (!expected) return false;
  const given = request.headers.get("X-Team-Pin") ?? "";
  return timingSafeEqual(given, expected);
}

function hourWindow(now: Date): string {
  return now.toISOString().slice(0, 13);
}

/**
 * นับการเขียน 1 ครั้งของ IP นี้ในชั่วโมงปัจจุบัน · คืน true ถ้ายังไม่เกินโควตา
 * นับทุก attempt (รวม PIN ผิด) เพื่อกัน brute-force PIN ด้วย
 */
export async function consumeWriteQuota(
  db: D1Database,
  ip: string,
  now: Date = new Date(),
  limit: number = WRITE_LIMIT_PER_HOUR,
): Promise<boolean> {
  const window = hourWindow(now);
  const rows = await db.batch([
    db.prepare("DELETE FROM rate_limits WHERE window < ?").bind(window),
    db
      .prepare(
        "INSERT INTO rate_limits (ip, window, count) VALUES (?, ?, 1) " +
          "ON CONFLICT(ip, window) DO UPDATE SET count = count + 1 RETURNING count",
      )
      .bind(ip, window),
  ]);
  const count = (rows[1].results[0] as { count: number } | undefined)?.count ?? 1;
  return count <= limit;
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown";
}
