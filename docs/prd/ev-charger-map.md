# PRD — EV-Charger Map

อัปเดตล่าสุด: 2026-10-26 10:05 · อ้างอิง: `CONTEXT.md`, `docs/adr/0001-data-sources.md`, `docs/adr/0002-mymaps-replaces-osm.md`, `docs/adr/0003-brand-logo-markers.md`, `TESTING.md`

## Problem Statement

ทีมร้าน EV ต้องการหาจุดชาร์จใกล้ตัว พร้อมรู้ยี่ห้อ ชนิดหัว kW และความเร็วในการชาร์จ แต่ตอนนี้ต้องเปิดหลายแอปของแต่ละยี่ห้อ

## Solution

PWA แผนที่รวมทุกยี่ห้อ รันบน Cloudflare (Worker + D1 + static assets) ข้อมูลตั้งต้นจาก Google My Maps "DC EV Charging Station Thailand" (ADR 0002 · เฉพาะจุดชาร์จเร็ว DC · ใช้ในทีม + ใส่เครดิต) เสริมด้วยข้อมูลที่ทีมเพิ่ม/แก้เอง · โดเมน PRD `ev.thana.in.th` · UAT `ev-uat.thana.in.th`

> การรายงานสถานะ ว่าง/ไม่ว่าง ถูกตัดออกจาก MVP (2026-10-26) ย้ายไป Phase 2

## User Stories

1. ในฐานะคนในทีม ฉันอยากเปิดแอปแล้วเห็นจุดชาร์จรอบตัวจาก GPS
2. ในฐานะคนในทีม ฉันอยากเลื่อนแผนที่แล้วโหลดจุดอัตโนมัติ
3. ในฐานะคนในทีม ฉันอยากกดหมุดแล้วเห็น ยี่ห้อ ชนิดหัว จำนวน และ kW
4. ในฐานะคนในทีม ฉันอยากกดนำทางเพื่อเปิด Google Maps
5. ในฐานะคนในทีม ฉันอยากกดแชร์ลิงก์ของจุดชาร์จ
6. ในฐานะคนในทีม ฉันอยากเห็นยี่ห้อจากโลโก้บนหมุด และแยกจุดชาร์จเร็ว (DC) กับธรรมดา (AC) ได้จากสีขอบหมุด
7. ในฐานะคนในทีม ฉันอยากเพิ่มจุดใหม่ (กดค้างบนแผนที่ หรือใช้ตำแหน่งปัจจุบัน)
8. ในฐานะคนในทีม ฉันอยากแก้ข้อมูลหัวชาร์จของจุดที่ข้อมูลไม่ครบ
9. ในฐานะคนในทีม ฉันอยากกรองตามยี่ห้อ/ชนิดหัว/kW ขั้นต่ำ
10. ในฐานะคนในทีม ฉันอยากติดตั้งแอปลงหน้าจอมือถือ
11. ในฐานะคนในทีม ฉันอยากลบจุดที่ทีมเพิ่มเองผิดพลาดหรือซ้ำ (ลบได้เฉพาะจุด source `user` ต้องใส่ PIN · เป็น soft delete เก็บว่าใครลบเมื่อไหร่)

## Implementation Decisions

### Speed class (สีขอบหมุด)

คำนวณฝั่ง client จาก `connectors_json` (หลังรวม override):

| Speed class | เงื่อนไข | สีขอบหมุด |
|---|---|---|
| DC เร็ว | max kW ≥ 50 หรือมีหัว CCS2 / CHAdeMO / GB/T DC | ส้ม |
| AC | มีแค่ Type 2 / Type 1 หรือ max kW < 50 | น้ำเงิน |
| ไม่ทราบ | ไม่มีข้อมูลชนิดหัวและ kW | เทา |

- ลำดับตัดสิน: ถ้าเข้าเงื่อนไข DC เร็วก่อน → ส้ม · ไม่เช่นนั้นถ้ามีข้อมูลชนิดหัวหรือ kW → น้ำเงิน · ไม่มีเลย → เทา
- popup ไม่แสดงสถานะหรือเวลารายงานล่าสุด (ไม่มีในระบบ)

### Team PIN

- เก็บเป็น Worker secret `TEAM_PIN`, ส่งใน header `X-Team-Pin`, ผิด = 401
- เก็บใน localStorage ของเครื่องหลังใส่ครั้งแรก
- Rate limit เขียน 30 ครั้ง/ชม./IP
- ชื่อผู้แก้/ผู้ลบ (ไม่บังคับ) เก็บใน localStorage

### D1 schema

- `stations` — `id` TEXT PK (เช่น `mymaps:<hash>` หรือ `user:<uuid>`), `source` (`mymaps` | `user`), `name` (ชื่อไทย), `name_en`, `address`, `hours`, `operator`, `operator_raw`, `lat`, `lng`, `connectors_json`, `raw_json` (ExtendedData ดิบจาก KML เช่น Operator, Dealership, Power), `updated_at`, `deleted` INTEGER (default 0), `deleted_by` TEXT, `deleted_at` TEXT
- `station_overrides` — `station_id`, `name`, `operator`, `connectors_json`, `edited_by`, `edited_at`
- index ที่ (`lat`, `lng`)

### Station id (source `mymaps`)

- รูปแบบ `mymaps:<hash>` โดย hash = hash ของ (`lat`, `lng` ปัดเศษ 5 ตำแหน่ง + `name`) เพราะ KML ไม่มี id คงที่
- ถ้าผู้เขียนขยับหมุดหรือเปลี่ยนชื่อ → ได้ id ใหม่ · override ที่ผูก id เก่ากลายเป็น orphan → **เก็บไว้ไม่ลบ** แล้วทำหน้า admin แสดง orphan ทีหลัง (ADR 0002)
- ชื่อซ้ำพิกัดซ้ำใน KML (ถ้ามี) → hash ชนกัน ให้ upsert ตัวเดียว

### connectors_json

รูปแบบ: `[{"type":"CCS2","kw":120,"count":2}]`

Parse จาก KML `Description` (ข้อความอิสระ) เป็น `connectors_json`:

- แยก item ด้วย `,` ที่อยู่นอกวงเล็บ · แต่ละ item รูปแบบ `[N x] TYPE[:] [KW kW] [(...)]`
- ชนิดที่รู้จัก: `CCS2` → CCS2 · `Type2` / `Type 2` → Type 2 · `CHAdeMO` → CHAdeMO · `GB/T` → GB/T DC
- ไม่ระบุจำนวน → count = 1 · วงเล็บ `(300A)`, `(1000V 200A)` ข้ามได้ (เก็บใน `raw_json`)
- `CCS2` เดี่ยว ๆ ไม่มี kW → type CCS2 และ kW มาจากฟิลด์ Power ถ้ามีหัว DC ชนิดเดียวใน Description · ถ้ามี DC หลายชนิดหรือไม่มี Power → kw = null
- Description ว่าง (176 จุด) → ถ้ามี Power ให้ `[{"type":null,"kw":<Power>,"count":null}]` ไม่มีเลย → `[]` (Speed class = ไม่ทราบ)
- Power format เช่น `120 kW` → 120

ตัวอย่าง:

| Description | connectors_json |
|---|---|
| `CCS2` (Power = 120 kW) | `[{"type":"CCS2","kw":120,"count":1}]` |
| `CCS2, Type 2` | `[{"type":"CCS2","kw":<Power|null>,"count":1},{"type":"Type 2","kw":null,"count":1}]` |
| `2x CCS2 150 kW` | `[{"type":"CCS2","kw":150,"count":2}]` |
| `2x CCS2: 120 kW, 2x Type2: 22 kW` | `[{"type":"CCS2","kw":120,"count":2},{"type":"Type 2","kw":22,"count":2}]` |
| `2x CCS2: 180 kW` | `[{"type":"CCS2","kw":180,"count":2}]` |
| `2x CCS2 125 kW (300A)` | `[{"type":"CCS2","kw":125,"count":2}]` |
| `2x CCS2: 150 kW (1000V 200A), Type2: 3 kW` | `[{"type":"CCS2","kw":150,"count":2},{"type":"Type 2","kw":3,"count":1}]` |
| `CCS2: 50 kW, CHAdeMO: 10 kW` | `[{"type":"CCS2","kw":50,"count":1},{"type":"CHAdeMO","kw":10,"count":1}]` |
| (ว่าง) | `[]` หรือ kW จาก Power |

### Operator normalization

ใช้ฟิลด์ `Provider` ของ KML เป็นหลัก (ไม่ใช้ `Operator` — ชั้น Sharge มีค่า Operator เช่น ReverSharger เก็บไว้ใน `raw_json`) · ตาราง alias ในโค้ด (แต่ละ alias มี `operator_slug` ด้วย เช่น `ptt`, `pea` — ใช้หาโลโก้ ADR 0003) · ไม่ match / Provider ว่าง (3 จุด) = ใช้ค่าดิบ (ว่าง = "ไม่ระบุ")

| Provider (KML) | ชื่อมาตรฐาน |
|---|---|
| PTT | PTT EV Station PluZ |
| PEA | PEA Volta |
| EA | EA Anywhere |
| EleX | EleXA (EGAT) |
| Sharge | Sharge |
| MG | MG |
| Altervim | Altervim |
| Tesla | Tesla |
| Galvanic | Galvanic |
| EVolt | EVolt |
| GWM | GWM |
| MEA | MEA EV |
| OneCharge | OneCharge |
| Haup | Haup |

### Nightly sync

- Cron `0 19 * * *` UTC (02:00 ไทย) ดึง KML `https://www.google.com/maps/d/kml?mid=1YKD1Z5CdoyMnSTCOf2TgLmKV-REwfmIC&forcekml=1` (~3.8 MB) พร้อม header User-Agent
- Retry 3 ครั้งแบบ backoff · ถ้าล้มเหลวเก็บข้อมูลเดิม (รวมกรณี KML ว่าง/parse ได้น้อยผิดปกติ → ไม่ลบอะไร)
- Parse Placemark (Point) → `name` = ชื่อไทย, ExtendedData: Provider, Description, Power, Address, Name-EN, Hours, Operator, Dealership, Latitude, Longitude
- Upsert ตาม id · จุดที่หายจาก KML ครั้งใหม่ → `deleted=1` (เฉพาะ source `mymaps`) · ถ้ากลับมาใน KML → `deleted=0`
- override ไม่ถูกแตะ · override ที่ id หายไป = orphan เก็บไว้

### API

| Endpoint | หมายเหตุ |
|---|---|
| `GET /api/stations?bbox=minLng,minLat,maxLng,maxLat` | max 500 จุด, merge override, ซ่อนจุด `deleted=1` · ทุก station ใน response มี `operator_slug` (null ถ้า Provider ไม่ match alias) คู่กับ `speed` · มี field `hub` (boolean) ทุกจุด — Hub = ชื่อ/`name_en` ตรง `/\bhub\b|\(ฮับ\)|ฮับสถานี/i` (`isHub`) |
| `GET /api/stations?hub=1` | คืน Hub ทั่วประเทศ (ปัจจุบัน 12 จุด) ไม่ต้องมี bbox · ถ้าส่ง bbox มาด้วยจะจำกัดเฉพาะในกรอบ |
| `GET /api/stations/:id` | |
| `POST /api/stations` | ต้อง PIN |
| `PATCH /api/stations/:id` | ต้อง PIN, เขียน override |
| `DELETE /api/stations/:id` | ต้อง PIN, ลบได้เฉพาะ source `user` (soft delete: `deleted=1`, `deleted_by`, `deleted_at`) · source `mymaps` = 403 |
| `POST /api/admin/sync` | ต้อง PIN, trigger sync เอง |

### Frontend

- static `public/` (`index.html`, `app.js`, `styles.css`, `manifest.json`, `sw.js`) vanilla JS + Leaflet 1.9.4 จาก cdnjs + Leaflet.markercluster
- โหลดใหม่เมื่อ `moveend` (debounce 300ms)
- หมุดโลโก้ยี่ห้อ ขอบสีตาม Speed class — ดูหัวข้อ "Markers & logos" ข้างล่าง
- ตัวกรองมีหมวด "ประเภทสถานี" chip "Hub (สถานีชาร์จขนาดใหญ่)" — เปิดแล้วโหลด `?hub=1` โดยไม่สนระดับซูมขั้นต่ำ · bottom sheet แสดงป้าย "Hub"
- ลิงก์นำทาง `https://www.google.com/maps/dir/?api=1&destination=LAT%2CLNG&travelmode=driving`
- แชร์ด้วย Web Share API, fallback copy ลิงก์
- ปุ่มลบแสดงเฉพาะจุด source `user`
- service worker cache app shell เท่านั้น
- UI ภาษาไทย ตัวหนังสือใหญ่ใช้กับมือถือ
- popup แสดงชื่อ (ไทย + อังกฤษถ้ามี `name_en`), ที่อยู่ (`address`), เวลาเปิด (`hours`) ถ้ามี
- แสดงเครดิตแหล่งข้อมูลใน UI: "ข้อมูลจุดชาร์จ: DC EV Charging Station Thailand โดย ปิยเมษฐ์ วิษณุเวช (Google My Maps)"
- แสดง attribution แผนที่พื้นหลัง "© OpenStreetMap contributors" (tiles เท่านั้น)

### Markers & logos (ADR 0003)

พี่หนุ่มตัดสินใจ 2026-10-26: "โลโก้จริงในหมุดกลม + ขอบสีความเร็ว"

- หมุด = Leaflet `L.divIcon` วงกลมประมาณ 36px พื้นขาว โลโก้อยู่กึ่งกลาง · **ขอบ 3px สีตาม Speed class** (ส้ม DC / น้ำเงิน AC / เทา ไม่ทราบ) · มีหางเล็กชี้ตำแหน่งจริง · หมุดที่ถูกเลือกขยายใหญ่ขึ้น
- ไม่มีโลโก้ หรือโหลดรูปไม่สำเร็จ (`onerror`) → แสดงตัวย่อ 2–4 ตัวอักษร บนสีแบรนด์
- คง Leaflet.markercluster แบบตัวเลข · โลโก้แสดงเมื่อซูมเข้าจนแตกกลุ่ม (ประสิทธิภาพ ~3,000 จุด)
- ไฟล์โลโก้ ~14 ยี่ห้อ (PTT EV Station PluZ, PEA Volta, EA Anywhere, Sharge, EleXA (EGAT), MG, Altervim, Tesla, Galvanic, EVolt, GWM, MEA EV, OneCharge, Haup) ใช้ไอคอนแอปทางการของแต่ละยี่ห้อจาก App Store (ตรวจชื่อผู้พัฒนาตรงกับเจ้าของแบรนด์ผ่าน iTunes lookup API · อัปเดต 2026-10-26 10:20: เว็บแบรนด์หลายแห่งดึงอัตโนมัติไม่ได้) แปลงเป็น PNG 96×96 ที่ `public/logos/<slug>.png` รวมไม่เกิน 300 KB
- Manifest `public/logos/logos.json` = array ของ `{ slug, operator, color, abbr, file, source_url, fetched_at }` (`file` เป็น `null` ได้ → ใช้ตัวย่อ)
- Worker ส่ง `operator_slug` ใน API · frontend map slug → `logos.json`
- popup แสดงวงกลมโลโก้ข้างชื่อยี่ห้อ
- เครื่องหมายการค้า: โลโก้เป็นของเจ้าของยี่ห้อ ใช้ภายในทีมเท่านั้น **ต้องตรวจการใช้ก่อนเปิดสาธารณะ** (gate เดียวกับข้อมูล My Maps ใน ADR 0002)

### Environments

UAT และ PRD เป็น Worker + D1 แยกกัน (wrangler env) · ถามพี่หนุ่มก่อน deploy เสมอ

- PRD: `ev.thana.in.th` · UAT: `ev-uat.thana.in.th` (Cloudflare custom domain บน Worker)

## Modules

| Module | ไฟล์ | หน้าที่ |
|---|---|---|
| Worker router | `worker/src/index.ts` | รับ request, route API, scheduled handler |
| My Maps sync | `worker/src/sync/mymaps.ts` | ดึง KML, retry, upsert ลง D1, mark deleted ที่หายจาก KML |
| KML parser | `worker/src/sync/parse.ts` | parse KML ExtendedData + แปลง Description (ข้อความชนิดหัว/kW) เป็น `connectors_json` |
| Operator normalizer | `worker/src/normalize.ts` | map ชื่อ Operator ตาม alias + ให้ `operator_slug` ของแต่ละยี่ห้อ (ใช้ map โลโก้) |
| Speed classifier | `worker/src/speed.ts` | แปลง connectors เป็น Speed class (`dc` / `ac` / `unknown`) แนบเป็น field `speed` ใน response ของ API — คำนวณฝั่ง Worker เพื่อให้ทดสอบด้วย vitest ได้และใช้ทำ filter ฝั่ง server ทีหลัง |
| Auth/PIN + rate limit | `worker/src/auth.ts` | ตรวจ `X-Team-Pin`, จำกัดการเขียน |
| DB schema | `worker/schema.sql` | ตาราง + index |
| Frontend | `public/*` | แผนที่, UI, PWA, หมุดโลโก้ (`L.divIcon`) |
| Brand logos | `public/logos/` | `<slug>.png` 96×96 (~14 ไฟล์ รวม < 300 KB) + `logos.json` manifest |
| Config | `wrangler.jsonc` | bindings, cron, env UAT/PRD, custom domain |

## Testing

### Unit (vitest)

- `parse.ts` — connector strings ตามตัวอย่างจริง (ตารางข้างบน): `CCS2`, `CCS2, Type 2`, `2x CCS2 150 kW`, `2x CCS2: 120 kW, 2x Type2: 22 kW`, `2x CCS2: 180 kW`, `2x CCS2 125 kW (300A)`, `2x CCS2: 150 kW (1000V 200A), Type2: 3 kW`, `CCS2: 50 kW, CHAdeMO: 10 kW`, ว่าง · ไม่ระบุจำนวน = 1 · fallback kW จาก Power · Power format
- `parse.ts` — KML fixture ~5 placemarks (ครอบคลุม Description หลายแบบ, ไม่มี Address/Name-EN, Provider ว่าง, Sharge ที่มี Operator) → ฟิลด์ครบ
- id stability — parse ซ้ำได้ id เดิม · ขยับพิกัด/เปลี่ยนชื่อ = id ใหม่
- `normalize.ts` — ตาราง Provider → ชื่อมาตรฐาน (14 ค่า) + Provider ว่าง/ไม่รู้จัก
- `normalize.ts` — Operator → `operator_slug` ครบ 14 ยี่ห้อ + Provider ว่าง/ไม่รู้จัก = `null`
- Logo manifest — ทุก Provider ใน KML fixture ต้องมี entry ใน `logos.json` (slug ตรงกับ `normalize.ts`) · `file` ที่ไม่เป็น `null` ต้องมีไฟล์อยู่จริง · ขนาดรวมของ `public/logos/` < 300 KB
- Speed classification (สีขอบหมุด) — kW ≥ 50 = ส้ม, มี CCS2/CHAdeMO/GB/T DC = ส้ม, Type 2/Type 1 อย่างเดียวหรือ kW < 50 = น้ำเงิน, ไม่มีข้อมูล = เทา, ขอบ 49/50 kW

### Integration (vitest + `@cloudflare/vitest-pool-workers` + D1 local)

- bbox query
- POST/PATCH/DELETE ต้อง PIN (ไม่มี = 401)
- DELETE จุด source `user` สำเร็จ (ตั้ง `deleted`, `deleted_by`, `deleted_at`) · DELETE จุด source `mymaps` = 403
- จุดที่ `deleted=1` ไม่โผล่ใน bbox query
- override ไม่ถูก sync เขียนทับ
- จุดที่หายจาก KML → `deleted=1` · กลับมา → `deleted=0`
- sync ล้มเหลวแล้วข้อมูลเดิมยังอยู่ (mock KML fetch ล้ม/ตอบ 5xx)

### E2E manual

ผ่าน Chrome DevTools MCP ที่จอมือถือ: GPS mock, คลิกหมุด, สีขอบหมุดตรงตาม Speed class, โลโก้ในหมุดตรงยี่ห้อ, fallback ตัวย่อเมื่อ `file` เป็น `null` หรือรูปโหลดไม่ได้ (`onerror` — จำลองด้วยการบล็อกรูป), โลโก้โผล่เมื่อซูมเข้า/cluster ตัวเลขเมื่อซูมออก, หมุดที่เลือกขยายใหญ่, ลิงก์นำทาง, เพิ่มจุดแล้ว reload ยังอยู่, ลบจุดที่เพิ่มเองแล้วหายจากแผนที่

### UAT

ทดสอบบนมือถือจริงที่ `ev-uat.thana.in.th` ก่อน deploy PRD

## Out of Scope

- Google Places
- ข้อมูล OSM (ยกเลิกเป็นแหล่งข้อมูลแล้ว — ADR 0002 · OSM tiles ยังใช้เป็นแผนที่พื้นหลัง)
- OCM / จุด AC จาก OSM-OCM (Phase 2)
- รายงานสถานะ ว่าง/ไม่ว่าง/เสีย (Report, TTL, ตาราง `reports`) — Phase 2 (ตัดออกจาก MVP 2026-10-26)
- login รายคน
- จอง/จ่ายเงิน
- แอป native
- เปิดสาธารณะ (ต้องขออนุญาตผู้เขียน My Maps และตรวจการใช้เครื่องหมายการค้าของโลโก้ก่อน)
- scraping

## Decisions (2026-10-26)

พี่หนุ่มตอบคำถามเปิดแล้ว:

1. **โดเมน:** PRD = `ev.thana.in.th` · UAT = `ev-uat.thana.in.th` (Cloudflare custom domain บน Worker)
2. **สถานะว่าง/ไม่ว่าง:** ตัดออกจาก MVP ทั้งหมด → Phase 2 · สีหมุดใช้ความเร็วชาร์จแทน (ส้ม DC เร็ว / น้ำเงิน AC / เทา ไม่ทราบ)
3. **ลบจุด:** ลบจุดที่ทีมเพิ่มเองได้ (soft delete) ต้องใส่ PIN, เฉพาะ source `user`
4. **Modules + test plan:** พี่หนุ่มยืนยันแล้ว (ตัดส่วนสถานะออก)

5. **แหล่งข้อมูล (ADR 0002):** ใช้ Google My Maps "DC EV Charging Station Thailand" (ปิยเมษฐ์ วิษณุเวช) แทน OSM เลย · ใช้ในทีม + ใส่เครดิตใน UI · ขออนุญาตผู้เขียนก่อนเปิดสาธารณะ · มีเฉพาะ DC (3,007 จุด) จุด AC มาจากทีมเพิ่มเอง

6. **หมุดโลโก้ (ADR 0003):** หมุดแสดงโลโก้จริงของยี่ห้อในวงกลมขาว ขอบ 3px สีความเร็ว (ส้ม/น้ำเงิน/เทา) + หาง · ไม่มีโลโก้ = ตัวย่อบนสีแบรนด์ · โลโก้ = ไอคอนแอปทางการจาก App Store · ใช้ในทีม ตรวจเครื่องหมายการค้าก่อนเปิดสาธารณะ · ไม่เอาตัวย่ออย่างเดียว / ไม่ให้พี่หนุ่มส่งไฟล์เอง

ยังเปิดอยู่: ใครตั้ง PIN → PIN ตั้งโดยพี่หนุ่มตอน deploy ผ่าน `wrangler secret put TEAM_PIN`
