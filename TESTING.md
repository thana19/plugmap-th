# TESTING.md — EV-Charger

## Phase 0 spike (2026-10-26 07:30)

ทดสอบแหล่งข้อมูลจุดชาร์จ 3 แหล่งก่อนสร้างจริง

### Open Charge Map (OCM) — ทำไม่ได้

- เว็บ OCM เปลี่ยนหน้าตาใหม่ เมนู My Profile/Settings ไม่มีส่วน API key
- หน้า `/site/profile`, `/site/profile/applications`, `/site/develop`, `/site/develop/api` ขึ้น "Something went wrong" ทุกหน้า
- เรียก API โดยไม่มี key ตอบ 403
- สรุป: ยังไม่มี key, พักไว้

### OpenStreetMap (Overpass API) — ผ่าน

Query:

```
[out:json][timeout:170];area["ISO3166-1"="TH"][admin_level=2]->.th;nwr["amenity"="charging_station"](area.th);out tags center;
```

ข้อควรรู้:

- ต้องส่ง header User-Agent ไม่งั้นได้ 406
- server `overpass-api.de` มักเต็ม (502 "at capacity") ต้อง retry
- mirror `private.coffee` ก็เต็ม, `maps.mail.ru` timeout
- OSM timestamp: 2026-10-25T23:57:06Z
- raw data: `spike/osm_th_2026-10-26.json`

ผลลัพธ์ (จาก 307 จุด):

| รายการ | จำนวน | สัดส่วน |
|---|---|---|
| ทั้งหมด | 307 (node 274, way 33) | 100% |
| operator/brand | 195 | 64% |
| name | 41 | 13% |
| capacity (จำนวนหัว) | 129 | 42% |
| `socket:*` ชนิดหัว | 53 | 17% |
| `socket:*:output` kW | 32 | 10% |

ชนิดหัวที่พบ: type2_combo 40, type2 28, type2_cable 19, chademo 9, ccs 6, type1 2, schuko 2

ยี่ห้อที่พบบ่อย: (ไม่ระบุ) 112, PTT 33 (+ "ptt" 3), Tesla Supercharger 10, EA 7, EA Anywhere 5, BYD 7, Chiang Mai Provincial Power Authority 7, Elex 6, Elexa 5, PEA Volta 6, PEA 4, ReverSharger 6, Revert 3, Evolt 5, EV Station 5, EV Station Pluz 4, PO Oil 5, Spark 4, MG 3

สรุป: 307 จุดน้อยกว่าจริงมาก และมี kW แค่ 10% → ข้อมูลจากทีม (เพิ่มจุด/แก้หัวชาร์จ) สำคัญ · ต้อง normalize ชื่อ Operator

### Google Places API (New) — ทำไม่ได้

- key แรกจำกัด HTTP referrer → 403 `API_KEY_HTTP_REFERRER_BLOCKED`
- key ใหม่ "map" (จำกัด Places API (New), billing account Active, API enabled ในโปรเจกต์ nextnineteen mail) → 403 "The caller does not have permission" ทุกครั้ง, retry 6 ครั้งใน 6 นาที
- สาเหตุยังไม่รู้
- พี่หนุ่มตัดสินใจข้าม Google ไปก่อน (Phase 2)

## My Maps KML (2026-10-26 09:50) — ผ่าน

แหล่งข้อมูลที่เลือกแทน OSM (ADR 0002)

- แผนที่: "DC EV Charging Station Thailand - Piyamate Wisanuvej" (รวบรวมโดย ปิยเมษฐ์ วิษณุเวช) แสดงเฉพาะสถานีชาร์จเร็ว DC · map id `1YKD1Z5CdoyMnSTCOf2TgLmKV-REwfmIC`
- KML export (สาธารณะ ไม่ต้องใช้ key): `https://www.google.com/maps/d/kml?mid=1YKD1Z5CdoyMnSTCOf2TgLmKV-REwfmIC&forcekml=1` (~3.8 MB) · ไฟล์ดิบ: `spike/mymaps/mymaps.kml`
- 3,007 Placemark ทั้งหมดเป็น Point · `name` = ชื่อไทย
- Layer (Folder): PTT 1216, EA 361, PEA 428, Sharge (ReverSharger) 351, EleX 260, MG 150, Altervim 118, etc 123

ExtendedData (จาก 3,007 จุด): Description 3007, Latitude 3007, Longitude 3007, Provider 3007, Address 2579, Power 1791, Name-EN 1457, Hours 361, Operator 351, Dealership 150

Provider: PTT 1216, PEA 428, EA 361, Sharge 351, EleX 260, MG 150, Altervim 118, Tesla 30, Galvanic 28, EVolt 21, GWM 21, MEA 12, OneCharge 6, (ว่าง) 3, Haup 2

Description (ชนิดหัว) รูปแบบที่พบ: `CCS2` 795, `CCS2, Type 2` 423, ว่าง 176, `2x CCS2 150 kW` 141, `2x CCS2: 120 kW, 2x Type2: 22 kW` 101, `2x CCS2: 180 kW` 93, `2x CCS2 125 kW (300A)` 56, `2x CCS2: 150 kW (1000V 200A), Type2: 3 kW` 56, `CCS2: 50 kW, CHAdeMO: 10 kW` 31 · 1,628 จุดมี kW อยู่ในข้อความ

Power: 120 kW 337, 50 kW 291, 150 kW 245, ว่าง 163, 25 kW 141, 180 kW 104 · Hours: 24 Hr 226, Closed 63, Peak 61, Off-peak 11

เทียบกับ OSM:

| รายการ | My Maps | OSM |
|---|---|---|
| จำนวนจุด | 3,007 | 307 |
| มี kW | ~54% | 10% |
| ประเภท | DC อย่างเดียว | DC + AC |

ข้อสังเกต:

- ไม่ระบุ licence · ผู้เขียนมีอีเมลติดต่อในคำอธิบายแผนที่ (ไม่คัดลอกลงเอกสาร) → ใช้ในทีม + ใส่เครดิต · ขออนุญาตก่อนเปิดสาธารณะ
- ไม่มี id คงที่ใน KML · Description เป็นข้อความอิสระ ต้อง parse (ดู PRD)
- Trade-off: มีเฉพาะ DC — จุด AC มาจากทีมเพิ่มเองเท่านั้น
- ผลของ OSM spike ด้านบนเก็บไว้เป็นประวัติ (OSM ไม่ใช้เป็นแหล่งข้อมูลแล้ว)

## Test plan MVP

ดู `docs/prd/ev-charger-map.md` หัวข้อ Testing — ยังไม่ได้รัน

## UAT (2026-10-26 11:05) — https://ev-uat.thana.in.th

Deploy: worker `ev-charger-uat` · D1 `ev-charger-uat` (APAC) · account Thana.j · cron `0 19 * * *` · TEAM_PIN ตั้งโดยพี่หนุ่ม

| ทดสอบ | ผล |
|---|---|
| sync จริงบน Cloudflare (`POST /api/admin/sync`, พี่หนุ่มรัน) | ✅ D1 มี 3,007 จุด `mymaps` · ไม่ติด CPU limit |
| bbox กรุงเทพ `100.45,13.70,100.55,13.78` | ✅ 61 จุด (dc 57 / ac 3 / unknown 1) ตรงกับ local |
| bbox ทั้งประเทศ | ✅ 500 + `truncated: true` |
| static assets / logos / manifest / sw.js | ✅ 200 ทุกไฟล์ |
| PIN ผิด `POST /api/stations` · ไม่มี PIN `DELETE` | ✅ 401 ทั้งคู่ |
| มือถือ 390×844 + GPS mock: หมุดโลโก้ + cluster | ✅ ไม่มี console error · โลโก้โหลดครบ ไม่มีรูปเสีย |
| กดหมุด → แผงข้อมูล (โลโก้, ชื่อ TH/EN, หัวชาร์จ, เครดิต) | ✅ |
| ลิงก์นำทาง | ✅ `https://www.google.com/maps/dir/?api=1&destination=13.7459%2C100.47071&travelmode=driving` |
| โลโก้โหลดไม่ได้ (จำลองเปลี่ยน src) | ✅ เปลี่ยนเป็นตัวย่อบนสีแบรนด์ |
| ตัวกรองยี่ห้อ PEA Volta | ✅ เหลือ 2 จุด เฉพาะ pea · ล้างตัวกรองกลับเป็น 251 |
| เปิด modal แก้ไข / เพิ่มจุด | ✅ เปิดได้ (ไม่ได้บันทึกจริง) |

ยังไม่ได้ทดสอบ: บันทึกเพิ่ม/แก้/ลบจุดจริงบน UAT (ต้องใช้ PIN ของพี่หนุ่ม) · ปุ่มแชร์บนมือถือจริง · ปฏิเสธ GPS · กดค้างบนแผนที่บนมือถือจริง · ติดตั้ง PWA · cron ตี 2 (รอดูคืนนี้)

## [2026-10-26 11:20] PRD deploy

Log การ deploy UAT -> PRD (account Thana.j · zone thana.in.th)

| เวลา | เหตุการณ์ | ผล |
|---|---|---|
| 2026-10-26 10:50 | สร้าง D1 `ev-charger-uat` + schema | ✅ |
| 2026-10-26 10:52 | deploy UAT `ev-charger-uat` -> ev-uat.thana.in.th | ✅ |
| 2026-10-26 10:58 | พี่หนุ่มตั้ง TEAM_PIN (UAT) + sync -> 3,007 จุด | ✅ |
| 2026-10-26 11:05 | สร้าง D1 `ev-charger-prd` + schema | ✅ |
| 2026-10-26 11:06 | deploy PRD ครั้งแรก -> ผูกโดเมนไม่ได้ (error 100117: DNS record `ev` เดิมค้าง ชี้ origin ตาย 530) | ❌ |
| 2026-10-26 11:16 | พี่หนุ่มลบ DNS record เดิม -> deploy ซ้ำ -> ev.thana.in.th ตอบ 200 | ✅ |

PRD checks:

- หน้าเว็บ / `app.js` / logo ตอบ 200 ✅
- API ทำงาน (ยังว่าง 0 จุด — รอตั้ง TEAM_PIN + sync) ✅
- PIN ผิด -> 401 ✅

หมายเหตุ:

- DNS ในเครื่องมิกะ cache ค่าเก่า ต้องเช็คผ่าน 1.1.1.1
- `npm test` 85/85 ผ่าน ก่อน deploy PRD

Pending:

- พี่หนุ่มตั้ง TEAM_PIN production + sync ครั้งแรก
- ทดสอบเพิ่ม/แก้/ลบจริงบนมือถือ
- cron ตี 2 คืนแรก

## [2026-10-26 11:28] PRD first sync

| ทดสอบ | ผล |
|---|---|
| พี่หนุ่มตั้ง TEAM_PIN production + `POST /api/admin/sync` | ✅ |
| D1 `ev-charger-prd` | ✅ 3,007 จุด `mymaps` (updated 2026-10-26T04:25Z) |
| bbox กรุงเทพ บน ev.thana.in.th | ✅ 61 จุด (dc 57 / ac 3 / unknown 1) ตรงกับ UAT |

หมายเหตุ: เบราว์เซอร์ในเครื่องมิกะยังเปิด ev.thana.in.th ไม่ได้ (ERR_NAME_NOT_RESOLVED — DNS cache ค่าเก่าจากตอนผูกโดเมนไม่สำเร็จ) · เช็คผ่าน 1.1.1.1 แล้วปกติ → ยังไม่ได้ทดสอบ UI บน PRD ด้วยตา

## [2026-10-26 13:25] Hub filter — UAT

| รายการ | ผล |
|---|---|
| vitest (workers + node) | ✅ 96/96 (เพิ่ม 11) |
| deploy UAT (version e1418561) | ✅ |
| `GET /api/stations?hub=1` ไม่มี bbox | ✅ 12 จุด ทุกจุด `hub:true` |
| bbox กรุงเทพ มี field `hub` | ✅ 288 จุด, hub 0 |
| ไม่มี bbox และไม่มี hub | ✅ 400 |
| sw.js cache `ev-shell-v2` | ✅ |
| UI 390×844: chip "Hub" ในหมวด "ประเภทสถานี" · badge ตัวกรอง = 1 | ✅ |
| ซูมออกทั้งประเทศยังเห็น Hub (cluster 4/3/4 + 1) · สถานะ "พบ Hub 12 จุด" | ✅ |
| bottom sheet มีป้าย "Hub" | ✅ |
| ล้างตัวกรอง → กลับโหมดปกติ ("ซูมเข้าเพื่อดูจุดชาร์จ") | ✅ |

หมายเหตุ: นิยาม Hub = ชื่อ/ชื่ออังกฤษตรง `/\bhub\b|\(ฮับ\)|ฮับสถานี/i` · ตอนกดเปิดแถบสถานะขึ้น "พบ Hub 0 จุด" ชั่วครู่ก่อนโหลดเสร็จ (เรื่องเล็ก)

## [2026-10-26 14:30] Hub filter — PRD deploy

| รายการ | ผล |
|---|---|
| deploy production (version 0c859fed) | ✅ |
| `GET /api/stations?hub=1` บน PRD | ✅ 12 จุด ทุกจุด `hub:true` |
| sw.js cache `ev-shell-v2` | ✅ |

หมายเหตุ: ยังไม่ได้ตรวจ UI บน PRD ด้วยตา (เบราว์เซอร์ในเครื่องมิกะยังเปิด ev.thana.in.th ไม่ได้เพราะ DNS cache) · โค้ดชุดเดียวกับ UAT ที่ตรวจ UI แล้วเมื่อ 13:25

## [2026-10-26 17:58] Bookmark + ค้นหา — local + UAT

| รายการ | ผล |
|---|---|
| vitest (workers + node) | ✅ 116/116 (bookmark +6, search +14) |
| local: PUT bookmark (PIN ทดสอบ local) → ดาวบนหมุด, ★ panel, ตัวกรองเฉพาะที่บันทึกไว้ (ซูมออกยังเห็น), เอาออก → ดาวหาย | ✅ |
| local: ค้น "หัวหิน" ได้รายการ + ระยะทาง · Enter → สถานที่ 3 รายการ + เครดิต OSM · แตะสถานที่ flyTo · "ฮับ สระบุรี" (AND) → เปิด sheet | ✅ |
| ปุ่ม "★ บันทึกแล้ว" ไม่ตัดบรรทัด · ไม่ล้นแนวนอนที่ 390px | ✅ |
| UAT migrate `schema.sql` (bookmarks) --remote | ✅ |
| deploy UAT (version c98eecb3) · sw `ev-shell-v4` | ✅ |
| UAT `GET /api/bookmarks` ไม่มี PIN → 200 ว่าง | ✅ |
| UAT `PUT /api/bookmarks/:id` PIN ผิด → 401 | ✅ |
| UAT `?q=ฮับ&lat&lng` → 12 จุด มี `distance_km`, `bookmarked` | ✅ |
| UAT `/api/geocode?q=เชียงใหม่` → ผลจาก Nominatim | ✅ |
| UAT UI 390×844: ค้น "เพลินจิต" → แตะ → sheet · ★ panel empty state | ✅ |
| UAT บันทึก bookmark จริงด้วย PIN จริง | ⏳ รอพี่หนุ่มทดสอบ (มิกะไม่มี PIN จริง) |

หมายเหตุ: ค้น "ฮับ" ผลแรกคือ "แฮปปี้ฮับ สปอร์ต…" (ค้นตามตัวอักษร ไม่ใช่นิยาม Hub — ถูกต้องตามสเปก)

## [2026-10-26 18:00] Bookmark + ค้นหา — PRD deploy

| รายการ | ผล |
|---|---|
| PRD D1 migrate `schema.sql` (bookmarks) --remote | ✅ |
| deploy production (version 3ab09a72) | ✅ |
| `GET /api/bookmarks` บน PRD (ไม่มี PIN) → 200 ว่าง | ✅ |
| `PUT /api/bookmarks/:id` PIN ผิด → 401 | ✅ |
| `GET /api/stations?q=หัวหิน` | ✅ 15 รายการ |
| `GET /api/geocode?q=หัวหิน` | ✅ 3 รายการ |
| sw.js cache `ev-shell-v4` | ✅ |
| UI บน PRD | ⚠️ ยังไม่ได้ตรวจด้วยตา (โค้ดชุดเดียวกับ UAT · DNS ในเครื่อง cache) |
| บันทึก bookmark จริงด้วย PIN จริง | ⏳ รอพี่หนุ่มทดสอบบนมือถือ |

## [2026-10-27 07:00] ซูมไปที่ Hub/bookmark ตอนเปิดตัวกรอง — local + UAT + PRD

| รายการ | ผล |
|---|---|
| vitest | ✅ 116/116 |
| local 390×844: อยู่กรุงเทพ → เปิด Hub → flyToBounds เห็น Hub ทั้งประเทศ "พบ Hub 12 จุด" | ✅ |
| deploy UAT (version 320bdde6) · sw `ev-shell-v5` | ✅ |
| UAT 390×844: เปิด Hub → หมุด/cluster ทั้ง 7 อยู่ในจอ | ✅ |
| deploy PRD (version 74226f46) · sw `ev-shell-v5` · app.js มี flyToBounds | ✅ |

หมายเหตุ: ใช้กับ chip "★ เฉพาะที่บันทึกไว้" ด้วย · ปิดตัวกรอง / เปิดแอปที่มีตัวกรองค้างไว้ = ไม่ซูม · maxZoom 14

## [2026-10-27 07:05] Nightly cron คืนแรก

| Env | จำนวนจุด | `MAX(updated_at)` | ผล |
|---|---|---|---|
| UAT | 3,007 | 2026-10-26T19:00:30Z (02:00 ไทย) | ✅ |
| PRD | 3,007 | 2026-10-26T19:00:19Z (02:00 ไทย) | ✅ |
