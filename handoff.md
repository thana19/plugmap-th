# handoff.md — EV-Charger Map

อัปเดตล่าสุด: 2026-10-26 18:00

## สถานะปัจจุบัน

MVP + Hub filter + Bookmark + ค้นหา ขึ้นครบทั้ง UAT และ PRD · ทั้งสอง env มีข้อมูล 3,007 จุด (PRD sync ครั้งแรก 2026-10-26 11:25) · ตั้ง TEAM_PIN ครบทั้งสอง env แล้ว · git ล่าสุด `0c8be6b` (push แล้ว)

| Env | URL | Worker | D1 |
|---|---|---|---|
| UAT | https://ev-uat.thana.in.th | `ev-charger-uat` | `ev-charger-uat` |
| PRD | https://ev.thana.in.th | `ev-charger` | `ev-charger-prd` |

## ข้อเท็จจริงสำคัญ

- Cloudflare account: Thana.j (`1c6aa5…`) ล็อกด้วย `account_id` ใน `wrangler.jsonc` · zone `thana.in.th`
- Cron: `0 19 * * *` UTC = 02:00 ไทย sync KML ของ My Maps ลง D1
- Sync ด้วยมือ: `POST /api/admin/sync` header `X-Team-Pin`
- TEAM_PIN เป็น Worker secret (`wrangler secret put TEAM_PIN --env <env>`) · local อยู่ใน `.dev.vars` (ไม่ commit)
- Deploy ต้องใส่ `--env uat|production` เสมอ และถามพี่หนุ่มก่อน
- DNS ในเครื่อง cache ค่าเก่าได้ -> เช็คผ่าน 1.1.1.1

## Features (MVP)

แผนที่ Leaflet + GPS · โหลดตาม bbox · หมุดโลโก้ยี่ห้อ + สีขอบตามความเร็ว + cluster · แผงข้อมูล/นำทาง/แชร์ · ตัวกรอง (รวม Hub) · Bookmark ทีมใช้ร่วมกัน · ค้นหา (สถานี + สถานที่) · เพิ่ม/แก้/ลบ (soft delete) ด้วย Team PIN · PWA · nightly sync

## Decisions

- ADR 0001 `docs/adr/0001-data-sources.md` — แหล่งข้อมูล (OSM ส่วนใหญ่ถูกแทนด้วย 0002)
- ADR 0002 `docs/adr/0002-mymaps-replaces-osm.md` — ใช้ Google My Maps KML เป็นแหล่งข้อมูลหลัก (ไม่มี licence)
- ADR 0003 `docs/adr/0003-brand-logo-markers.md` — หมุดโลโก้ยี่ห้อ
- ADR 0004 `docs/adr/0004-place-search-nominatim.md` — ค้นหาสถานที่ผ่าน Nominatim (ไม่ autocomplete, 1 req/s, proxy + cache 24 ชม.)
- สเปก: `docs/prd/ev-charger-map.md` · คำศัพท์: `CONTEXT.md`
- ตัดสถานะ ว่าง/ไม่ว่าง ออกจาก MVP -> Phase 2

## Deploy log (สรุป)

- 2026-10-26 10:52 UAT · 10:58 sync 3,007 จุด
- 2026-10-26 11:06 PRD ครั้งแรกล้มเหลว (error 100117 DNS record `ev` เดิมค้าง) · 11:16 ลบ record แล้ว deploy ซ้ำสำเร็จ
- รายละเอียดเต็ม: `TESTING.md` หัวข้อ `[2026-10-26 11:20] PRD deploy`
- 2026-10-26 13:25 UAT Hub filter (version e1418561) · 14:30 PRD (version 0c859fed) -> `TESTING.md` หัวข้อ `Hub filter`
- 2026-10-26 17:54 UAT Bookmark + ค้นหา (version c98eecb3) · 18:00 PRD (version 3ab09a72) -> `TESTING.md` หัวข้อ `Bookmark + ค้นหา`
- D1 migrate `schema.sql` (ตาราง `bookmarks`) --remote ทำแล้วทั้ง UAT และ PRD

## Hub filter (2026-10-26)

- Hub = ชื่อ/`name_en` ตรง `/\bhub\b|\(ฮับ\)|ฮับสถานี/i` (`isHub` ใน `worker/src/normalize.ts`) · ตอนนี้ 12 จุด
- API: ทุก station มี `hub: boolean` · `GET /api/stations?hub=1` คืน Hub ทั้งประเทศ (bbox ใส่หรือไม่ก็ได้)
- Frontend: ตัวกรองหมวด "ประเภทสถานี" chip Hub · โหมด Hub ไม่สนซูมขั้นต่ำ · bottom sheet มีป้าย "Hub" · sw cache `ev-shell-v2` · ทดสอบ 96/96
- commit: ดู `git log` (feat: hub filter)
- ปัญหาเล็กที่ทราบ: (1) ~~แถบสถานะขึ้น "พบ Hub 0 จุด" ชั่วครู่~~ — แก้แล้วใน 2026-10-26 17:54 (2) เปิด Hub ตอนซูมอยู่ในกรุงเทพจะไม่เห็นอะไรจนกว่าจะซูมออก — ปรับปรุงได้: `fitBounds` ไปที่ Hub ทั้งหมดตอนเปิด

## Bookmark + ค้นหา (2026-10-26)

- Bookmark: ตาราง D1 `bookmarks` · `GET/PUT/DELETE /api/bookmarks` (GET ไม่ต้อง PIN · PUT/DELETE ต้อง Team PIN) · ดาวบนหมุด · แผง ★ บนแถบบน · chip "★ เฉพาะที่บันทึกไว้"
- ค้นหา: `GET /api/stations?q=` (ชื่อ/ที่อยู่/ยี่ห้อ + `distance_km`) · `GET /api/geocode?q=` (proxy Nominatim cache 24 ชม.) · ค้นสถานที่เฉพาะตอนกด Enter
- Nominatim policy: ห้าม autocomplete · ไม่เกิน 1 req/s · แสดงเครดิต OSM -> ดู ADR 0004
- ค้น "ฮับ" จะเจอ "แฮปปี้ฮับ…" ด้วย — ค้นตามตัวอักษร ไม่ใช่นิยาม Hub (ตั้งใจ ตามสเปก)
- ทดสอบ 116/116 · sw cache `ev-shell-v4`
- **ค้างอยู่:** พี่หนุ่มทดสอบบันทึก Bookmark จริงด้วย PIN จริงบนมือถือ (UAT/PRD) · UI บน PRD ยังไม่ได้ตรวจด้วยตา (โค้ดเดียวกับ UAT)

## Known gaps (จาก TESTING.md)

- ยังไม่ได้ทดสอบ: บันทึก Bookmark จริงด้วย PIN · บันทึกเพิ่ม/แก้/ลบจริง · ปุ่มแชร์บนมือถือจริง · ปฏิเสธ GPS · กดค้างบนแผนที่บนมือถือจริง · ติดตั้ง PWA · cron ตี 2
- KML ไม่มี id คงที่ -> ผู้เขียนขยับ/เปลี่ยนชื่อหมุดแล้ว override กำพร้า (ยังไม่มีหน้า admin)
- มีเฉพาะจุด DC · kW มีราว 54%

## Artifacts อ้างอิง

- แผนหลัก: `~/.claude/plans/explore-quirky-finch.md`
- HTML plan: `html-plan/ev-charger-plan-2026-10-26_*.html` · `html-plan/ev-charger-bookmark-2026-10-26_1445.html` · `html-plan/ev-charger-search-2026-10-26_1450.html`
- ข้อมูลดิบ spike (ไม่ commit): `spike/`
- โลโก้ + ที่มา: `public/logos/logos.json`

## Next steps

ดู `plan.md` — (1) พี่หนุ่มทดสอบ Bookmark ด้วย PIN จริงบนมือถือ (2) ตรวจ cron ตี 2 คืนแรก (`SELECT MAX(updated_at)` บน D1 PRD) (3) ทดสอบมือถือจริงที่เหลือ (Known gaps) (4) ตัวเลือก: `fitBounds` ไปที่ Hub ตอนเปิดตัวกรอง (5) Phase 2 · แนะนำเปลี่ยน TEAM_PIN ถ้าภาพหน้าจอที่มี PIN ถูกส่งต่อ

## Suggested Skills (session ถัดไป)

`project-hygiene` · `superpowers:systematic-debugging` · `superpowers:verification-before-completion` · `cloudflare:wrangler` · `chrome-devtools-mcp:chrome-devtools`

## หมายเหตุ

repo GitHub เป็น public — แต่ตัวแอปตั้งใจใช้ในทีม: ข้อมูล My Maps ไม่มี licence และโลโก้เป็นเครื่องหมายการค้า -> ถ้าจะโปรโมตให้คนทั่วไปใช้ ต้องขออนุญาตก่อน (ADR 0002/0003)
