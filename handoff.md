# handoff.md — EV-Charger Map

อัปเดตล่าสุด: 2026-10-26 11:20

## สถานะปัจจุบัน

MVP ขึ้นครบทั้ง UAT และ PRD · UAT มีข้อมูล 3,007 จุดแล้ว · **PRD ยังว่าง 0 จุด** รอพี่หนุ่มตั้ง TEAM_PIN production + sync ครั้งแรก

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

แผนที่ Leaflet + GPS · โหลดตาม bbox · หมุดโลโก้ยี่ห้อ + สีขอบตามความเร็ว + cluster · แผงข้อมูล/นำทาง/แชร์ · ตัวกรอง · เพิ่ม/แก้/ลบ (soft delete) ด้วย Team PIN · PWA · nightly sync

## Decisions

- ADR 0001 `docs/adr/0001-data-sources.md` — แหล่งข้อมูล (OSM ส่วนใหญ่ถูกแทนด้วย 0002)
- ADR 0002 `docs/adr/0002-mymaps-replaces-osm.md` — ใช้ Google My Maps KML เป็นแหล่งข้อมูลหลัก (ไม่มี licence)
- ADR 0003 `docs/adr/0003-brand-logo-markers.md` — หมุดโลโก้ยี่ห้อ
- สเปก: `docs/prd/ev-charger-map.md` · คำศัพท์: `CONTEXT.md`
- ตัดสถานะ ว่าง/ไม่ว่าง ออกจาก MVP -> Phase 2

## Deploy log (สรุป)

- 2026-10-26 10:52 UAT · 10:58 sync 3,007 จุด
- 2026-10-26 11:06 PRD ครั้งแรกล้มเหลว (error 100117 DNS record `ev` เดิมค้าง) · 11:16 ลบ record แล้ว deploy ซ้ำสำเร็จ
- รายละเอียดเต็ม: `TESTING.md` หัวข้อ `[2026-10-26 11:20] PRD deploy`

## Known gaps (จาก TESTING.md)

- PRD ยังไม่มี TEAM_PIN / ข้อมูล
- ยังไม่ได้ทดสอบ: บันทึกเพิ่ม/แก้/ลบจริง · ปุ่มแชร์บนมือถือจริง · ปฏิเสธ GPS · กดค้างบนแผนที่บนมือถือจริง · ติดตั้ง PWA · cron ตี 2
- KML ไม่มี id คงที่ -> ผู้เขียนขยับ/เปลี่ยนชื่อหมุดแล้ว override กำพร้า (ยังไม่มีหน้า admin)
- มีเฉพาะจุด DC · kW มีราว 54%

## Artifacts อ้างอิง

- แผนหลัก: `~/.claude/plans/explore-quirky-finch.md`
- HTML plan: `html-plan/ev-charger-plan-2026-10-26_*.html`
- ข้อมูลดิบ spike (ไม่ commit): `spike/`
- โลโก้ + ที่มา: `public/logos/logos.json`

## Next steps

ดู `plan.md` — ตั้ง PIN PRD + sync · ทดสอบมือถือจริง · ตรวจ cron · Phase 2

## Suggested Skills (session ถัดไป)

`project-hygiene` · `superpowers:systematic-debugging` · `cloudflare:wrangler` · `chrome-devtools-mcp:chrome-devtools`

## หมายเหตุ

repo GitHub เป็น public — แต่ตัวแอปตั้งใจใช้ในทีม: ข้อมูล My Maps ไม่มี licence และโลโก้เป็นเครื่องหมายการค้า -> ถ้าจะโปรโมตให้คนทั่วไปใช้ ต้องขออนุญาตก่อน (ADR 0002/0003)
