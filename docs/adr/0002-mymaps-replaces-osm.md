# ADR 0002 — Google My Maps แทน OpenStreetMap เป็นแหล่งข้อมูลจุดชาร์จ

- Status: Accepted (2026-10-26 09:55)
- Supersedes: ADR 0001 ข้อ 1 (ข้อมูลตั้งต้น = OSM) และข้อ 5 (Source `osm` | `user`) · ข้ออื่นของ ADR 0001 ยังใช้ต่อ
- ผลทดสอบเต็ม: `TESTING.md` หัวข้อ My Maps KML

## Context

ADR 0001 เลือก OSM (Overpass) ได้แค่ 307 จุด และ kW มีเพียง ~10% พี่หนุ่มพบ Google My Maps สาธารณะ
"DC EV Charging Station Thailand" รวบรวมโดย ปิยเมษฐ์ วิษณุเวช (แสดงเฉพาะสถานีชาร์จเร็ว DC)
map id `1YKD1Z5CdoyMnSTCOf2TgLmKV-REwfmIC` — export KML ได้โดยไม่ต้องใช้ key
(`https://www.google.com/maps/d/kml?mid=1YKD1Z5CdoyMnSTCOf2TgLmKV-REwfmIC&forcekml=1`, ~3.8 MB)

ผลตรวจ (2026-10-26 09:50):

- 3,007 Placemark (Point ทั้งหมด) เทียบ OSM 307 จุด
- มี kW ในข้อความประมาณ 54% (1,628 จุด) เทียบ OSM 10%
- ทุกจุดมี Provider, Latitude, Longitude, Description (ชนิดหัว/kW เป็นข้อความ)
- **ไม่ระบุ licence** — ผู้เขียนมีอีเมลติดต่อในคำอธิบายแผนที่ (ไม่คัดลอกมาลงเอกสาร)

พี่หนุ่มตัดสินใจ (2026-10-26): "ใช้แทน OSM เลย" และ "ใช้ในทีม + ใส่เครดิต"

## Decision

1. แหล่งข้อมูลหลัก = My Maps KML · **ยกเลิก OSM เป็นแหล่งข้อมูล** (Leaflet + OSM *tiles* เป็นแผนที่พื้นหลังยังอยู่)
2. Source = `mymaps` | `user` (`ocm` เก็บไว้เป็นอนาคต)
3. Nightly sync: Cron 02:00 ไทย (`0 19 * * *` UTC) ดึง KML ด้วย header `User-Agent` · retry 3 ครั้งแบบ backoff · ล้มเหลว = เก็บข้อมูลเดิม
4. id = `mymaps:<hash ของ lat,lng ปัดเศษ + name>` เพราะ KML ไม่มี id คงที่
   - **ความเสี่ยง:** ถ้าผู้เขียนขยับหมุดหรือเปลี่ยนชื่อ จุดนั้นจะกลายเป็น id ใหม่ → override ที่ผูกกับ id เก่าจะกำพร้า (orphan)
   - รับความเสี่ยงนี้ · **เก็บ orphan ไว้ไม่ลบ** และทำหน้า admin แสดงรายการ orphan ทีหลัง
5. จุดที่หายไปจาก KML ครั้งใหม่ → `deleted=1` (เฉพาะ source `mymaps`)
6. Parse: Description → `connectors_json` (รูปแบบ `Nx TYPE[:] KW kW (...)`) · fallback kW จากฟิลด์ Power
7. Operator จาก Provider (ชั้น Sharge มีฟิลด์ Operator เช่น ReverSharger — ใช้ Provider เป็นหลัก เก็บ Operator ไว้ใน `raw_json`)
8. เก็บเพิ่ม: Address, Name-EN, Hours, Dealership (ใน `raw_json` และคอลัมน์ `address`, `name_en`, `hours`)
9. แสดงเครดิตใน UI: "ข้อมูลจุดชาร์จ: DC EV Charging Station Thailand โดย ปิยเมษฐ์ วิษณุเวช (Google My Maps)"
10. ใช้ภายในทีมเท่านั้น · **ต้องขออนุญาตผู้เขียนก่อนเปิดแอปสาธารณะ**
11. จุด AC มาจากจุดที่ทีมเพิ่มเอง (`user`) เท่านั้นในตอนนี้

## Consequences

- ครอบคลุมจุด DC มากขึ้นราว 10 เท่า (3,007 vs 307) และมีชนิดหัว/kW มากขึ้น
- **มีเฉพาะ DC** — จุด AC ต้องพึ่งทีมเพิ่มเอง หรือ Phase 2 (OSM/OCM)
- พึ่งงานอาสาสมัครคนเดียว ไม่มี licence/SLA — ผู้เขียนหยุดดูแลหรือลบแผนที่ได้ทุกเมื่อ
- ข้อมูลจากผู้เขียนอัปเดตแล้วไหลเข้าอัตโนมัติทุกคืน
- Description เป็นข้อความอิสระ → parser ต้องทน format หลากหลาย (176 จุดว่าง) · จุดที่ parse ไม่ได้ = ชนิด/kW ไม่ทราบ (สีเทา หรือใช้ Power)
- id ไม่คงที่ตามข้อ 4 (override กำพร้า)
- ไม่ต้องมี Operator normalization ซับซ้อนเหมือน OSM (Provider เป็นค่ากำหนดไว้) แต่ยังต้องมีตาราง alias → ชื่อมาตรฐาน

## Alternatives

- **เก็บ OSM เป็นแหล่งที่ 2 คู่กับ My Maps** — ปฏิเสธ (พี่หนุ่มเลือกเพื่อความเรียบง่าย ไม่ต้อง dedupe สองแหล่ง) · ไปอยู่ Phase 2 สำหรับจุด AC
- **Import ครั้งเดียว** — ปฏิเสธ เพราะ sync ทุกคืนทำให้การอัปเดตของผู้เขียนไหลเข้ามาเอง
- **OCM / Google Places** — ยังเป็นไปไม่ได้ตาม ADR 0001

## Revisit when

- ผู้เขียนขอให้หยุดใช้ข้อมูล
- KML URL ใช้ไม่ได้หรือรูปแบบเปลี่ยน
- จะเปิดแอปสาธารณะ (ต้องขออนุญาตก่อน)
- ได้ OCM key (เพิ่มจุด AC)
