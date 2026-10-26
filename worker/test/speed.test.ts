import { describe, expect, it } from "vitest";
import { classifySpeed } from "../src/speed";

const c = (type: string | null, kw: number | null, count: number | null = 1) => ({ type, kw, count });

describe("classifySpeed", () => {
  it("kW >= 50 = dc", () => {
    expect(classifySpeed([c("Type 2", 50)])).toBe("dc");
    expect(classifySpeed([c(null, 120, null)])).toBe("dc");
  });
  it("ขอบ 49 / 50 kW", () => {
    expect(classifySpeed([c("Type 2", 49)])).toBe("ac");
    expect(classifySpeed([c("Type 2", 49.9)])).toBe("ac");
    expect(classifySpeed([c("Type 2", 50)])).toBe("dc");
  });
  it("มีหัว CCS2 / CHAdeMO / GB/T DC = dc แม้ไม่มี kW หรือ kW ต่ำ", () => {
    expect(classifySpeed([c("CCS2", null)])).toBe("dc");
    expect(classifySpeed([c("CHAdeMO", 10)])).toBe("dc");
    expect(classifySpeed([c("GB/T DC", null)])).toBe("dc");
    expect(classifySpeed([c("Tesla Supercharger", null, 3)])).toBe("dc");
  });
  it("Type 2 / Type 1 อย่างเดียว หรือ kW < 50 = ac", () => {
    expect(classifySpeed([c("Type 2", 22)])).toBe("ac");
    expect(classifySpeed([c("Type 1", null)])).toBe("ac");
    expect(classifySpeed([c("Type 2", null), c("Type 1", 7)])).toBe("ac");
    expect(classifySpeed([c(null, 22, null)])).toBe("ac");
  });
  it("ลำดับตัดสิน: DC มาก่อน AC", () => {
    expect(classifySpeed([c("Type 2", 22), c("CCS2", null)])).toBe("dc");
  });
  it("ไม่มีข้อมูล = unknown", () => {
    expect(classifySpeed([])).toBe("unknown");
    expect(classifySpeed(null)).toBe("unknown");
    expect(classifySpeed([c(null, null, null)])).toBe("unknown");
  });
});
