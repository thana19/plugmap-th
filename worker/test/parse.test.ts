import { describe, expect, it } from "vitest";
import { parseConnectors, parseKml, parsePower, stationId } from "../src/sync/parse";
import fixture from "./fixtures/mymaps-sample.kml?raw";

describe("parsePower", () => {
  it("แปลง '120 kW' -> 120", () => {
    expect(parsePower("120 kW")).toBe(120);
    expect(parsePower("22.5 kW")).toBe(22.5);
  });
  it("ว่าง/ไม่ใช่ตัวเลข -> null", () => {
    expect(parsePower("")).toBeNull();
    expect(parsePower(undefined)).toBeNull();
    expect(parsePower("n/a")).toBeNull();
  });
});

describe("parseConnectors (ตารางใน PRD)", () => {
  it("CCS2 (Power = 120 kW) -> kW จาก Power", () => {
    expect(parseConnectors("CCS2", "120 kW")).toEqual([{ type: "CCS2", kw: 120, count: 1 }]);
  });
  it("CCS2 ไม่มี Power -> kw null, ไม่ระบุจำนวน = 1", () => {
    expect(parseConnectors("CCS2", "")).toEqual([{ type: "CCS2", kw: null, count: 1 }]);
  });
  it("CCS2, Type 2 (ไม่มี Power)", () => {
    expect(parseConnectors("CCS2, Type 2", null)).toEqual([
      { type: "CCS2", kw: null, count: 1 },
      { type: "Type 2", kw: null, count: 1 },
    ]);
  });
  it("CCS2, Type 2 + Power -> เติม kW ให้หัว DC เท่านั้น", () => {
    expect(parseConnectors("CCS2, Type 2", "120 kW")).toEqual([
      { type: "CCS2", kw: 120, count: 1 },
      { type: "Type 2", kw: null, count: 1 },
    ]);
  });
  it("DC หลายชนิดไม่มี kW -> ไม่เดา kW จาก Power", () => {
    expect(parseConnectors("CCS2, CHAdeMO, Type 2", "50 kW")).toEqual([
      { type: "CCS2", kw: null, count: 1 },
      { type: "CHAdeMO", kw: null, count: 1 },
      { type: "Type 2", kw: null, count: 1 },
    ]);
  });
  it("2x CCS2 150 kW", () => {
    expect(parseConnectors("2x CCS2 150 kW")).toEqual([{ type: "CCS2", kw: 150, count: 2 }]);
  });
  it("2x CCS2: 120 kW, 2x Type2: 22 kW", () => {
    expect(parseConnectors("2x CCS2: 120 kW, 2x Type2: 22 kW")).toEqual([
      { type: "CCS2", kw: 120, count: 2 },
      { type: "Type 2", kw: 22, count: 2 },
    ]);
  });
  it("2x CCS2: 180 kW", () => {
    expect(parseConnectors("2x CCS2: 180 kW")).toEqual([{ type: "CCS2", kw: 180, count: 2 }]);
  });
  it("2x CCS2 125 kW (300A) — วงเล็บข้ามได้", () => {
    expect(parseConnectors("2x CCS2 125 kW (300A)")).toEqual([{ type: "CCS2", kw: 125, count: 2 }]);
  });
  it("2x CCS2: 150 kW (1000V 200A), Type2: 3 kW — comma ในวงเล็บไม่แยก", () => {
    expect(parseConnectors("2x CCS2: 150 kW (1000V 200A), Type2: 3 kW")).toEqual([
      { type: "CCS2", kw: 150, count: 2 },
      { type: "Type 2", kw: 3, count: 1 },
    ]);
    expect(parseConnectors("CCS2: 150 kW (1000V, 200A)")).toEqual([{ type: "CCS2", kw: 150, count: 1 }]);
  });
  it("CCS2: 50 kW, CHAdeMO: 10 kW", () => {
    expect(parseConnectors("CCS2: 50 kW, CHAdeMO: 10 kW")).toEqual([
      { type: "CCS2", kw: 50, count: 1 },
      { type: "CHAdeMO", kw: 10, count: 1 },
    ]);
  });
  it("ว่าง -> [] · ว่าง + Power -> หัวไม่ทราบชนิดแต่มี kW", () => {
    expect(parseConnectors("", "")).toEqual([]);
    expect(parseConnectors(undefined, undefined)).toEqual([]);
    expect(parseConnectors("", "10 kW")).toEqual([{ type: null, kw: 10, count: null }]);
  });

  // รูปแบบจริงใน KML นอกเหนือจากตาราง PRD
  it("หลายบรรทัด + 'N x kW' หลัง colon + ขยะ (200A, CLOSED, Parking)", () => {
    expect(parseConnectors("CCS2: 6x 150 kW, 200A\nParking")).toEqual([{ type: "CCS2", kw: 150, count: 6 }]);
    expect(parseConnectors("CCS2: 2x 118 kW, 200A\nType2: CLOSED\nParking")).toEqual([
      { type: "CCS2", kw: 118, count: 2 },
      { type: "Type 2", kw: null, count: 1 },
    ]);
    expect(parseConnectors("Type1: 22 kW\nType2: 22 kW\nCCS2: 2x 50 kW\nParking")).toEqual([
      { type: "Type 1", kw: 22, count: 1 },
      { type: "Type 2", kw: 22, count: 1 },
      { type: "CCS2", kw: 50, count: 2 },
    ]);
  });
  it("'6x CCS2' ไม่มี kW + Power", () => {
    expect(parseConnectors("6x CCS2", "150 kW")).toEqual([{ type: "CCS2", kw: 150, count: 6 }]);
  });
  it("Tesla 'N Superchargers'", () => {
    expect(parseConnectors("3 Superchargers, Available 24/7", "250 kW")).toEqual([
      { type: "Tesla Supercharger", kw: 250, count: 3 },
    ]);
  });
  it("บรรทัดซ้ำ type+kW เดียวกัน -> รวมจำนวน", () => {
    expect(parseConnectors("2x CCS2 180 kW\n2x CCS2 180 kW")).toEqual([{ type: "CCS2", kw: 180, count: 4 }]);
  });
  it("ข้อความที่ไม่ใช่หัวชาร์จ (ที่อยู่ปนมา) ไม่สร้าง connector", () => {
    expect(parseConnectors("123 หมู่ 4 ต.หนองปรือ PEA VOLTA พัทยาใต้ #5")).toEqual([]);
    expect(parseConnectors("-")).toEqual([]);
  });
});

describe("parseKml (fixture 10 placemarks จาก KML จริง)", () => {
  const stations = parseKml(fixture);
  const byName = (n: string) => stations.find((s) => s.name.includes(n))!;

  it("พบครบทุก Placemark", () => {
    expect(stations).toHaveLength(10);
    expect(new Set(stations.map((s) => s.id)).size).toBe(10);
  });

  it("ฟิลด์ครบ: ชื่อไทย/EN/ที่อยู่/พิกัด/operator", () => {
    const s = byName("บิ๊กซี เพลซ สระบุรี");
    expect(s.name_en).toBe("BigC Place Saraburi");
    expect(s.address).toContain("ถ.พหลโยธิน");
    expect(s.lat).toBeCloseTo(14.5391089573, 8);
    expect(s.lng).toBeCloseTo(100.910758067, 8);
    expect(s.operator).toBe("PTT EV Station PluZ");
    expect(s.operator_slug).toBe("ptt");
    expect(s.operator_raw).toBe("PTT");
    expect(s.connectors).toEqual([{ type: "CCS2", kw: null, count: 1 }]);
  });

  it("ไม่มี Address / Name-EN -> null", () => {
    const s = byName("GWM แอทยูพาร์ค");
    expect(s.address).toBeNull();
    expect(s.name_en).toBeNull();
    expect(s.connectors).toEqual([]); // Description ว่าง ไม่มี Power
    expect(s.operator_slug).toBe("gwm");
  });

  it("Description ว่างแต่มี Power", () => {
    expect(byName("กรมส่งเสริมอุตสาหกรรม").connectors).toEqual([{ type: null, kw: 10, count: null }]);
  });

  it("Provider ว่าง -> operator 'ไม่ระบุ', slug null", () => {
    const s = byName("Brio Mall");
    expect(s.operator).toBe("ไม่ระบุ");
    expect(s.operator_slug).toBeNull();
    expect(s.operator_raw).toBe("");
    expect(s.connectors).toEqual([{ type: "CCS2", kw: null, count: 2 }]);
  });

  it("Sharge: ใช้ Provider เป็นหลัก เก็บ Operator ใน raw", () => {
    const s = byName("BYD Dreamcar");
    expect(s.operator).toBe("Sharge");
    expect(s.operator_slug).toBe("sharge");
    expect(s.raw.Operator).toBeTruthy();
    expect(s.raw.Power).toBe("120 kW");
    expect(s.connectors).toEqual([
      { type: "CCS2", kw: 120, count: 2 },
      { type: "Type 2", kw: 22, count: 2 },
    ]);
  });

  it("วงเล็บ (1000V 200A) และ layer ใน raw", () => {
    const s = byName("โลตัส นอร์ธ ราชพฤกษ์");
    expect(s.connectors).toEqual([
      { type: "CCS2", kw: 150, count: 4 },
      { type: "Type 2", kw: 3, count: 2 },
    ]);
    expect(s.raw.layer).toBeTruthy();
  });

  it("หลายบรรทัด + CLOSED + Hours", () => {
    const s = byName("A.C.T สาขาแมคโคร");
    expect(s.hours).toBe("Closed");
    expect(s.connectors.map((c) => c.type).sort()).toEqual(["CCS2", "Type 1", "Type 2"]);
    expect(s.connectors.find((c) => c.type === "CCS2")!.kw).toBe(90);
  });

  it("Tesla Superchargers", () => {
    expect(byName("Bluport Hua Hin").connectors).toEqual([{ type: "Tesla Supercharger", kw: 250, count: 3 }]);
  });

  it("CCS2 + CHAdeMO", () => {
    expect(byName("Bangchak Bgn-Baannadrem 50 kW").connectors).toEqual([
      { type: "CCS2", kw: 50, count: 1 },
      { type: "CHAdeMO", kw: 50, count: 1 },
    ]);
  });
});

describe("entity / CDATA / self-closing value", () => {
  it("decode &amp; และ CDATA และ <value/>", () => {
    const xml = `<kml><Document><Folder><name>F</name>
<Placemark><name>A &amp; B</name><ExtendedData>
<Data name="Name-EN"><value><![CDATA[Meet&Eat]]></value></Data>
<Data name="Address"><value/></Data>
<Data name="Provider"><value>EA</value></Data>
</ExtendedData><Point><coordinates>100.5,13.7,0</coordinates></Point></Placemark>
<Placemark><name>เส้นทาง</name><LineString><coordinates>100,13,0 101,14,0</coordinates></LineString></Placemark>
</Folder></Document></kml>`;
    const [s, ...rest] = parseKml(xml);
    expect(rest).toHaveLength(0); // LineString ถูกข้าม
    expect(s.name).toBe("A & B");
    expect(s.name_en).toBe("Meet&Eat");
    expect(s.address).toBeNull();
    expect(s.operator_slug).toBe("ea");
  });
});

describe("stationId", () => {
  it("parse ซ้ำได้ id เดิม", () => {
    expect(parseKml(fixture).map((s) => s.id)).toEqual(parseKml(fixture).map((s) => s.id));
    expect(stationId(13.7, 100.5, "x")).toMatch(/^mymaps:[0-9a-f]{14}$/);
  });
  it("พิกัดต่างกันเกินทศนิยม 5 ตำแหน่ง = id ใหม่ · เปลี่ยนชื่อ = id ใหม่", () => {
    const base = stationId(13.70000, 100.50000, "สถานี");
    expect(stationId(13.700001, 100.500001, "สถานี")).toBe(base); // ปัดเศษ 5 ตำแหน่ง = เดิม
    expect(stationId(13.70001, 100.5, "สถานี")).not.toBe(base);
    expect(stationId(13.7, 100.5, "สถานี 2")).not.toBe(base);
  });
});
