// Service worker — cache เฉพาะ app shell (HTML/JS/CSS/icons/โลโก้/Leaflet) · ไม่ cache /api และแผนที่ tiles
const VERSION = "ev-shell-v5";

const LOCAL_SHELL = [
  "/", "/index.html", "/app.js", "/styles.css", "/manifest.json",
  "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png",
  "/logos/logos.json",
];
const CDN_SHELL = [
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.Default.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await cache.addAll(LOCAL_SHELL);
      // CDN พลาดได้ (ออฟไลน์ตอนติดตั้ง) — ไม่ให้ install ล้ม
      await Promise.all(CDN_SHELL.map((u) => cache.add(u).catch(() => {})));
      // โลโก้: อ่านรายการจาก manifest
      try {
        const res = await cache.match("/logos/logos.json");
        const list = await res.json();
        await Promise.all(list.filter((l) => l.file).map((l) => cache.add("/logos/" + l.file).catch(() => {})));
      } catch (_) { /* ignore */ }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    if (url.pathname.startsWith("/api/")) return; // ข้อมูลสดเสมอ
    // shell ของเราเอง: stale-while-revalidate (หน้า navigation ใช้ "/" โดยไม่สน ?s=)
    event.respondWith(
      (async () => {
        const cache = await caches.open(VERSION);
        const cached = await cache.match(req, { ignoreSearch: true });
        const network = fetch(req)
          .then((res) => {
            if (res.ok && !url.search) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);
        if (cached) { event.waitUntil(network); return cached; }
        const res = await network;
        if (res) return res;
        if (req.mode === "navigate") return (await cache.match("/index.html")) || Response.error();
        return Response.error();
      })(),
    );
    return;
  }

  // CDN ที่ pin version แล้ว: cache-first
  if (CDN_SHELL.includes(req.url)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req)),
    );
  }
  // อื่น ๆ (tiles OSM ฯลฯ) ปล่อยผ่านเครือข่าย
});
