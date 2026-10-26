import { describe, expect, it } from "vitest";
import { normalizeProvider, OPERATOR_SLUGS, slugForOperator } from "../src/normalize";

const TABLE: Array<[string, string, string]> = [
  ["PTT", "PTT EV Station PluZ", "ptt"],
  ["PEA", "PEA Volta", "pea"],
  ["EA", "EA Anywhere", "ea"],
  ["EleX", "EleXA (EGAT)", "elexa"],
  ["Sharge", "Sharge", "sharge"],
  ["MG", "MG", "mg"],
  ["Altervim", "Altervim", "altervim"],
  ["Tesla", "Tesla", "tesla"],
  ["Galvanic", "Galvanic", "galvanic"],
  ["EVolt", "EVolt", "evolt"],
  ["GWM", "GWM", "gwm"],
  ["MEA", "MEA EV", "mea"],
  ["OneCharge", "OneCharge", "onecharge"],
  ["Haup", "Haup", "haup"],
];

describe("normalizeProvider", () => {
  it.each(TABLE)("%s -> %s (%s)", (provider, name, slug) => {
    expect(normalizeProvider(provider)).toEqual({ operator: name, operator_slug: slug });
  });

  it("ครบ 14 ยี่ห้อ", () => {
    expect(TABLE).toHaveLength(14);
    expect(new Set(OPERATOR_SLUGS)).toEqual(new Set(TABLE.map((t) => t[2])));
  });

  it("ไม่สนตัวพิมพ์/ช่องว่าง", () => {
    expect(normalizeProvider("  ptt ").operator_slug).toBe("ptt");
    expect(normalizeProvider("ELEX").operator).toBe("EleXA (EGAT)");
  });

  it("Provider ว่าง = 'ไม่ระบุ' slug null", () => {
    expect(normalizeProvider("")).toEqual({ operator: "ไม่ระบุ", operator_slug: null });
    expect(normalizeProvider(undefined)).toEqual({ operator: "ไม่ระบุ", operator_slug: null });
    expect(normalizeProvider("   ")).toEqual({ operator: "ไม่ระบุ", operator_slug: null });
  });

  it("ไม่รู้จัก = ใช้ค่าดิบ slug null", () => {
    expect(normalizeProvider("Shell Recharge")).toEqual({ operator: "Shell Recharge", operator_slug: null });
  });
});

describe("slugForOperator (ชื่อมาตรฐานที่เก็บใน D1)", () => {
  it("ชื่อมาตรฐาน -> slug", () => {
    for (const [, name, slug] of TABLE) expect(slugForOperator(name)).toBe(slug);
  });
  it("ไม่รู้จัก/ว่าง -> null", () => {
    expect(slugForOperator("ไม่ระบุ")).toBeNull();
    expect(slugForOperator(null)).toBeNull();
  });
});
