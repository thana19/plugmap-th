/* EV Charger Map — vanilla JS + Leaflet 1.9.4 + Leaflet.markercluster */
(() => {
  "use strict";

  // ---------- constants ----------
  const BANGKOK = [13.7563, 100.5018];
  const MIN_FETCH_ZOOM = 8;
  const CLUSTER_OFF_ZOOM = 16; // ซูมถึงระดับนี้แตกกลุ่มหมด → เห็นโลโก้
  const MAX_CACHED = 3000;
  const LONG_PRESS_MS = 600;
  const CONNECTOR_TYPES = ["CCS2", "CHAdeMO", "GB/T DC", "Type 2", "Type 1", "Tesla Supercharger"];
  const SPEED_LABEL = { dc: "DC เร็ว", ac: "AC", unknown: "ไม่ทราบความเร็ว" };
  const CREDIT_TEXT = "ข้อมูลจุดชาร์จ: DC EV Charging Station Thailand โดย ปิยเมษฐ์ วิษณุเวช (Google My Maps)";

  // ---------- utils ----------
  const $ = (sel) => document.querySelector(sel);
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  function debounce(fn, ms) { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; }

  let toastTimer;
  function toast(msg, ms = 3000) {
    const el = $("#toast");
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }
  const setStatus = (t) => { $("#status").textContent = t; };

  // ---------- logos ----------
  let logoBySlug = new Map();
  async function loadLogos() {
    try {
      const list = await (await fetch("/logos/logos.json")).json();
      logoBySlug = new Map(list.map((l) => [l.slug, l]));
    } catch { /* ใช้ตัวย่อทั้งหมด */ }
  }
  function abbrFromName(name) {
    const words = String(name || "").replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
    let a = words.length > 1 ? words.slice(0, 3).map((w) => [...w][0]).join("") : [...(words[0] || "?")].slice(0, 3).join("");
    return a.toUpperCase().slice(0, 4);
  }
  /** { src|null, abbr, color } */
  function brandOf(st) {
    const l = st.operator_slug ? logoBySlug.get(st.operator_slug) : null;
    if (l) return { src: l.file ? "/logos/" + l.file : null, abbr: l.abbr, color: l.color };
    return { src: null, abbr: abbrFromName(st.operator), color: "#475569" };
  }
  function brandInner(b, imgClass) {
    const fallback = `<span class="abbr" style="background:${esc(b.color)}">${esc(b.abbr)}</span>`;
    return b.src
      ? `<img class="${imgClass}" src="${esc(b.src)}" alt="" draggable="false" data-abbr="${esc(b.abbr)}" data-color="${esc(b.color)}">`
      : fallback;
  }
  // img onerror (ไม่ bubble → ฟังแบบ capture) → แทนด้วยตัวย่อบนสีแบรนด์
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.abbr) return;
    const span = h("span", { class: "abbr", text: img.dataset.abbr });
    span.style.background = img.dataset.color || "#475569";
    img.replaceWith(span);
  }, true);

  // ---------- speed / connectors ----------
  function maxKw(st) { return Math.max(0, ...st.connectors.map((c) => c.kw || 0)); }
  function connLabel(c) {
    return { type: c.type || "ไม่ทราบชนิดหัว", kw: c.kw ? `${c.kw} kW` : "– kW", count: c.count ? `× ${c.count}` : "" };
  }

  // ---------- API ----------
  class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  async function api(path, { method = "GET", body, pin, signal } = {}) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (pin) headers["X-Team-Pin"] = pin;
    let res;
    try {
      res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
    } catch (e) {
      if (e.name === "AbortError") throw e;
      throw new ApiError(0, "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
    }
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) throw new ApiError(res.status, (data && data.error) || `เกิดข้อผิดพลาด (${res.status})`);
    return data;
  }

  // ---------- modal (ไม่ใช้ prompt/alert/confirm) ----------
  function modal({ title, body, actions }) {
    return new Promise((resolve) => {
      const prevFocus = document.activeElement;
      const errBox = h("div", { class: "err", role: "alert" });
      const close = (v) => {
        overlay.remove();
        document.removeEventListener("keydown", onKey, true);
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        resolve(v);
      };
      const btns = actions.map((a) =>
        h("button", {
          type: "button", class: "btn" + (a.primary ? " primary" : "") + (a.danger ? " danger" : ""),
          onclick: () => {
            if (a.validate) { const msg = a.validate(); if (msg) { errBox.textContent = msg === true ? "" : msg; return; } }
            close(a.value);
          },
          text: a.label,
        }),
      );
      const dialog = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
        h("h2", { text: title }), body, errBox, h("div", { class: "actions" }, btns));
      const overlay = h("div", { class: "overlay", onclick: (e) => { if (e.target === overlay) close(null); } }, dialog);
      const onKey = (e) => {
        if (e.key === "Escape") { e.stopPropagation(); close(null); }
        else if (e.key === "Enter" && e.target.tagName === "INPUT") {
          const primary = actions.findIndex((a) => a.primary);
          if (primary >= 0) { e.preventDefault(); btns[primary].click(); }
        }
      };
      document.addEventListener("keydown", onKey, true);
      $("#modal-root").append(overlay);
      const first = dialog.querySelector("input, select");
      (first || btns[btns.length - 1]).focus();
    });
  }

  const confirmModal = (title, text, okLabel, danger) =>
    modal({
      title, body: h("p", { text }),
      actions: [{ label: "ยกเลิก", value: false }, { label: okLabel, primary: !danger, danger, value: true }],
    });

  async function askPin(message) {
    const input = h("input", { type: "password", inputmode: "text", autocomplete: "off", "aria-label": "PIN ทีม" });
    const r = await modal({
      title: "ใส่ PIN ทีม",
      body: h("div", {}, h("p", { class: "muted", text: message || "ต้องใช้ PIN ก่อนเพิ่ม แก้ไข หรือลบจุดชาร์จ (ดูแผนที่ไม่ต้องใช้)" }), input),
      actions: [{ label: "ยกเลิก", value: false }, { label: "ตกลง", primary: true, value: true, validate: () => (input.value.trim() ? "" : "กรุณาใส่ PIN") }],
    });
    return r ? input.value.trim() : null;
  }

  /** เรียก run(pin) โดยใช้ PIN ที่จำไว้ · 401 → ถามใหม่ · คืน null ถ้าผู้ใช้ยกเลิก */
  async function withPin(run) {
    let pin = store.get("ev_pin");
    let message = "";
    for (let i = 0; i < 4; i++) {
      if (!pin) {
        pin = await askPin(message);
        if (pin === null) return null;
      }
      try {
        const out = await run(pin);
        store.set("ev_pin", pin);
        return out;
      } catch (e) {
        if (e.status === 401) { store.del("ev_pin"); pin = null; message = "PIN ไม่ถูกต้อง ลองใหม่อีกครั้ง"; continue; }
        throw e;
      }
    }
    throw new ApiError(401, "PIN ไม่ถูกต้อง");
  }

  // ---------- map ----------
  const map = L.map("map", { zoomControl: false, attributionControl: true, tap: true }).setView(BANGKOK, 12);
  map.attributionControl.setPrefix(false);
  const zoomCtl = L.control.zoom({ position: "topright" }).addTo(map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  }).addTo(map);
  const creditCtl = L.control({ position: "bottomleft" });
  creditCtl.onAdd = () => h("div", { class: "credit-ctl", text: CREDIT_TEXT });
  creditCtl.addTo(map);
  // zoom control ต้องไม่ทับ top bar
  zoomCtl.getContainer().style.marginTop = "calc(env(safe-area-inset-top, 0px) + 84px)";

  const cluster = L.markerClusterGroup({
    maxClusterRadius: 55, disableClusteringAtZoom: CLUSTER_OFF_ZOOM, chunkedLoading: true,
    showCoverageOnHover: false, spiderfyOnMaxZoom: false,
  });
  map.addLayer(cluster);

  /** @type {Map<string, {st:any, marker:L.Marker, sig:string, shown:boolean}>} */
  const entries = new Map();
  let selectedId = null;

  function markerIcon(st, selected) {
    const b = brandOf(st);
    return L.divIcon({
      className: "lp-wrap" + (selected ? " sel-wrap" : ""),
      html: `<div class="lp ${st.speed}${selected ? " sel" : ""}">${brandInner(b, "lp-img")}${st.bookmarked ? '<span class="bm-star" aria-hidden="true">★</span>' : ""}</div>`,
      iconSize: [36, 36], iconAnchor: [18, 44],
    });
  }
  const sigOf = (st) => JSON.stringify([st.hub, st.name, st.operator, st.connectors, st.speed, st.address, st.hours, st.edited, !!st.bookmarked]);

  function upsertMarker(st) {
    const sig = sigOf(st);
    const cur = entries.get(st.id);
    if (cur) {
      if (cur.sig === sig) return;
      cur.st = st; cur.sig = sig;
      cur.marker.setIcon(markerIcon(st, st.id === selectedId));
      if (st.id === selectedId) renderSheet(st);
      applyOne(cur);
      return;
    }
    const marker = L.marker([st.lat, st.lng], { icon: markerIcon(st, false), keyboard: true, title: st.name, riseOnHover: true });
    marker.on("click", () => selectStation(st.id));
    const e = { st, marker, sig, shown: false };
    entries.set(st.id, e);
    applyOne(e);
  }
  function removeMarker(id) {
    const e = entries.get(id);
    if (!e) return;
    if (e.shown) cluster.removeLayer(e.marker);
    entries.delete(id);
  }

  // ---------- filters ----------
  const defaultFilters = () => ({ ops: [], types: [], minKw: 0, hub: false, bookmarked: false });
  const filters = (() => {
    try { return Object.assign(defaultFilters(), JSON.parse(store.get("ev_filters") || "{}")); }
    catch { return defaultFilters(); }
  })();
  const filterActive = () => (filters.ops.length ? 1 : 0) + (filters.types.length ? 1 : 0) + (filters.minKw ? 1 : 0) + (filters.hub ? 1 : 0) + (filters.bookmarked ? 1 : 0);
  function passes(st) {
    if (filters.hub && !st.hub) return false;
    if (filters.bookmarked && !st.bookmarked) return false;
    if (filters.ops.length && !filters.ops.includes(st.operator_slug || "_other")) return false;
    if (filters.types.length && !st.connectors.some((c) => filters.types.includes(c.type))) return false;
    if (filters.minKw && maxKw(st) < filters.minKw) return false;
    return true;
  }
  function applyOne(e) {
    const want = passes(e.st) || e.st.id === selectedId;
    if (want && !e.shown) { cluster.addLayer(e.marker); e.shown = true; }
    else if (!want && e.shown) { cluster.removeLayer(e.marker); e.shown = false; }
  }
  function applyFilters() {
    for (const e of entries.values()) applyOne(e);
    const n = filterActive();
    const badge = $("#filter-badge");
    badge.hidden = n === 0; badge.textContent = String(n);
    store.set("ev_filters", JSON.stringify(filters));
    updateStatus();
  }

  function buildFilterPanel() {
    const panel = $("#filter-panel");
    panel.replaceChildren();
    const toggle = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); };
    const chip = (label, pressed, onclick, imgSrc) =>
      h("button", { type: "button", class: "chip", "aria-pressed": String(pressed), onclick: (ev) => {
        onclick(); const p = ev.currentTarget.getAttribute("aria-pressed") === "true"; ev.currentTarget.setAttribute("aria-pressed", String(!p)); applyFilters();
      } }, imgSrc ? h("img", { src: imgSrc, alt: "" }) : null, label);

    const opChips = [...logoBySlug.values()].map((l) => chip(l.operator, filters.ops.includes(l.slug), () => toggle(filters.ops, l.slug), l.file ? "/logos/" + l.file : null));
    opChips.push(chip("อื่น ๆ / ไม่ระบุ", filters.ops.includes("_other"), () => toggle(filters.ops, "_other")));
    const typeChips = CONNECTOR_TYPES.map((t) => chip(t, filters.types.includes(t), () => toggle(filters.types, t)));
    const kwSel = h("select", { "aria-label": "kW ขั้นต่ำ", onchange: (e) => { filters.minKw = Number(e.target.value); applyFilters(); } },
      [[0, "ทุกกำลังไฟ"], [7, "7 kW ขึ้นไป"], [22, "22 kW ขึ้นไป"], [50, "50 kW ขึ้นไป (DC เร็ว)"], [100, "100 kW ขึ้นไป"], [150, "150 kW ขึ้นไป"]]
        .map(([v, t]) => h("option", { value: v, selected: filters.minKw === v }, t)));
    const hubChip = chip("Hub (สถานีชาร์จขนาดใหญ่)", !!filters.hub, () => { filters.hub = !filters.hub; loadViewport(); });
    const bmChip = chip("★ เฉพาะที่บันทึกไว้", !!filters.bookmarked, () => { filters.bookmarked = !filters.bookmarked; loadViewport(); });
    panel.append(
      h("h3", { text: "ประเภทสถานี" }), h("div", { class: "chips" }, [hubChip, bmChip]),
      h("h3", { text: "ยี่ห้อ" }), h("div", { class: "chips" }, opChips),
      h("h3", { text: "ชนิดหัวชาร์จ" }), h("div", { class: "chips" }, typeChips),
      h("h3", { text: "กำลังไฟขั้นต่ำ" }), kwSel,
      h("div", { class: "filter-actions" },
        h("button", { type: "button", class: "btn", text: "ล้างตัวกรอง", onclick: () => { Object.assign(filters, defaultFilters()); applyFilters(); buildFilterPanel(); loadViewport(); } }),
        h("button", { type: "button", class: "btn primary", text: "ปิด", onclick: () => toggleFilter(false) })),
    );
  }
  function toggleFilter(open) {
    const panel = $("#filter-panel");
    const show = open ?? panel.hidden;
    if (show) { toggleBookmarks(false); buildFilterPanel(); }
    panel.hidden = !show;
    $("#btn-filter").setAttribute("aria-expanded", String(show));
  }
  $("#btn-filter").addEventListener("click", () => toggleFilter());

  // ---------- bookmarks panel ----------
  let lastGps = null; // ตำแหน่ง GPS ล่าสุดที่อ่านได้ (ใช้คำนวณระยะในรายการ bookmark)
  let bmReq = 0;
  function bookmarkRow(st, origin) {
    const km = (origin.distanceTo(L.latLng(st.lat, st.lng)) / 1000).toFixed(1);
    const logo = h("div", { class: `logoc ${st.speed}` });
    logo.innerHTML = brandInner(brandOf(st), "logo-img");
    return h("li", { class: "bm-row" },
      h("button", { type: "button", class: "bm-main", onclick: () => openBookmark(st) },
        logo,
        h("span", { class: "bm-text" }, h("span", { class: "bm-name", text: st.name }), h("span", { class: "bm-sub", text: `${st.operator} · ${km} กม.` }))),
      h("a", { class: "btn bm-nav", href: navUrl(st), target: "_blank", rel: "noopener", "aria-label": `นำทางไป ${st.name}`, text: "นำทาง" }));
  }
  function openBookmark(st) {
    toggleBookmarks(false);
    upsertMarker(st);
    const z = Math.max(map.getZoom(), 16);
    const target = map.project(L.latLng(st.lat, st.lng), z).add([0, Math.min(window.innerHeight * 0.22, 160)]);
    map.flyTo(map.unproject(target, z), z);
    selectStation(st.id, { pan: false });
  }
  async function buildBookmarkPanel() {
    const panel = $("#bm-panel");
    const my = ++bmReq;
    panel.replaceChildren(h("h3", { text: "จุดที่บันทึกไว้" }), h("p", { class: "muted", text: "กำลังโหลด…" }));
    try {
      const data = await api("/api/bookmarks");
      if (my !== bmReq) return;
      const origin = lastGps || map.getCenter();
      const list = data.stations
        .map((st) => ({ st, d: origin.distanceTo(L.latLng(st.lat, st.lng)) }))
        .sort((a, b) => a.d - b.d);
      panel.replaceChildren(
        h("h3", { text: `จุดที่บันทึกไว้${list.length ? ` (${list.length})` : ""}` }),
        list.length ? h("ul", { class: "bm-list" }, list.map(({ st }) => bookmarkRow(st, origin))) : h("p", { class: "muted", text: "ยังไม่มีจุดที่บันทึกไว้" }),
        h("div", { class: "filter-actions" }, h("button", { type: "button", class: "btn primary", text: "ปิด", onclick: () => toggleBookmarks(false) })),
      );
    } catch (e) {
      if (my !== bmReq) return;
      toggleBookmarks(false);
      toast(e.message || "โหลดรายการที่บันทึกไว้ไม่สำเร็จ");
    }
  }
  function toggleBookmarks(open) {
    const panel = $("#bm-panel");
    const show = open ?? panel.hidden;
    if (show) { toggleFilter(false); buildBookmarkPanel(); } else bmReq++;
    panel.hidden = !show;
    $("#btn-bookmarks").setAttribute("aria-expanded", String(show));
  }
  $("#btn-bookmarks").addEventListener("click", () => toggleBookmarks());

  // ---------- search (ADR 0004) ----------
  const searchInput = $("#search-input");
  const searchClear = $("#search-clear");
  const searchDrop = $("#search-drop");
  const SEARCH_MIN = 2;
  // stations: null=ยังไม่โหลด · places: null=ยังไม่ค้น · placeState: idle|loading|error
  const search = { q: "", stations: null, stationState: "idle", places: null, placeState: "idle", open: false };
  let stationCtl = null;
  let geoCtl = null;

  function searchOrigin() { return lastGps || map.getCenter(); }
  function closeSearch() {
    if (stationCtl) { stationCtl.abort(); stationCtl = null; }
    if (geoCtl) { geoCtl.abort(); geoCtl = null; }
    search.open = false;
    searchDrop.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
  }
  function resetSearchResults() {
    if (stationCtl) { stationCtl.abort(); stationCtl = null; }
    if (geoCtl) { geoCtl.abort(); geoCtl = null; }
    search.stations = null; search.stationState = "idle"; search.places = null; search.placeState = "idle";
  }
  function renderSearch() {
    const q = search.q;
    if (!search.open || q.length < SEARCH_MIN) { searchDrop.hidden = true; searchInput.setAttribute("aria-expanded", "false"); return; }
    const parts = [h("div", { class: "dsec", text: "จุดชาร์จ" })];
    if (search.stationState === "loading" && !search.stations) parts.push(h("p", { class: "dmsg", text: "กำลังค้นหา…" }));
    else if (search.stationState === "error") parts.push(h("p", { class: "dmsg err", text: "ค้นหาจุดชาร์จไม่สำเร็จ ลองใหม่อีกครั้ง" }));
    else if (search.stations && !search.stations.length) parts.push(h("p", { class: "dmsg", text: "ไม่พบจุดชาร์จ" }));
    else if (search.stations) {
      for (const st of search.stations) {
        const logo = h("div", { class: `logoc ${st.speed}` });
        logo.innerHTML = brandInner(brandOf(st), "logo-img");
        parts.push(h("button", { type: "button", class: "drow", onclick: () => pickStation(st) },
          logo,
          h("span", { class: "tx" }, h("b", { text: st.name }), h("span", { text: st.operator })),
          st.distance_km != null ? h("span", { class: "d", text: `${st.distance_km} กม.` }) : null));
      }
    }
    parts.push(h("button", {
      type: "button", class: "drow q", disabled: search.placeState === "loading", onclick: () => runGeocode(),
    }, h("span", { "aria-hidden": "true", text: "🔍" }), h("span", { class: "tx" }, h("b", { text: `ค้นหาสถานที่ "${q}"` }))));
    if (search.placeState !== "idle") {
      parts.push(h("div", { class: "dsec", text: "สถานที่" }));
      if (search.placeState === "loading") parts.push(h("p", { class: "dmsg", text: "กำลังค้นหาสถานที่…" }));
      else if (search.placeState === "error") parts.push(h("p", { class: "dmsg err", text: "ค้นหาสถานที่ไม่สำเร็จ ลองใหม่อีกครั้ง" }));
      else if (!search.places.length) parts.push(h("p", { class: "dmsg", text: "ไม่พบสถานที่" }));
      else {
        for (const pl of search.places) {
          parts.push(h("button", { type: "button", class: "drow", onclick: () => pickPlace(pl) },
            h("span", { class: "pin", "aria-hidden": "true", text: "📍" }),
            h("span", { class: "tx" }, h("b", { text: pl.display_name.split(",")[0].trim() || pl.display_name }), h("span", { text: pl.display_name }))));
        }
      }
      if (search.placeState === "done") parts.push(h("div", { class: "dcredit", text: "ค้นหาสถานที่โดย © OpenStreetMap" }));
    }
    searchDrop.replaceChildren(...parts);
    searchDrop.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
  }
  async function runStations() {
    const q = search.q;
    if (q.length < SEARCH_MIN) return;
    if (stationCtl) stationCtl.abort();
    const ctl = (stationCtl = new AbortController());
    search.stationState = "loading";
    renderSearch();
    const o = searchOrigin();
    try {
      const data = await api(`/api/stations?q=${encodeURIComponent(q)}&lat=${o.lat.toFixed(5)}&lng=${o.lng.toFixed(5)}`, { signal: ctl.signal });
      if (ctl !== stationCtl) return;
      search.stations = data.stations; search.stationState = "done";
    } catch (e) {
      if (e.name === "AbortError" || ctl !== stationCtl) return;
      search.stationState = "error";
    }
    stationCtl = null;
    renderSearch();
  }
  async function runGeocode() {
    const q = search.q;
    if (q.length < SEARCH_MIN || search.placeState === "loading") return;
    if (geoCtl) geoCtl.abort();
    const ctl = (geoCtl = new AbortController());
    search.placeState = "loading";
    renderSearch();
    try {
      const data = await api(`/api/geocode?q=${encodeURIComponent(q)}`, { signal: ctl.signal });
      if (ctl !== geoCtl) return;
      search.places = data.results || []; search.placeState = "done";
    } catch (e) {
      if (e.name === "AbortError" || ctl !== geoCtl) return;
      search.placeState = "error";
    }
    geoCtl = null;
    renderSearch();
  }
  function pickStation(st) {
    closeSearch();
    searchInput.blur();
    openBookmark(st); // upsertMarker + flyTo + เปิด sheet
  }
  function pickPlace(pl) {
    closeSearch();
    searchInput.blur();
    map.flyTo([pl.lat, pl.lng], 14); // moveend → loadViewport โหลดจุดชาร์จตามปกติ
  }
  const searchSoon = debounce(runStations, 300);
  function onSearchInput() {
    const q = searchInput.value.trim();
    searchClear.hidden = searchInput.value === "";
    if (q === search.q) return;
    search.q = q;
    resetSearchResults();
    if (q.length < SEARCH_MIN) { searchSoon.cancel?.(); renderSearch(); return; }
    search.open = true;
    renderSearch();
    searchSoon();
  }
  searchInput.addEventListener("input", onSearchInput);
  searchInput.addEventListener("focus", () => {
    toggleFilter(false); toggleBookmarks(false);
    if (search.q.length >= SEARCH_MIN) { search.open = true; renderSearch(); }
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const q = searchInput.value.trim();
      if (q.length < SEARCH_MIN) return;
      if (q !== search.q) { search.q = q; resetSearchResults(); }
      search.open = true;
      if (!search.stations && search.stationState !== "loading") runStations();
      runGeocode();
    } else if (e.key === "Escape") { closeSearch(); searchInput.blur(); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && search.open) closeSearch(); });
  searchClear.addEventListener("click", () => {
    searchInput.value = ""; searchClear.hidden = true;
    search.q = ""; resetSearchResults(); closeSearch();
    searchInput.focus();
  });

  // ---------- load stations for viewport ----------
  let lastLoad = { count: 0, truncated: false, tooFar: false, loading: false, mode: "" };
  let loadCtl = null;
  // โหมดพิเศษ (hub / bookmark) โหลดทั่วประเทศ ไม่ผูก bbox และไม่สนซูมขั้นต่ำ
  const loadMode = () => (filters.hub ? "h" : "") + (filters.bookmarked ? "b" : "");
  function updateStatus() {
    if (lastLoad.loading) return; // อย่าทับ "กำลังโหลด…" ด้วยจำนวนเก่า
    const mode = loadMode();
    if (mode && !lastLoad.tooFar) {
      if (lastLoad.mode !== mode) return; // ยังไม่เคยโหลดโหมดนี้เสร็จ
      let n = 0;
      for (const e of entries.values()) if (e.shown) n++;
      const label = mode === "h" ? "พบ Hub" : mode === "b" ? "พบจุดที่บันทึกไว้" : "พบ Hub ที่บันทึกไว้";
      return setStatus(`${label} ${n.toLocaleString("th-TH")} จุด`);
    }
    if (lastLoad.tooFar) return setStatus("ซูมเข้าเพื่อดูจุดชาร์จ");
    let shown = 0;
    const b = map.getBounds();
    for (const e of entries.values()) if (e.shown && b.contains(e.marker.getLatLng())) shown++;
    setStatus(`พบ ${shown.toLocaleString("th-TH")} จุดในหน้าจอ${lastLoad.truncated ? " (ซูมเข้าเพื่อดูเพิ่ม)" : ""}`);
  }
  async function loadViewport() {
    const mode = loadMode();
    const special = !!mode;
    if (!special && map.getZoom() < MIN_FETCH_ZOOM) { loadCtl?.abort(); lastLoad.tooFar = true; lastLoad.loading = false; updateStatus(); return; }
    lastLoad.tooFar = false;
    const b = map.getBounds().pad(0.15);
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(5)).join(",");
    // hub+bookmark พร้อมกัน → โหลด bookmark แล้วให้ passes() กรอง hub ซ้ำ
    const path = filters.bookmarked ? "/api/bookmarks" : filters.hub ? "/api/stations?hub=1" : `/api/stations?bbox=${bbox}`;
    loadCtl?.abort();
    loadCtl = new AbortController();
    lastLoad.loading = true;
    setStatus("กำลังโหลด…");
    try {
      const data = await api(path, { signal: loadCtl.signal });
      const seen = new Set();
      for (const st of data.stations) { seen.add(st.id); upsertMarker(st); }
      // จุดที่อยู่ในกรอบแต่ server ไม่ส่งมาแล้ว (ถูกลบ/หายจาก KML) → เอาออก (ถ้าไม่ถูกตัดที่ 500)
      if (!special && !data.truncated) for (const [id, e] of [...entries]) if (!seen.has(id) && b.contains(e.marker.getLatLng())) removeMarker(id);
      if (entries.size > MAX_CACHED) trimCache();
      lastLoad = { count: data.count, truncated: !!data.truncated, tooFar: false, loading: false, mode };
      updateStatus();
    } catch (e) {
      if (e.name === "AbortError") return;
      lastLoad.loading = false;
      setStatus("โหลดจุดชาร์จไม่สำเร็จ");
      toast(e.message || "โหลดไม่สำเร็จ");
    }
  }
  function trimCache() {
    const c = map.getCenter();
    const far = [...entries.entries()].filter(([id]) => id !== selectedId)
      .sort((a, b) => c.distanceTo(b[1].marker.getLatLng()) - c.distanceTo(a[1].marker.getLatLng()));
    for (const [id] of far.slice(0, entries.size - MAX_CACHED + 500)) removeMarker(id);
  }
  const loadSoon = debounce(loadViewport, 300);
  map.on("moveend", loadSoon);

  // ---------- selection + bottom sheet ----------
  function selectStation(id, { pan = true } = {}) {
    const prev = selectedId && entries.get(selectedId);
    selectedId = id;
    if (prev) { prev.marker.setIcon(markerIcon(prev.st, false)); applyOne(prev); }
    const e = entries.get(id);
    if (!e) return;
    applyOne(e);
    e.marker.setIcon(markerIcon(e.st, true));
    if (pan) map.panTo(offsetCenter(e.marker.getLatLng()), { animate: true });
    renderSheet(e.st);
  }
  function offsetCenter(ll) {
    // ดันจุดขึ้นเหนือ bottom sheet
    const p = map.latLngToContainerPoint(ll);
    return map.containerPointToLatLng(L.point(p.x, p.y + Math.min(window.innerHeight * 0.22, 160)));
  }
  function closeSheet() {
    const sheet = $("#sheet");
    sheet.classList.remove("open"); sheet.setAttribute("aria-hidden", "true");
    document.body.classList.remove("sheet-open");
    const e = selectedId && entries.get(selectedId);
    selectedId = null;
    if (e) { e.marker.setIcon(markerIcon(e.st, false)); applyOne(e); }
    if (new URL(location.href).searchParams.has("s")) history.replaceState(null, "", location.pathname);
  }
  map.on("click", () => { if (selectedId) closeSheet(); toggleFilter(false); toggleBookmarks(false); closeSearch(); });

  const navUrl = (st) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(st.lat + "," + st.lng)}&travelmode=driving`;
  const shareUrl = (st) => `${location.origin}/?s=${encodeURIComponent(st.id)}`;

  function renderSheet(st) {
    const sheet = $("#sheet");
    const b = brandOf(st);
    const logo = h("div", { class: `logoc ${st.speed}` });
    logo.innerHTML = brandInner(b, "logo-img");
    const rows = [];
    if (st.name_en) rows.push(h("div", { class: "name-en", text: st.name_en }));
    const info = [];
    info.push(h("div", { class: "row" }, h("span", { class: `speed-pill ${st.speed}`, text: SPEED_LABEL[st.speed] }), st.edited ? h("span", { class: "tag", text: "ทีมแก้ไขแล้ว" }) : null, st.source === "user" ? h("span", { class: "tag", text: "ทีมเพิ่ม" }) : null));
    if (st.address) info.push(h("div", { class: "row" }, h("span", { class: "k", "aria-hidden": "true", text: "📍" }), h("span", { text: st.address })));
    if (st.hours) info.push(h("div", { class: "row" }, h("span", { class: "k", "aria-hidden": "true", text: "🕒" }), h("span", { text: "เปิด " + st.hours })));
    const conns = st.connectors.length
      ? h("ul", { class: "conns", "aria-label": "หัวชาร์จ" }, st.connectors.map((c) => {
        const l = connLabel(c);
        return h("li", {}, h("span", { class: "t", text: l.type }), h("span", { text: [l.kw, l.count].filter(Boolean).join("  ") }));
      }))
      : h("p", { class: "muted", text: "ยังไม่มีข้อมูลหัวชาร์จ — กดแก้ไขเพื่อช่วยเพิ่ม" });

    const buttons = [
      h("a", { class: "btn primary", href: navUrl(st), target: "_blank", rel: "noopener", text: "นำทาง" }),
      h("button", { type: "button", class: "btn bm-toggle", "aria-pressed": String(!!st.bookmarked), text: st.bookmarked ? "★ บันทึกแล้ว" : "☆ บันทึก", onclick: (ev) => toggleBookmark(st, ev.currentTarget) }),
      h("button", { type: "button", class: "btn", text: "แชร์", onclick: () => shareStation(st) }),
      h("button", { type: "button", class: "btn", text: "แก้ไข", onclick: () => editStation(st) }),
    ];
    if (st.source === "user") buttons.push(h("button", { type: "button", class: "btn danger", text: "ลบ", onclick: () => deleteStation(st) }));

    sheet.replaceChildren(
      h("div", { class: "sheet-grip" }),
      h("button", { type: "button", class: "sheet-close", "aria-label": "ปิด", text: "×", onclick: closeSheet }),
      h("div", { class: "pophead" }, logo, h("div", {}, h("div", { class: "brand", text: st.operator }), h("h2", {}, st.name, st.hub ? h("span", { class: "hub-badge", text: "Hub" }) : null), ...rows)),
      ...info, conns,
      h("div", { class: "btnrow" }, buttons),
      st.source === "mymaps" ? h("div", { class: "credit", text: CREDIT_TEXT }) : null,
    );
    sheet.classList.add("open"); sheet.setAttribute("aria-hidden", "false");
    document.body.classList.add("sheet-open");
  }

  async function toggleBookmark(st, btn) {
    const want = !st.bookmarked;
    btn.disabled = true;
    try {
      const url = `/api/bookmarks/${encodeURIComponent(st.id)}`;
      const out = await withPin((pin) => api(url, {
        method: want ? "PUT" : "DELETE", pin, body: want ? { created_by: store.get("ev_name") || undefined } : undefined,
      }));
      if (!out) return;
      let updated = out;
      if (!want) {
        try { updated = await api(`/api/stations/${encodeURIComponent(st.id)}`); }
        catch { updated = { ...(entries.get(st.id)?.st || st), bookmarked: false }; }
      }
      upsertMarker(updated);
      if (selectedId === st.id) renderSheet(updated);
      toast(want ? "บันทึกจุดนี้แล้ว" : "เอาออกจากที่บันทึกไว้แล้ว");
      updateStatus();
    } catch (e) { toast(e.message); }
    finally { btn.disabled = false; }
  }

  async function shareStation(st) {
    const url = shareUrl(st);
    const data = { title: st.name, text: `${st.name} (${st.operator})`, url };
    if (navigator.share) {
      try { await navigator.share(data); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); toast("คัดลอกลิงก์แล้ว"); return; } catch { /* fall through */ }
    const input = h("input", { type: "text", value: url, readonly: true, "aria-label": "ลิงก์จุดชาร์จ" });
    modal({ title: "คัดลอกลิงก์", body: input, actions: [{ label: "ปิด", primary: true, value: true }] });
    input.select();
  }

  // ---------- add / edit form ----------
  function connectorEditor(initial) {
    const wrap = h("div", {});
    const rows = [];
    const addRow = (c = {}) => {
      const type = h("select", { "aria-label": "ชนิดหัว" },
        h("option", { value: "" }, "ไม่ทราบ"),
        CONNECTOR_TYPES.map((t) => h("option", { value: t, selected: c.type === t }, t)));
      if (c.type && !CONNECTOR_TYPES.includes(c.type)) type.append(h("option", { value: c.type, selected: true }, c.type));
      const kw = h("input", { type: "number", inputmode: "decimal", min: "0", step: "any", placeholder: "kW", "aria-label": "kW", value: c.kw ?? "" });
      const count = h("input", { type: "number", inputmode: "numeric", min: "1", step: "1", placeholder: "จำนวน", "aria-label": "จำนวนหัว", value: c.count ?? "" });
      const del = h("button", { type: "button", "aria-label": "ลบแถว", text: "×" });
      const row = h("div", { class: "crow" }, type, kw, count, del);
      del.addEventListener("click", () => { row.remove(); rows.splice(rows.indexOf(rowObj), 1); });
      const rowObj = { type, kw, count };
      rows.push(rowObj); wrap.append(row);
    };
    (initial || []).forEach(addRow);
    if (!initial || !initial.length) addRow();
    const el = h("div", {}, h("div", { class: "crow-head", text: "ชนิดหัว · กำลังไฟ (kW) · จำนวน" }), wrap,
      h("button", { type: "button", class: "btn", style: "width:100%;margin-top:6px", text: "+ เพิ่มหัวชาร์จ", onclick: () => addRow() }));
    return {
      el,
      read() {
        return rows.map((r) => ({
          type: r.type.value || null,
          kw: r.kw.value === "" ? null : Number(r.kw.value),
          count: r.count.value === "" ? null : Number(r.count.value),
        })).filter((c) => c.type || c.kw != null || c.count != null);
      },
    };
  }

  const OPERATOR_OPTIONS = () => [...logoBySlug.values()].map((l) => l.operator);

  /** คืน { name, name_en, address, hours, operator, connectors, by } หรือ null */
  async function stationForm({ title, st, locationText }) {
    const isAdd = !st;
    const name = h("input", { type: "text", value: st?.name ?? "", maxlength: "200", autocomplete: "off", "aria-label": "ชื่อสถานี" });
    const nameEn = h("input", { type: "text", maxlength: "200", autocomplete: "off", "aria-label": "ชื่ออังกฤษ" });
    const address = h("input", { type: "text", maxlength: "500", autocomplete: "off", "aria-label": "ที่อยู่" });
    const hours = h("input", { type: "text", maxlength: "200", autocomplete: "off", placeholder: "เช่น 24 ชม.", "aria-label": "เวลาเปิด" });
    const opList = h("datalist", { id: "op-list" }, OPERATOR_OPTIONS().map((o) => h("option", { value: o })));
    const op = h("input", { type: "text", list: "op-list", value: st && st.operator !== "ไม่ระบุ" ? st.operator : "", maxlength: "100", autocomplete: "off", "aria-label": "ยี่ห้อ" });
    const conns = connectorEditor(st?.connectors);
    const by = h("input", { type: "text", maxlength: "100", autocomplete: "name", value: store.get("ev_name") || "", "aria-label": "ชื่อผู้แก้" });
    const body = h("div", {},
      locationText ? h("p", { class: "muted", text: locationText }) : null,
      h("label", { text: "ชื่อสถานี *" }), name,
      isAdd ? [h("label", { text: "ชื่ออังกฤษ (ถ้ามี)" }), nameEn, h("label", { text: "ที่อยู่ (ถ้ามี)" }), address, h("label", { text: "เวลาเปิด (ถ้ามี)" }), hours] : null,
      h("label", { text: "ยี่ห้อ / ผู้ให้บริการ" }), op, opList,
      h("label", { text: "หัวชาร์จ" }), conns.el,
      h("label", { text: "ชื่อผู้บันทึก (ไม่บังคับ)" }), by,
    );
    const ok = await modal({
      title, body,
      actions: [{ label: "ยกเลิก", value: false }, { label: "บันทึก", primary: true, value: true, validate: () => {
        if (!name.value.trim()) return "กรุณาใส่ชื่อสถานี";
        for (const c of conns.read()) {
          if (c.kw != null && !(c.kw > 0 && c.kw <= 1500)) return "kW ไม่ถูกต้อง";
          if (c.count != null && !(Number.isInteger(c.count) && c.count > 0 && c.count <= 100)) return "จำนวนหัวต้องเป็นจำนวนเต็ม";
        }
        return "";
      } }],
    });
    if (!ok) return null;
    store.set("ev_name", by.value.trim());
    return {
      name: name.value.trim(), name_en: nameEn.value.trim() || undefined, address: address.value.trim() || undefined,
      hours: hours.value.trim() || undefined, operator: op.value.trim() || null, connectors: conns.read(), by: by.value.trim() || undefined,
    };
  }

  async function editStation(st) {
    const f = await stationForm({ title: "แก้ไขข้อมูลจุดชาร์จ", st });
    if (!f) return;
    try {
      const updated = await withPin((pin) => api(`/api/stations/${encodeURIComponent(st.id)}`, {
        method: "PATCH", pin, body: { name: f.name, operator: f.operator, connectors: f.connectors, edited_by: f.by },
      }));
      if (!updated) return;
      upsertMarker(updated);
      toast("บันทึกแล้ว");
      selectStation(updated.id, { pan: false });
    } catch (e) { toast(e.message); }
  }

  let lastAddAt = 0;
  async function addStationAt(latlng) {
    if (Date.now() - lastAddAt < 1000) return;
    lastAddAt = Date.now();
    const f = await stationForm({
      title: "เพิ่มจุดชาร์จ", locationText: `ตำแหน่ง: ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`,
    });
    if (!f) return;
    try {
      const created = await withPin((pin) => api("/api/stations", {
        method: "POST", pin, body: { name: f.name, name_en: f.name_en, address: f.address, hours: f.hours, operator: f.operator,
          connectors: f.connectors, lat: latlng.lat, lng: latlng.lng, created_by: f.by },
      }));
      if (!created) return;
      upsertMarker(created);
      toast("เพิ่มจุดแล้ว");
      selectStation(created.id);
    } catch (e) { toast(e.message); }
  }

  async function deleteStation(st) {
    const ok = await confirmModal("ลบจุดชาร์จ?", `ลบ "${st.name}" ออกจากแผนที่ (ลบได้เฉพาะจุดที่ทีมเพิ่มเอง)`, "ลบ", true);
    if (!ok) return;
    try {
      const r = await withPin((pin) => api(`/api/stations/${encodeURIComponent(st.id)}`, {
        method: "DELETE", pin, body: { deleted_by: store.get("ev_name") || undefined },
      }));
      if (!r) return;
      closeSheet();
      removeMarker(st.id);
      toast("ลบแล้ว");
      updateStatus();
    } catch (e) { toast(e.message); }
  }

  // FAB เพิ่มจุด
  $("#btn-add").addEventListener("click", async () => {
    const choice = await modal({
      title: "เพิ่มจุดชาร์จ",
      body: h("p", { class: "muted", text: "เลือกตำแหน่งของจุดใหม่ (หรือกดค้างบนแผนที่ตรงตำแหน่งที่ต้องการ)" }),
      actions: [
        { label: "ยกเลิก", value: null },
        { label: "กลางแผนที่", value: "center" },
        { label: "ตำแหน่งปัจจุบัน", primary: true, value: "gps" },
      ],
    });
    if (choice === "center") addStationAt(map.getCenter());
    else if (choice === "gps") {
      const ll = await getPosition();
      if (ll) addStationAt(ll); else toast("อ่านตำแหน่งปัจจุบันไม่ได้ — กดค้างบนแผนที่เพื่อเลือกตำแหน่ง");
    }
  });

  // กดค้างบนแผนที่ (pointer events ใช้ได้ทั้ง iOS/Android) + คลิกขวาบนเดสก์ท็อป
  (() => {
    const el = map.getContainer();
    let timer = null, start = null;
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.target.closest(".leaflet-marker-icon, .leaflet-control, .credit-ctl")) return;
      start = { x: e.clientX, y: e.clientY };
      cancel();
      timer = setTimeout(() => {
        timer = null;
        const rect = el.getBoundingClientRect();
        addStationAt(map.containerPointToLatLng(L.point(start.x - rect.left, start.y - rect.top)));
      }, LONG_PRESS_MS);
    });
    el.addEventListener("pointermove", (e) => { if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel(); });
    for (const t of ["pointerup", "pointercancel", "pointerleave"]) el.addEventListener(t, cancel);
    map.on("zoomstart movestart", cancel);
    map.on("contextmenu", (e) => { e.originalEvent?.preventDefault?.(); addStationAt(e.latlng); });
  })();

  // ---------- GPS ----------
  let userMarker = null;
  function getPosition(timeout = 8000) {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(L.latLng(p.coords.latitude, p.coords.longitude)),
        () => resolve(null),
        { enableHighAccuracy: true, timeout, maximumAge: 30000 },
      );
    });
  }
  function showUser(ll) {
    if (userMarker) userMarker.setLatLng(ll);
    else userMarker = L.marker(ll, { icon: L.divIcon({ className: "", html: '<div class="user-dot" style="width:18px;height:18px"></div>', iconSize: [18, 18] }), interactive: false, keyboard: false, zIndexOffset: -500 }).addTo(map);
  }
  async function locateMe({ recenter = true } = {}) {
    const ll = await getPosition();
    if (ll) lastGps = ll;
    if (!ll) { if (recenter) toast("อ่านตำแหน่งไม่ได้ — อนุญาตการเข้าถึงตำแหน่งในเบราว์เซอร์"); return false; }
    showUser(ll);
    if (recenter) map.setView(ll, 15);
    return true;
  }
  $("#btn-locate").addEventListener("click", () => locateMe());

  // ---------- boot ----------
  async function boot() {
    await loadLogos();
    applyFilters();

    const sid = new URL(location.href).searchParams.get("s");
    let startedAtStation = false;
    if (sid) {
      try {
        const st = await api(`/api/stations/${encodeURIComponent(sid)}`);
        map.setView([st.lat, st.lng], 16);
        upsertMarker(st);
        selectStation(st.id, { pan: false });
        startedAtStation = true;
      } catch { toast("ไม่พบจุดชาร์จจากลิงก์นี้"); }
    }
    if (startedAtStation) {
      locateMe({ recenter: false });
    } else {
      setStatus("กำลังหาตำแหน่งของคุณ…");
      map.setView(BANGKOK, 12);
      const ok = await locateMe();
      if (!ok) { setStatus("ใช้ตำแหน่งกรุงเทพฯ"); }
    }
    loadViewport();

    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  boot();
})();
