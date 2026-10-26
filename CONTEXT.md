# CONTEXT.md — EV-Charger

อัปเดตล่าสุด: 2026-10-26 14:50

เว็บแอป PWA แผนที่จุดชาร์จ EV ในประเทศไทย สำหรับพี่หนุ่มและทีม/ร้าน EV ใช้ภายใน

- Stack: static PWA (vanilla JS + Leaflet + OSM tiles) + Cloudflare Worker + D1 · แหล่งข้อมูลดู `docs/adr/0002-mymaps-replaces-osm.md` (และ `0001`) · หมุดโลโก้ยี่ห้อ `docs/adr/0003-brand-logo-markers.md` · ค้นหาสถานที่ `docs/adr/0004-place-search-nominatim.md`
- สถานะ repo: git (public) github.com/thana19/plugmap-th

## เป้าหมาย

1. หาจุดชาร์จใกล้ตัวอัตโนมัติ (GPS + โหลดจุดในกรอบแผนที่)
2. แต่ละจุดบอก ยี่ห้อ (Operator), จำนวนหัว, กำลังไฟ kW, ชนิดหัว (สถานะ ว่าง/ไม่ว่าง = Phase 2 ตัดออกจาก MVP 2026-10-26)
3. ส่งไป Google Maps เพื่อนำทาง / แชร์ลิงก์
4. ทีมเพิ่มพิกัดจุดชาร์จเองได้ แชร์ให้ทุกคนเห็น

## Glossary

| คำ | ความหมาย |
|---|---|
| **Station (จุดชาร์จ)** | สถานที่หนึ่งแห่งบนแผนที่ มีพิกัด lat/lng, ชื่อ, Operator, และ Connector หลายชุด |
| **Connector (หัวชาร์จ)** | กลุ่มหัวชาร์จชนิดเดียวกันใน Station: ชนิด (Type 2, CCS2, CHAdeMO, GB/T), kW, จำนวน (quantity) · เก็บใน `connectors_json` |
| **Operator (ยี่ห้อ/ผู้ให้บริการ)** | เช่น PEA Volta, EleXA, EA Anywhere, PTT EV Station PluZ, MEA EV, Shell Recharge |
| **Source** | ที่มาของ Station: `mymaps` = sync จาก Google My Maps · `user` = ทีมเพิ่มเอง · อนาคต `ocm` (ADR 0002) |
| **My Maps (แหล่งข้อมูลหลัก)** | Google My Maps สาธารณะ "DC EV Charging Station Thailand" โดย ปิยเมษฐ์ วิษณุเวช (เฉพาะสถานีชาร์จเร็ว DC) ดึงเป็น KML (`mid=1YKD1Z5CdoyMnSTCOf2TgLmKV-REwfmIC`) 3,007 จุด · ไม่มี licence → ใช้ในทีม + ใส่เครดิตใน UI · ขออนุญาตผู้เขียนก่อนเปิดสาธารณะ (ADR 0002) |
| **OSM (OpenStreetMap)** | แผนที่พื้นหลังเท่านั้น (tiles) — ไม่ใช้เป็นแหล่งข้อมูลแล้ว (ADR 0002) · ต้องแสดง "© OpenStreetMap contributors" บนแผนที่ |
| **Override** | ข้อมูลที่ทีมแก้ทับ Station จาก My Maps (ชื่อ/Operator/Connector) เก็บแยกใน `station_overrides` ไม่ถูก sync เขียนทับ |
| **OCM (Open Charge Map)** | ฐานข้อมูลจุดชาร์จเปิด licence CC BY 4.0 cache ได้ · ไม่มีสถานะ real-time · Phase 2 (ยังขอ key ไม่ได้) |
| ~~**Report (รายงานสถานะ)**~~ | Phase 2 (ตัดออกจาก MVP 2026-10-26) — เดิม: คนในทีมกดบอกสถานะ ว่าง/ไม่ว่าง/เสีย |
| ~~**Status (สถานะที่แสดง)**~~ | Phase 2 (ตัดออกจาก MVP 2026-10-26) — เดิม: คำนวณจาก Report ล่าสุด |
| ~~**สถานะหมดอายุ (Report TTL)**~~ | Phase 2 (ตัดออกจาก MVP 2026-10-26) — เดิม: available/busy 45 นาที · broken 24 ชม. |
| **Speed class** | ความเร็วชาร์จของ Station ใช้กำหนด **สีขอบหมุด** (ขอบหนา 3px รอบโลโก้): **DC เร็ว** (max kW ≥ 50 หรือมีหัว CCS2/CHAdeMO/GB/T DC) = ส้ม · **AC** (มีแค่ Type 2/Type 1 หรือ kW < 50) = น้ำเงิน · **ไม่ทราบ** = เทา |
| **Hub** | Station ที่ชื่อ (หลัง override) หรือ `name_en` ตรง `/\bhub\b|\(ฮับ\)|ฮับสถานี/i` (`isHub` ใน `worker/src/normalize.ts`) = สถานีชาร์จขนาดใหญ่ · ตอนนี้ ~12 จุดทั่วประเทศ · API ส่ง `hub: boolean` ทุกจุด · ใช้ในตัวกรอง "ประเภทสถานี" |
| **Bookmark (จุดที่บันทึกไว้)** | Station ที่ทีมกดบันทึกไว้ — แชร์ทั้งทีม เก็บใน D1 ตาราง `bookmarks` (`station_id`, `created_by`, `created_at`) · เพิ่ม/ลบต้องใส่ Team PIN, ดูรายการไม่ต้องใช้ PIN · ถ้า Station ถูกลบ (`deleted=1`) จะซ่อนจากรายการ · API ส่ง `bookmarked: boolean` ทุกจุด |
| **Search (ค้นหา)** | ช่องค้นหาบนแถบด้านบนของหน้าหลัก ค้นได้ 2 อย่าง: **จุดชาร์จ** (`GET /api/stations?q=` ค้นใน D1: แยก token ทุกคำต้องตรง `name`/`name_en`/`address`/`operator`/ชื่อ override, `deleted=0`, สูงสุด 20, เรียงตามระยะ) พิมพ์ ≥ 2 ตัว debounce 300 ms · และ **สถานที่** (`GET /api/geocode?q=` → Nominatim) เรียกเมื่อกด Enter หรือแตะแถว "ค้นหาสถานที่" เท่านั้น · แตะผลจุดชาร์จ = `flyTo` + เปิด sheet · แตะสถานที่ = `flyTo` ซูม 14 (ADR 0004) |
| **Nominatim** | บริการ geocoder (ค้นชื่อสถานที่ → พิกัด) ของ OpenStreetMap `nominatim.openstreetmap.org` ฟรี ไม่ต้องมี key · **usage policy:** สูงสุด 1 request/วินาที, **ห้าม autocomplete/ยิงขณะพิมพ์**, ต้องส่ง User-Agent ที่ระบุแอปได้ (`plugmap-th/1.0 (+https://ev.thana.in.th)`), ต้อง cache ผลลัพธ์, ต้องแสดงเครดิต "© OpenStreetMap" · เรียกผ่าน Worker `/api/geocode` เท่านั้น (`countrycodes=th`, `accept-language=th`, `limit=5`, cache 24 ชม.) · ใช้ค้นสถานที่เท่านั้น ไม่ใช่แหล่งข้อมูลจุดชาร์จ (ADR 0002 ยังใช้ได้) |
| **Marker (หมุด)** | หมุดบนแผนที่ = วงกลม ~36px พื้นขาว มีโลโก้ยี่ห้ออยู่กลาง ขอบ 3px สีตาม Speed class และมีหางชี้ตำแหน่งจริง (Leaflet `L.divIcon`) · ไม่มีโลโก้/โหลดไม่ได้ = ตัวย่อ 2–4 ตัวบนสีแบรนด์ · ซูมออกรวมเป็น cluster ตัวเลข (ADR 0003) |
| **Brand logo / operator_slug** | `operator_slug` = รหัสสั้นของ Operator (เช่น `ptt`, `pea`) ที่ Worker แนบมากับ API จากตาราง alias ใน `normalize.ts` · frontend ใช้ map ไปที่ `public/logos/logos.json` (`slug, operator, color, abbr, file, source_url, fetched_at`) เพื่อหาไฟล์ `public/logos/<slug>.png` (96×96) · โลโก้ = ไอคอนแอปทางการจาก App Store (ผู้พัฒนาตรงกับแบรนด์) · เป็นเครื่องหมายการค้าของเจ้าของ ใช้ในทีม ต้องตรวจก่อนเปิดสาธารณะ (ADR 0003) |
| **Team PIN (รหัสทีม)** | รหัสร่วมของทีม ต้องใส่ก่อนเพิ่ม/แก้/ลบ Station · ดูแผนที่ไม่ต้องใส่ |
| **Nightly sync** | Cron Trigger ของ Worker ดึง KML ของ My Maps ทุกคืน 02:00 ไทย ลง D1 · จุดที่หายจาก KML = `deleted=1` · ล้มเหลว = เก็บข้อมูลเดิม |
| **bbox** | กรอบสี่เหลี่ยมของแผนที่ที่กำลังดู (minLng,minLat,maxLng,maxLat) ใช้ query จุดเฉพาะที่เห็น |
| **Navigation link** | `https://www.google.com/maps/dir/?api=1&destination=LAT%2CLNG&travelmode=driving` |
| **evChargeOptions** | field ของ Google Places API (New) มี availableCount/outOfServiceCount · ราคาแพง (Enterprise+Atmosphere) · cache ได้แค่ place_id · ต้องแสดงบน Google Map |
| **Phase 0 spike** | การทดสอบก่อนสร้างจริง: นับจุด OCM ไทย + เช็คว่า Google มี availability ของไทยไหม |
| **UAT / PRD** | environment ทดสอบ / production บน Cloudflare |

## ข้อจำกัดที่รู้แล้ว (สำรวจ 2026-10-25)

- ผู้ให้บริการไทยไม่มี API สาธารณะ · OCPI ใช้เฉพาะคู่สัญญา · **ห้าม scrape แอป/เว็บผู้ให้บริการ** (ผิด ToS)
- สถานะ real-time ในไทยแทบไม่มี → MVP ไม่แสดงสถานะ (Phase 2)
- แหล่งข้อมูล My Maps มีเฉพาะจุด **DC** (3,007 จุด) — จุด AC มาจากทีมเพิ่มเองเท่านั้น · kW มีราว 54% · ไม่มี licence → **ใช้ในทีม + ใส่เครดิต** ห้ามเปิดสาธารณะจนกว่าผู้เขียนอนุญาต
- KML ไม่มี id คงที่ → id = hash ของพิกัด+ชื่อ ผู้เขียนขยับ/เปลี่ยนชื่อหมุดแล้ว override เดิมกำพร้า (ADR 0002)
- ข้อมูล OCM ไทยอาจไม่ครบ (ไทยมีหัวชาร์จราว 11,000 หัว ณ ปลาย 2024 ตาม EVAT)
- ถ้าใช้ข้อมูล Google Places ต้องแสดงบน Google Map (ใช้ Leaflet ไม่ได้)
- มีแผนฐานข้อมูลจุดชาร์จแห่งชาติ (MOU) ที่อาจมี real-time ในอนาคต — ติดตามไว้

## Out of scope (ตอนนี้)

แอป native, จ่ายเงิน/จองหัวชาร์จ, scraping, เปิดสาธารณะ (ต้องขออนุญาตผู้เขียน My Maps และตรวจการใช้เครื่องหมายการค้าของโลโก้ก่อน), ข้อมูล OSM (ยกเลิกแล้ว)

## อ้างอิง

- แผน: `~/.claude/plans/explore-quirky-finch.md`
- OCM: https://www.openchargemap.org/about
- Google EVChargeOptions: https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#EVChargeOptions
- Google Maps URLs: https://developers.google.com/maps/documentation/urls/get-started
