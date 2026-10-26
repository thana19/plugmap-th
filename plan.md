# plan.md — EV-Charger Map

อัปเดตล่าสุด: 2026-10-27 07:00

## ทำแล้ว

| เวลา | ขั้นตอน |
|---|---|
| 2026-10-26 07:30 | Phase 0 spike: OCM (ไม่มี key) · OSM 307 จุด · Google Places (403) -> `TESTING.md` |
| 2026-10-26 09:55 | เปลี่ยนแหล่งข้อมูลเป็น Google My Maps KML 3,007 จุด DC (ADR 0002) |
| 2026-10-26 10:20 | โลโก้ยี่ห้อ 14 ยี่ห้อ `public/logos/` (ADR 0003) |
| 2026-10-26 10:30 | MVP implement: Worker + D1 + Leaflet PWA, ทดสอบ 85/85 |
| 2026-10-26 10:58 | UAT https://ev-uat.thana.in.th พร้อม sync 3,007 จุด |
| 2026-10-26 11:16 | PRD https://ev.thana.in.th ขึ้น (หลังพี่หนุ่มลบ DNS record `ev` เดิม) |
| 2026-10-26 11:2x | git push -> github.com/thana19/plugmap-th (public) |
| 2026-10-26 13:25 | Hub filter (ตัวกรอง "ประเภทสถานี" + `?hub=1`) ทดสอบ 96/96 · UAT ผ่าน |
| 2026-10-26 14:30 | Hub filter deploy PRD (version 0c859fed) · `?hub=1` = 12 จุด |
| 2026-10-26 14:45 | Bookmark (ทีมใช้ร่วมกัน) — วางแผน (html-plan) |
| 2026-10-26 17:54 | Bookmark — UAT (version c98eecb3) · ทดสอบ 116/116 |
| 2026-10-26 18:00 | Bookmark — PRD (version 3ab09a72) |
| 2026-10-26 14:50 | ค้นหาบนหน้าหลัก (สถานี + สถานที่ Nominatim, ADR 0004) — วางแผน (html-plan) |
| 2026-10-26 17:54 | ค้นหา — UAT (version c98eecb3) |
| 2026-10-26 18:00 | ค้นหา — PRD (version 3ab09a72) |
| 2026-10-27 07:00 | ซูมไปที่ Hub/bookmark ตอนเปิดตัวกรอง (flyToBounds) — UAT 320bdde6 · PRD 74226f46 |

## ขั้นต่อไป

1. พี่หนุ่มตั้ง TEAM_PIN production + sync ครั้งแรก (ตอนนี้ PRD ยังว่าง 0 จุด)
2. ทดสอบบนมือถือจริง: บันทึก Bookmark ด้วย PIN จริง · เพิ่ม/แก้/ลบจุด · แชร์ · ปฏิเสธ GPS · กดค้างบนแผนที่ · ติดตั้ง PWA
3. ตรวจ cron ตี 2 คืนแรก (UAT + PRD)

## Phase 2

- สถานะ ว่าง/ไม่ว่าง (Report + TTL)
- จุด AC จาก OSM / OCM (ถ้าได้ API key)
- Google Places (evChargeOptions) — ต้องแสดงบน Google Map
- หน้า admin แสดง override ที่กำพร้า (orphan)

## ก่อนเปิดสาธารณะ

ขออนุญาตผู้รวบรวม My Maps และตรวจการใช้โลโก้ (เครื่องหมายการค้า) ถ้าจะเปิดให้คนทั่วไปใช้จริงจัง (ADR 0002 / 0003)
