// Logo manifest (ADR 0003) — รันใน Node เพราะต้องอ่านไฟล์จริง
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPERATOR_SLUGS, normalizeProvider } from "../src/normalize";
import { parseKml } from "../src/sync/parse";

const root = process.cwd();
const logosDir = join(root, "public/logos");
const manifest: Array<{ slug: string; operator: string; color: string; abbr: string; file: string | null }> = JSON.parse(
  readFileSync(join(logosDir, "logos.json"), "utf8"),
);
const fixture = readFileSync(join(root, "worker/test/fixtures/mymaps-sample.kml"), "utf8");

describe("logos.json", () => {
  it("ทุก Provider ใน KML fixture ที่รู้จักมี entry (slug ตรง normalize.ts)", () => {
    const slugs = new Set(manifest.map((m) => m.slug));
    for (const s of parseKml(fixture)) {
      if (s.operator_slug) expect(slugs, `${s.operator_raw} -> ${s.operator_slug}`).toContain(s.operator_slug);
    }
  });

  it("ทุก slug ใน normalize.ts (14 ยี่ห้อ) มี entry และชื่อ operator ตรงกัน", () => {
    expect(OPERATOR_SLUGS).toHaveLength(14);
    for (const slug of OPERATOR_SLUGS) {
      const entry = manifest.find((m) => m.slug === slug);
      expect(entry, slug).toBeTruthy();
      expect(normalizeProvider(entry!.operator).operator_slug).toBe(slug);
    }
  });

  it("file ที่ไม่เป็น null มีไฟล์อยู่จริง · มี color + abbr", () => {
    for (const m of manifest) {
      expect(m.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(m.abbr.length).toBeGreaterThanOrEqual(2);
      expect(m.abbr.length).toBeLessThanOrEqual(4);
      if (m.file !== null) expect(existsSync(join(logosDir, m.file)), m.file).toBe(true);
    }
  });

  it("ขนาดรวมของ public/logos/ < 300 KB", () => {
    const total = readdirSync(logosDir).reduce((sum, f) => sum + statSync(join(logosDir, f)).size, 0);
    expect(total).toBeLessThan(300 * 1024);
  });
});
