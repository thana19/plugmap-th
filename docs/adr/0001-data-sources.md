# ADR 0001 — แหล่งข้อมูลจุดชาร์จ: OpenStreetMap + ข้อมูลจากทีม

- Status: Superseded in part by ADR 0002 (2026-10-26)
- หมายเหตุ: ข้อ 1 และข้อ 5 (OSM เป็นแหล่งข้อมูล / Source `osm`) ถูกแทนด้วย Google My Maps ตาม `docs/adr/0002-mymaps-replaces-osm.md` · ข้ออื่นยังใช้ต่อ (OSM tiles ยังเป็นแผนที่พื้นหลัง)
- ผลทดสอบเต็ม: `TESTING.md` หัวข้อ Phase 0 spike

## Context

ผล Phase 0 spike (2026-10-26 07:30):

- **OCM** — ขอ API key ไม่ได้ (เว็บใหม่ไม่มีส่วน API key, หน้า develop ขึ้น error, API ไม่มี key ตอบ 403)
- **OpenStreetMap (Overpass)** — ใช้ได้ ได้ 307 Station ในไทย แต่ข้อมูลไม่ครบ: operator/brand 64%, จำนวนหัว 42%, ชนิดหัว 17%, kW 10%
- **Google Places API (New)** — 403 "The caller does not have permission" ทุกครั้ง ทั้งที่ตั้งค่า key/billing/API แล้ว ยังไม่รู้สาเหตุ และถ้าใช้ข้อมูล Google ต้องแสดงบน Google Map, cache ได้แค่ place_id

ข้อจำกัดอื่น: ผู้ให้บริการไทยไม่มี API สาธารณะ และ**ห้าม scrape** แอป/เว็บผู้ให้บริการ (ผิด ToS)

## Decision

1. ข้อมูลตั้งต้น = OSM ผ่าน Overpass sync ทุกคืนลง D1 · licence ODbL → ต้องใส่ attribution "© OpenStreetMap contributors" บนแผนที่
2. แผนที่ = Leaflet + OSM tiles
3. สถานะว่าง/ไม่ว่าง = Report จากทีมเท่านั้น
   - อัปเดต 2026-10-26: ตัดสถานะว่าง/ไม่ว่างออกจาก MVP ตามพี่หนุ่ม — Phase 2
4. ทีมเพิ่ม Station เองได้ และแก้ข้อมูลหัวชาร์จ/kW/Operator ของ Station จาก OSM ได้ — เก็บเป็น override แยก ไม่เขียนทับข้อมูล OSM ตอน sync
5. ออกแบบ Source เป็น pluggable (`osm` | `user` | อนาคต `ocm`) และ dedupe ด้วยระยะ ≤ 50 ม.

**หมายเหตุ — ต่างจาก CONTEXT.md:** CONTEXT.md นิยาม Source เป็น `ocm` | `user` ADR นี้เปลี่ยน Source ของ MVP เป็น `osm` | `user` (`ocm` เก็บไว้เป็นอนาคต) และ Nightly sync ใช้ Overpass แทน OCM — ต้องแก้ Glossary ใน CONTEXT.md ให้ตรงกัน

## Consequences

- ข้อมูลไม่ครบ (โดยเฉพาะ kW และชนิดหัว) ต้องพึ่งทีมช่วยเติม
- ฟรี และไม่ติดเงื่อนไข Google
- ถ้า Overpass ล่ม sync จะเก็บข้อมูลเดิมไว้ ไม่ลบทิ้ง
- ต้องมี Operator normalization เพราะชื่อใน OSM ไม่สม่ำเสมอ

## Alternatives rejected

- **OCM** — ยังไม่มี key
- **Google Places** — 403 + ต้องใช้ Google Map (ใช้ Leaflet ไม่ได้) + ห้าม cache ข้อมูล
- **Scraping ผู้ให้บริการ** — ผิด ToS

## Revisit when

- ได้ OCM key
- Google key ใช้ได้
- ฐานข้อมูลจุดชาร์จแห่งชาติเปิดให้ใช้
