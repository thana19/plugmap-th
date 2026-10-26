# ADR 0004 — ค้นหาสถานที่ด้วย Nominatim ผ่าน Worker proxy

- Status: Accepted (2026-10-26 14:50)
- เกี่ยวข้อง: ADR 0002 (OSM เป็นแผนที่พื้นหลังเท่านั้น) · `docs/prd/ev-charger-map.md` หัวข้อ "Frontend → ค้นหาที่หน้าหลัก" และ API `?q=`, `/api/geocode`

## Context

พี่หนุ่มตัดสินใจ (2026-10-26) เพิ่ม **ช่องค้นหาที่หน้าหลัก** ให้ค้นได้ทั้งจุดชาร์จและสถานที่ (เช่น "หัวหิน") เพื่อบินไปดูจุดชาร์จแถวนั้น
จุดชาร์จค้นจาก D1 ของเราเองได้เลย แต่ **การค้นสถานที่ต้องใช้ geocoder ภายนอก** — ตัวเลือกหลักคือ Google Places และ OSM Nominatim

## Decision

1. ค้นสถานที่ด้วย **OpenStreetMap Nominatim** (`/search`: `countrycodes=th`, `accept-language=th`, `limit=5`, `format=jsonv2`)
2. เรียกผ่าน **Worker proxy `GET /api/geocode?q=`** เท่านั้น ไม่ให้เบราว์เซอร์เรียก Nominatim ตรง
   - ใส่ `User-Agent: plugmap-th/1.0 (+https://ev.thana.in.th)` (policy บังคับ ระบุแอปและช่องทางติดต่อ)
   - `q` ยาว 2–100 ตัวอักษร นอกช่วง = 400 · upstream ผิดพลาด = 502
   - cache ผลด้วย Cache API 24 ชม. ต่อ `q` ที่ normalize แล้ว
3. **ไม่ autocomplete สำหรับสถานที่** — เรียกเฉพาะเมื่อกด Enter หรือแตะแถว "ค้นหาสถานที่ ..." (policy: สูงสุด 1 req/วินาที ห้ามยิงขณะพิมพ์)
4. ส่วนจุดชาร์จ (`GET /api/stations?q=`) ค้นจาก D1 ได้ขณะพิมพ์ (debounce 300 ms) เพราะเป็นข้อมูลของเราเอง
5. แสดงเครดิต "ค้นหาสถานที่โดย © OpenStreetMap" ใน dropdown

## Consequences

- ฟรี ไม่ต้องมี API key (ไม่มีปัญหา key 403 / referrer restriction) และใช้กับแผนที่ Leaflet + OSM tiles เดิมได้ ไม่ต้องย้ายไปแสดงบน Google Map
- Worker เป็นจุดเดียวที่คุยกับ Nominatim → คุม User-Agent, cache, rate ได้ในที่เดียว
- **ไม่มี autocomplete ของสถานที่** ผู้ใช้ต้องกด Enter/แตะแถว · ประสบการณ์ด้อยกว่า Google Places
- ถูกจำกัด rate ของ Nominatim (1 req/วินาที) · cache 24 ชม. ช่วยลดการยิงซ้ำ แต่ถ้าใช้หนักมากอาจถูกบล็อก IP ของ Worker → พิจารณา self-host Nominatim หรือผู้ให้บริการ geocoder เชิงพาณิชย์
- คุณภาพข้อมูลชื่อสถานที่ไทยใน OSM ไม่เท่า Google (ร้านค้า/POI อาจไม่ครบ) แต่พอสำหรับชื่อจังหวัด/อำเภอ/ย่าน
- ต้องแสดงเครดิต OSM เพิ่มใน UI ค้นหา
- ผลลัพธ์ขึ้นกับบริการภายนอก → UI ต้องรับมือ 502 ("ค้นหาสถานที่ไม่สำเร็จ")

## Alternatives

- **Google Places (Autocomplete / Text Search)** — ปฏิเสธ: key มีปัญหา 403 มาก่อน, มีค่าใช้จ่ายตามการเรียก, และเงื่อนไขบังคับให้แสดงผลบน Google Map (ใช้กับ Leaflet ไม่ได้) · ตรงกับข้อสรุปเดิมที่ตัด Google Places ออกจาก scope
- **เรียก Nominatim จากเบราว์เซอร์ตรง** — ปฏิเสธ: คุม User-Agent/cache/rate ไม่ได้ และ IP ผู้ใช้หลายคนยิงกระจัดกระจาย
- **ทำ autocomplete บน Nominatim** — ปฏิเสธ: ผิด usage policy
- **ค้นเฉพาะจุดชาร์จ ไม่ค้นสถานที่** — ปฏิเสธ: พี่หนุ่มต้องการค้นสถานที่ด้วย

## Revisit when

- Nominatim บล็อก/จำกัดการใช้งาน หรือใช้งานถี่เกิน 1 req/วินาที โดยรวม
- ต้องการ autocomplete สถานที่ (ต้อง self-host หรือเปลี่ยนผู้ให้บริการ)
- เปิดแอปสาธารณะ (ตรวจ policy/ปริมาณการเรียกอีกครั้ง)
