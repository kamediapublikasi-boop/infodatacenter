"use strict";

/* ============== Util ============== */
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function parseDate(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}
function fmtDate(d) {
  if (!d) return "—";
  const months = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtDateLong(d) {
  if (!d) return "—";
  const months = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function todayMidnight() { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function isSameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

/* ============== CSV Parser (RFC4180-ish, untuk import) ============== */
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(x => x.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some(x => x.trim() !== "")) rows.push(row);
  return rows;
}

function toCSV(rows) {
  return rows.map(r => r.map(f => {
    f = String(f == null ? "" : f);
    return /[",\n\r]/.test(f) ? '"' + f.replace(/"/g, '""') + '"' : f;
  }).join(",")).join("\r\n");
}

/* ============== Column mapping (format CSV lama, untuk import) ============== */
const COLS = {
  id: 0, nama: 1, kategori: 2, jenis: 3,
  tglMulai: 4, jamMulai: 5, tglSelesai: 6, jamSelesai: 7,
  lokasi: 8, divisi: 9, pj: 10, sasaran: 11, peserta: 12, status: 13, keterangan: 14
};

function normalizeRows(csvRows) {
  const header = csvRows[0] || [];
  const idx = {};
  for (const [key, pos] of Object.entries(COLS)) {
    idx[key] = header[pos] !== undefined && header[pos].trim() !== "" ? pos : -1;
  }
  const events = [];
  for (let r = 1; r < csvRows.length; r++) {
    const row = csvRows[r];
    const get = k => (idx[k] >= 0 ? (row[idx[k]] || "").trim() : "");
    const tglMulai = parseDate(get("tglMulai"));
    if (!tglMulai) continue;
    const tglSelesai = parseDate(get("tglSelesai")) || tglMulai;
    const peserta = parseInt(get("peserta"), 10);
    events.push({
      nama: get("nama") || "Tanpa Nama",
      kategori: get("kategori") || "Lainnya",
      jenis: get("jenis") || "—",
      tglMulai, jamMulai: get("jamMulai"),
      tglSelesai, jamSelesai: get("jamSelesai"),
      lokasi: get("lokasi") || "—",
      divisi: get("divisi") || "—",
      pj: get("pj") || "—",
      sasaran: get("sasaran") || "—",
      peserta: isNaN(peserta) ? null : peserta,
      status: get("status") || "Rencana",
      keterangan: get("keterangan") || ""
    });
  }
  return events;
}

/* ============== Color maps ============== */
const CAT_COLORS = {
  "Ibadah Raya": "#3b82f6",
  "Ibadah Komsel": "#14b8a6",
  "Ibadah Doa & Puasa": "#8b5cf6",
  "Kebaktian Khusus": "#6366f1",
  "Pelatihan & Discipleship": "#22c55e",
  "Retreat & Rekoleksi": "#f97316",
  "Konser & Pertunjukan": "#ec4899",
  "Pelayanan Sosial": "#ef4444",
  "Rapat & Koordinasi": "#64748b"
};
function catColor(k) { return CAT_COLORS[k] || "#7c8aa0"; }

const STATUS_META = {
  "Rencana":   { cls: "st-plan",   label: "Rencana" },
  "Terjadwal": { cls: "st-sched",  label: "Terjadwal" },
  "Berlangsung":{ cls: "st-live",  label: "Berlangsung" },
  "Selesai":   { cls: "st-done",   label: "Selesai" },
  "Dibatalkan":{ cls: "st-cancel", label: "Dibatalkan" }
};
function statusInfo(s) { return STATUS_META[s] || { cls: "", label: s }; }

/* ============== State ============== */
const App = {
  events: [],
  ready: false,
  lastSync: null,
  view: "calendar",
  cal: { y: new Date().getFullYear(), m: new Date().getMonth() },
  selDate: null,
  page: 1, pageSize: 20,
  managePage: 1, manageSearch: "",
  sortKey: "startTS", sortDir: 1,
  filters: {
    preset: "all",
    from: null, to: null,
    kategori: { mode: "all", subset: new Set() },
    status:   { mode: "all", subset: new Set() },
    divisi:   { mode: "all", subset: new Set() },
    search: ""
  }
};

const PRESETS = [
  { key: "all",   label: "Semua" },
  { key: "today", label: "Hari ini" },
  { key: "7d",    label: "7 hari ke depan" },
  { key: "month", label: "Bulan ini" },
  { key: "30d",   label: "30 hari ke depan" },
  { key: "year",  label: "Tahun ini" }
];

/* ============== Filtering ============== */
function presetRange(key) {
  const now = todayMidnight();
  switch (key) {
    case "today": return [now, new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)];
    case "7d":    return [now, new Date(addDays(now, 7).getFullYear(), addDays(now, 7).getMonth(), addDays(now, 7).getDate(), 23, 59, 59, 999)];
    case "month": return [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)];
    case "30d":   return [now, new Date(addDays(now, 30).getFullYear(), addDays(now, 30).getMonth(), addDays(now, 30).getDate(), 23, 59, 59, 999)];
    case "year":  return [new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)];
    default: return null;
  }
}

function timeFilter() {
  const f = App.filters;
  if (f.preset === "custom" && f.from && f.to) {
    return [new Date(f.from.getFullYear(), f.from.getMonth(), f.from.getDate()),
            new Date(f.to.getFullYear(), f.to.getMonth(), f.to.getDate(), 23, 59, 59, 999)];
  }
  return presetRange(f.preset);
}

function matchesTime(ev, range) {
  if (!range) return true;
  const [s, e] = range;
  return ev.startTS <= e && ev.endTS >= s;
}

function inSet(mode, subset, value) {
  if (mode === "all") return true;
  return subset.has(value);
}

function filteredEvents() {
  const f = App.filters;
  const range = timeFilter();
  const q = f.search.toLowerCase();
  return App.events.filter(ev => {
    if (!matchesTime(ev, range)) return false;
    if (!inSet(f.kategori.mode, f.kategori.subset, ev.kategori)) return false;
    if (!inSet(f.status.mode, f.status.subset, ev.status)) return false;
    if (!inSet(f.divisi.mode, f.divisi.subset, ev.divisi)) return false;
    if (q) {
      const hay = (ev.nama + " " + ev.pj + " " + ev.lokasi + " " + ev.sasaran).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function eventsOnDate(list, d) {
  return list.filter(ev => ev.startTS <= d.getTime() && ev.endTS >= d.getTime());
}
function eventsInMonth(list, y, m) {
  const s = new Date(y, m, 1).getTime();
  const e = new Date(y, m + 1, 0, 23, 59, 59, 999).getTime();
  return list.filter(ev => ev.startTS <= e && ev.endTS >= s);
}

/* ============== API client ============== */
async function apiJSON(path, opts) {
  const res = await fetch(path, opts || {});
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : null;
  if (!res.ok) throw new Error((body && body.error) || ("HTTP " + res.status));
  return body;
}

const PIN_LS = "idcEditPin";
function getPinState() {
  try {
    const s = JSON.parse(sessionStorage.getItem(PIN_LS));
    return s && typeof s === "object" ? s : { ok: false };
  } catch (e) { return { ok: false }; }
}
function isEditAllowed() { return getPinState().ok === true; }
function pinHeaders() {
  const s = getPinState();
  return s && s.ok && s.pin ? { "X-Edit-Pin": s.pin } : {};
}
function mutOpts(method, payload) {
  return {
    method,
    headers: { "Content-Type": "application/json", ...pinHeaders() },
    body: typeof payload === "string" ? payload : JSON.stringify(payload)
  };
}

const API = {
  list() { return apiJSON("/api/events"); },
  create(payload) { return apiJSON("/api/events", mutOpts("POST", payload)); },
  update(id, payload) { return apiJSON("/api/events/" + id, mutOpts("PUT", payload)); },
  del(id) { return apiJSON("/api/events/" + id, mutOpts("DELETE")); },
  bulk(payloads) { return apiJSON("/api/events/bulk", mutOpts("POST", { events: payloads })); },
  verifyPin(pin) {
    return apiJSON("/api/verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin })
    });
  }
};

const ImageAPI = {
  async get(id) {
    try {
      const r = await fetch("/api/events/" + id + "/image");
      if (!r.ok) return null;
      return await r.blob();
    } catch (e) { return null; }
  },
  async put(id, blob) {
    const s = getPinState();
    const r = await fetch("/api/events/" + id + "/image", {
      method: "POST",
      headers: { "X-Edit-Pin": s.pin },
      body: blob
    });
    if (!r.ok) {
      let msg = "HTTP " + r.status;
      try { const b = await r.json(); if (b.error) msg = b.error; } catch (e) {}
      throw new Error(msg);
    }
  },
  async del(id) {
    const s = getPinState();
    const r = await fetch("/api/events/" + id + "/image", {
      method: "DELETE",
      headers: { "X-Edit-Pin": s.pin }
    });
    if (!r.ok) throw new Error("Gambar gagal dihapus");
  }
};

function normalizeAPIRows(rows) {
  return rows.map(ev => {
    const tglMulai = parseDate(ev.tglMulai);
    const tglSelesai = parseDate(ev.tglSelesai) || tglMulai;
    return {
      id: ev.id,
      nama: ev.nama, kategori: ev.kategori, jenis: ev.jenis,
      tglMulai, jamMulai: ev.jamMulai || "",
      tglSelesai, jamSelesai: ev.jamSelesai || "",
      lokasi: ev.lokasi, divisi: ev.divisi, pj: ev.pj, sasaran: ev.sasaran,
      peserta: ev.peserta == null ? null : ev.peserta,
      status: ev.status, keterangan: ev.keterangan || "",
      createdAt: ev.createdAt, updatedAt: ev.updatedAt,
      startTS: tglMulai ? tglMulai.getTime() : 0,
      endTS: tglMulai ? new Date(tglSelesai.getFullYear(), tglSelesai.getMonth(), tglSelesai.getDate(), 23, 59, 59, 999).getTime() : 0
    };
  });
}

function evToPayload(ev) {
  return {
    nama: ev.nama, kategori: ev.kategori, jenis: ev.jenis,
    tglMulai: ev.tglMulai ? iso(ev.tglMulai) : null,
    jamMulai: ev.jamMulai || "",
    tglSelesai: ev.tglSelesai ? iso(ev.tglSelesai) : null,
    jamSelesai: ev.jamSelesai || "",
    lokasi: ev.lokasi, divisi: ev.divisi, pj: ev.pj, sasaran: ev.sasaran,
    peserta: ev.peserta == null ? null : ev.peserta,
    status: ev.status, keterangan: ev.keterangan || ""
  };
}

/* ============== Load / Sync ============== */
function showError(msg) {
  const b = document.getElementById("statusBanner");
  b.hidden = false;
  document.getElementById("statusBannerText").textContent = msg;
}
function hideError() { document.getElementById("statusBanner").hidden = true; }
function dataSignature(list) {
  return list.map(e => e.id + ":" + (e.updatedAt || "")).join("|");
}
function refreshMeta() {
  document.getElementById("dataMeta").textContent =
    `${App.events.length} kegiatan · sinkron ${App.lastSync ? new Date(App.lastSync).toLocaleTimeString("id-ID") : "…"}`;
}

async function loadEvents(opts) {
  const silent = !!(opts && opts.silent);
  try {
    const rows = await API.list();
    App.events = normalizeAPIRows(rows);
    App.ready = true;
    App.lastSync = Date.now();
    hideError();
    document.getElementById("srcInfo").textContent = "Online · data tersinkron otomatis";
    document.getElementById("dash").hidden = false;
    refreshMeta();
    render();
  } catch (e) {
    showError("Tidak dapat menghubungi server: " + e.message);
    if (!silent) throw e;
  }
}

async function pollEvents() {
  try {
    const rows = await API.list();
    const norm = normalizeAPIRows(rows);
    if (dataSignature(norm) === dataSignature(App.events)) return;
    App.events = norm;
    App.lastSync = Date.now();
    refreshMeta();
    const formOpen = document.getElementById("formOverlay").classList.contains("open");
    if (!formOpen) {
      render();
      toast("Data diperbarui dari server");
    }
  } catch (e) { /* offline, abaikan */ }
}

/* ============== PIN ============== */
function openPinModal() {
  document.getElementById("pinError").hidden = true;
  const inp = document.getElementById("pinInput");
  inp.value = "";
  document.getElementById("pinOverlay").classList.add("open");
  setTimeout(() => inp.focus(), 50);
}
function closePinModal() {
  document.getElementById("pinOverlay").classList.remove("open");
}
async function submitPin() {
  const inp = document.getElementById("pinInput");
  const pin = inp.value.trim();
  if (!pin) return;
  const err = document.getElementById("pinError");
  err.hidden = true;
  try {
    const body = await API.verifyPin(pin);
    if (body.ok) {
      sessionStorage.setItem(PIN_LS, JSON.stringify({ pin, ok: true }));
      closePinModal();
      applyPinState();
      render();
      toast("Mode edit diaktifkan");
    } else {
      err.textContent = body.error || "PIN salah.";
      err.hidden = false;
      inp.select();
    }
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
}
function lockEdit() {
  sessionStorage.setItem(PIN_LS, JSON.stringify({ ok: false }));
  applyPinState();
  render();
  toast("Mode edit dikunci");
}
function applyPinState() {
  const ok = isEditAllowed();
  document.querySelectorAll(".needs-pin").forEach(el => { el.hidden = !ok; });
  const btn = document.getElementById("pinBtn");
  btn.innerHTML = ok ? "&#128275; Edit aktif" : "&#128274; Edit terkunci";
  btn.title = ok ? "Kunci mode edit" : "Buka kunci edit (masukkan PIN)";
  btn.classList.toggle("locked", !ok);
}

/* ============== Render: filterbar ============== */
function buildPresetChips() {
  const wrap = document.getElementById("presetChips");
  wrap.innerHTML = "";
  for (const p of PRESETS) {
    const b = document.createElement("button");
    b.className = "chip" + (App.filters.preset === p.key ? " active" : "");
    b.textContent = p.label;
    b.onclick = () => { setPreset(p.key); };
    wrap.appendChild(b);
  }
}

function setPreset(key) {
  App.filters.preset = key;
  if (key === "all") { App.filters.from = null; App.filters.to = null; }
  document.getElementById("fromDate").value = "";
  document.getElementById("toDate").value = "";
  if (key === "month") { const t = todayMidnight(); App.cal.y = t.getFullYear(); App.cal.m = t.getMonth(); }
  render();
}

function setupRangeInputs() {
  const fromEl = document.getElementById("fromDate");
  const toEl = document.getElementById("toDate");
  const apply = () => {
    const from = fromEl.value ? parseDate(fromEl.value) : null;
    const to = toEl.value ? parseDate(toEl.value) : null;
    if (from || to) {
      App.filters.preset = "custom";
      App.filters.from = from; App.filters.to = to;
    } else {
      App.filters.preset = "all";
      App.filters.from = null; App.filters.to = null;
    }
    render();
  };
  fromEl.onchange = apply;
  toEl.onchange = apply;
}

/* Dropdown component */
function buildDropdown(id, label, options, onChange) {
  const el = document.getElementById(id);
  const key = id === "ddKategori" ? "kategori" : id === "ddStatus" ? "status" : "divisi";
  const st = App.filters[key];
  el.classList.add("dd");
  el.innerHTML = `
    <button class="dd-btn" type="button">
      <span class="dd-label">${esc(label)}</span>
      <span class="dd-count" hidden></span>
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <div class="dd-panel">
      <div class="dd-tools">
        <button data-act="all" type="button">Pilih semua</button>
        <button data-act="clear" type="button">Bersihkan</button>
      </div>
      <div class="dd-list"></div>
    </div>`;

  const btn = el.querySelector(".dd-btn");
  const panel = el.querySelector(".dd-panel");
  const labelEl = el.querySelector(".dd-label");
  const countEl = el.querySelector(".dd-count");
  const listEl = el.querySelector(".dd-list");

  btn.onclick = e => {
    e.stopPropagation();
    const open = el.classList.toggle("open");
    if (open) renderList();
  };
  el.querySelector('[data-act="all"]').onclick = e => { e.stopPropagation(); st.mode = "all"; st.subset.clear(); renderList(); sync(); };
  el.querySelector('[data-act="clear"]').onclick = e => {
    e.stopPropagation();
    if (options.length === 0) return;
    st.mode = "subset"; st.subset = new Set();
    renderList(); sync();
  };

  function renderList() {
    listEl.innerHTML = options.map(opt => {
      const checked = st.mode === "all" ? "checked" : (st.subset.has(opt.value) ? "checked" : "");
      const swatch = opt.color ? `<span class="swatch" style="background:${opt.color}"></span>` : "";
      return `<label class="dd-opt"><input type="checkbox" value="${esc(opt.value)}" ${checked}>${swatch}<span>${esc(opt.label)}</span></label>`;
    }).join("") || `<div style="padding:8px;color:var(--text-faint);font-size:13px">Tidak ada opsi</div>`;
    listEl.querySelectorAll("input").forEach(cb => {
      cb.onchange = () => {
        const val = cb.value;
        if (cb.checked) { st.mode = "subset"; st.subset.add(val); }
        else { st.subset.delete(val); if (st.subset.size === 0) st.mode = "all"; }
        if (st.subset.size === options.length) { st.mode = "all"; st.subset.clear(); }
        renderList(); sync();
      };
    });
  }

  function sync() {
    const n = st.subset.size;
    countEl.hidden = st.mode === "all";
    countEl.textContent = n;
    btn.classList.toggle("has-filter", st.mode !== "all");
    labelEl.textContent = st.mode === "all" ? `${label}: Semua` : `${label} (${n})`;
    onChange();
  }
  sync();
}

/* ============== Render: calendar ============== */
function renderCalendar() {
  const grid = document.getElementById("calGrid");
  const y = App.cal.y, m = App.cal.m;
  document.getElementById("calMonthLabel").textContent = new Date(y, m, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  const list = filteredEvents();
  const monthEvents = eventsInMonth(list, y, m);
  const now = todayMidnight();
  const first = new Date(y, m, 1);
  const offset = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells = [];

  const dayNames = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

  for (let d = 0; d < offset; d++) {
    const py = m === 0 ? y - 1 : y;
    const pm = m === 0 ? 11 : m - 1;
    const prevDays = new Date(py, pm + 1, 0).getDate();
    const dd = prevDays - offset + d + 1;
    cells.push({ date: new Date(py, pm, dd), other: true });
  }
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(y, m, d), other: false });
  const total = cells.length;
  const rem = 7 - (total % 7);
  if (rem < 7) for (let d = 1; d <= rem; d++) {
    const ny = m === 11 ? y + 1 : y;
    const nm = m === 11 ? 0 : m + 1;
    cells.push({ date: new Date(ny, nm, d), other: true });
  }

  const selDate = App.selDate;
  grid.innerHTML = dayNames.map(n => `<div class="cal-dayhead ${n === "Min" ? "weekend" : ""}">${n}</div>`).join("") +
    cells.map(c => {
      const evs = eventsOnDate(monthEvents, c.date);
      const isToday = isSameDay(c.date, now);
      const isSel = selDate && isSameDay(c.date, selDate);
      let evHtml = "";
      const MAX_SHOW = 3;
      if (evs.length) {
        const shown = evs.slice(0, MAX_SHOW);
        const more = evs.length - shown.length;
        evHtml = shown.map(ev => {
          const multi = ev.startTS !== ev.endTS;
          const first = isSameDay(ev.tglMulai, c.date);
          const cont = !first;
          const cls = cont ? "cont" : "";
          return `<div class="ev-chip ${cls}" style="background:${catColor(ev.kategori)}" data-id="${esc(ev.id)}" title="${esc(ev.nama)} · ${esc(ev.status)}">${cont ? "↳ " : ""}${esc(ev.nama)}${multi ? (first ? " →" : "") : ""}</div>`;
        }).join("");
        if (more > 0) evHtml += `<div class="ev-chip more" data-day="${iso(c.date)}">+${more} lainnya</div>`;
      }
      return `<div class="cal-cell ${c.other ? "other" : ""} ${isToday ? "today" : ""} ${isSel ? "selected" : ""}" data-day="${iso(c.date)}">
        <div class="cal-num">${c.date.getDate()}</div>
        <div class="cal-events">${evHtml || ""}</div>
      </div>`;
    }).join("");

  grid.querySelectorAll(".cal-cell").forEach(cell => {
    cell.onclick = () => { selectDay(cell.dataset.day); };
  });
  grid.querySelectorAll(".ev-chip[data-id]").forEach(chip => {
    chip.onclick = e => { e.stopPropagation(); openModal(chip.dataset.id); };
  });
  grid.querySelectorAll(".ev-chip.more").forEach(chip => {
    chip.onclick = e => { e.stopPropagation(); selectDay(chip.dataset.day); };
  });
}

function selectDay(isoStr) {
  const d = parseDate(isoStr);
  if (!d) return;
  if (App.selDate && isSameDay(App.selDate, d)) {
    App.selDate = null;
  } else {
    App.selDate = d;
  }
  renderDayPanel();
  renderCalendar();
}

function renderDayPanel() {
  const panel = document.getElementById("dayPanel");
  const title = document.getElementById("dayPanelTitle");
  const listEl = document.getElementById("dayList");
  const d = App.selDate;
  if (!d) { panel.hidden = true; return; }
  panel.hidden = false;
  title.innerHTML = `<span>&#128197;</span> Kegiatan ${fmtDateLong(d)} <button class="x" id="dayClose" title="Tutup">&#10005;</button>`;
  document.getElementById("dayClose").onclick = () => { App.selDate = null; renderDayPanel(); renderCalendar(); };

  const evs = eventsOnDate(filteredEvents(), d);
  listEl.innerHTML = "";
  if (!evs.length) {
    listEl.innerHTML = `<div style="color:var(--text-faint);font-size:13.5px">Tidak ada kegiatan pada tanggal ini.</div>`;
    return;
  }
  evs.sort((a, b) => (a.jamMulai || "").localeCompare(b.jamMulai || "") || a.startTS - b.startTS);
  for (const ev of evs) {
    const st = statusInfo(ev.status);
    const item = document.createElement("div");
    item.className = "dayitem";
    const timeStr = (ev.jamMulai || "") + (ev.jamSelesai ? " – " + ev.jamSelesai : "");
    item.innerHTML = `
      <div class="tbar" style="background:${catColor(ev.kategori)}"></div>
      <div class="di-main">
        <div class="di-name">${esc(ev.nama)}</div>
        <div class="di-sub">${esc(ev.kategori)} · ${esc(ev.lokasi)} · ${esc(ev.divisi)}${timeStr ? " · " + esc(timeStr) : ""}</div>
      </div>
      <div class="di-status">${esc(st.label)}</div>`;
    item.onclick = () => openModal(ev.id);
    listEl.appendChild(item);
  }
}

/* ============== Render: table ============== */
const TABLE_COLS = [
  { key: "nama", label: "Kegiatan" },
  { key: "startTS", label: "Tanggal" },
  { key: "jamMulai", label: "Jam" },
  { key: "kategori", label: "Kategori" },
  { key: "divisi", label: "Divisi" },
  { key: "lokasi", label: "Lokasi" },
  { key: "peserta", label: "Peserta" },
  { key: "status", label: "Status" }
];

function renderTable() {
  const list = filteredEvents();
  const key = App.sortKey, dir = App.sortDir;
  list.sort((a, b) => {
    let r = 0;
    const av = a[key], bv = b[key];
    if (key === "peserta") r = (av == null ? -1 : av) - (bv == null ? -1 : bv);
    else if (key === "jamMulai") r = (av || "").localeCompare(bv || "");
    else r = String(av).localeCompare(String(bv));
    return r * dir;
  });

  const thead = document.getElementById("thead");
  thead.innerHTML = "<tr>" + TABLE_COLS.map(c => {
    const active = c.key === key;
    return `<th data-key="${c.key}">${esc(c.label)}<span class="sort">${active ? (dir === 1 ? "▲" : "▼") : ""}</span></th>`;
  }).join("") + "</tr>";
  thead.querySelectorAll("th").forEach(th => {
    th.onclick = () => {
      const k = th.dataset.key;
      if (App.sortKey === k) App.sortDir *= -1;
      else { App.sortKey = k; App.sortDir = k === "startTS" ? 1 : -1; }
      render();
    };
  });

  const totalPages = Math.max(1, Math.ceil(list.length / App.pageSize));
  if (App.page > totalPages) App.page = totalPages;
  const start = (App.page - 1) * App.pageSize;
  const rows = list.slice(start, start + App.pageSize);

  const tbody = document.getElementById("tbody");
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${TABLE_COLS.length}" class="table-empty">Tidak ada kegiatan yang cocok dengan filter.</td></tr>`;
  } else {
    for (const ev of rows) {
      const st = statusInfo(ev.status);
      const dateStr = isSameDay(ev.tglMulai, ev.tglSelesai)
        ? fmtDate(ev.tglMulai)
        : `${fmtDate(ev.tglMulai)} – ${fmtDate(ev.tglSelesai)}`;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><div class="td-name">${esc(ev.nama)}</div><div class="td-sub">${esc(ev.pj)}</div></td>
        <td style="white-space:nowrap">${esc(dateStr)}</td>
        <td style="white-space:nowrap">${esc(ev.jamMulai || "—")}${ev.jamSelesai ? " – " + esc(ev.jamSelesai) : ""}</td>
        <td><span class="badge cat" style="background:${catColor(ev.kategori)}">${esc(ev.kategori)}</span></td>
        <td>${esc(ev.divisi)}</td>
        <td>${esc(ev.lokasi)}</td>
        <td>${ev.peserta == null ? "—" : ev.peserta.toLocaleString("id-ID")}</td>
        <td><span class="badge stat">${esc(st.label)}</span></td>`;
      tr.onclick = () => openModal(ev.id);
      tbody.appendChild(tr);
    }
  }

  renderPagination(list.length, totalPages);
}

function renderPagination(total, totalPages) {
  const wrap = document.getElementById("pagination");
  const start = (App.page - 1) * App.pageSize + 1;
  const end = Math.min(App.page * App.pageSize, total);
  wrap.innerHTML = `
    <span class="pinfo">Menampilkan ${total ? start : 0}–${end} dari ${total} kegiatan</span>
    <div class="select2">Baris <select id="pageSizeSel">
      <option value="10">10</option><option value="20">20</option><option value="50">50</option><option value="100">100</option>
    </select></div>
    <button id="pgPrev" ${App.page <= 1 ? "disabled" : ""}>‹ Sebelumnya</button>
    <button id="pgNext" ${App.page >= totalPages ? "disabled" : ""}>Berikutnya ›</button>`;
  wrap.querySelector("#pageSizeSel").value = String(App.pageSize);
  wrap.querySelector("#pageSizeSel").onchange = e => { App.pageSize = +e.target.value; App.page = 1; renderTable(); };
  wrap.querySelector("#pgPrev").onclick = () => { if (App.page > 1) { App.page--; renderTable(); } };
  wrap.querySelector("#pgNext").onclick = () => { if (App.page < totalPages) { App.page++; renderTable(); } };
}

/* ============== Modal ============== */
let modalEventId = null;
let loadTimer = null;
let modalImgUrl = null;
async function openModal(id) {
  const ev = App.events.find(e => e.id === id);
  if (!ev) return;
  modalEventId = ev.id;
  const st = statusInfo(ev.status);

  document.getElementById("mTitle").textContent = ev.nama;
  document.getElementById("mBadges").innerHTML = `
    <span class="badge cat" style="background:${catColor(ev.kategori)}">${esc(ev.kategori)}</span>
    <span class="badge stat">${esc(st.label)}</span>`;

  const dateStr = isSameDay(ev.tglMulai, ev.tglSelesai)
    ? fmtDateLong(ev.tglMulai)
    : `${fmtDateLong(ev.tglMulai)} &ndash; ${fmtDateLong(ev.tglSelesai)}`;
  const timeStr = (ev.jamMulai || "") + (ev.jamSelesai ? " &ndash; " + ev.jamSelesai : "");

  const items = [
    ["Tanggal", `<span class="m-time">${esc(dateStr)}</span>`, false],
    ["Jam", esc(timeStr || "&mdash;"), false],
    ["Jenis Kegiatan", esc(ev.jenis), false],
    ["Lokasi", esc(ev.lokasi), false],
    ["Divisi Penyelenggara", esc(ev.divisi), false],
    ["Penanggung Jawab", esc(ev.pj), false],
    ["Sasaran", esc(ev.sasaran), false],
    ["Perkiraan Peserta", ev.peserta == null ? "&mdash;" : ev.peserta.toLocaleString("id-ID") + " orang", false],
    ["ID Event", esc(ev.id), false],
    ["Keterangan", esc(ev.keterangan || "&mdash;"), true]
  ];
  document.getElementById("mBody").innerHTML = items.map(([label, val, full]) =>
    `<div class="m-item ${full ? "full" : ""}"><div class="mi-label">${esc(label)}</div><div class="mi-value">${val}</div></div>`
  ).join("");

  const catLegend = Object.keys(CAT_COLORS).map(k =>
    `<span><span class="swatch" style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${CAT_COLORS[k]}"></span>${esc(k)}</span>`
  ).join("");
  document.getElementById("mLegend").innerHTML = catLegend;

  document.getElementById("overlay").classList.add("open");
  const wrap = document.getElementById("mImgWrap");
  const img = document.getElementById("mImg");
  const loadEl = document.getElementById("mImgLoad");
  wrap.hidden = true;
  img.onload = null;
  img.onerror = null;
  if (modalImgUrl) { URL.revokeObjectURL(modalImgUrl); modalImgUrl = null; }
  img.removeAttribute("src");
  try {
    const blob = await ImageAPI.get(ev.id);
    if (blob) {
      loadEl.hidden = false;
      clearTimeout(loadTimer);
      loadTimer = setTimeout(() => { loadEl.hidden = true; }, 4000);
      img.onload = () => { loadEl.hidden = true; clearTimeout(loadTimer); };
      img.onerror = () => { loadEl.hidden = true; clearTimeout(loadTimer); };
      modalImgUrl = URL.createObjectURL(blob);
      img.src = modalImgUrl;
      wrap.hidden = false;
    } else {
      wrap.hidden = true;
    }
  } catch (e) {
    wrap.hidden = true;
  } finally {
    loadEl.hidden = true;
    clearTimeout(loadTimer);
  }
}

function closeModal() {
  document.getElementById("overlay").classList.remove("open");
  modalEventId = null;
  if (modalImgUrl) { URL.revokeObjectURL(modalImgUrl); modalImgUrl = null; }
  const img = document.getElementById("mImg");
  if (img.src && img.src.startsWith("blob:")) img.removeAttribute("src");
  closeLightbox();
}

function openLightbox(src) {
  const lb = document.getElementById("lightbox");
  const lbImg = document.getElementById("lightboxImg");
  lbImg.src = src;
  lb.classList.add("open");
}
function closeLightbox() {
  const lb = document.getElementById("lightbox");
  lb.classList.remove("open");
  const lbImg = document.getElementById("lightboxImg");
  if (lbImg.src) lbImg.removeAttribute("src");
}

/* ============== Kelola (CRUD) ============== */
function collectOptions() {
  return {
    cats: [...new Set(App.events.map(e => e.kategori))].sort(),
    stats: [...new Set(App.events.map(e => e.status))].sort(),
    divs: [...new Set(App.events.map(e => e.divisi))].filter(d => d !== "—").sort()
  };
}
function rebuildDropdowns() {
  const { cats, stats, divs } = collectOptions();
  buildDropdown("ddKategori", "Kategori", cats.map(c => ({ value: c, label: c, color: catColor(c) })), render);
  buildDropdown("ddStatus", "Status", stats.map(s => ({ value: s, label: s })), render);
  buildDropdown("ddDivisi", "Divisi", divs.map(d => ({ value: d, label: d })), render);
}

function renderManage() {
  cleanupThumbUrls();
  const q = App.manageSearch.toLowerCase();
  const list = App.events.filter(ev =>
    !q || (ev.nama + " " + ev.pj + " " + ev.lokasi + " " + ev.kategori + " " + ev.status + " " + ev.divisi).toLowerCase().includes(q)
  );
  list.sort((a, b) => a.startTS - b.startTS);

  const syncStr = App.lastSync ? " &middot; sinkron " + new Date(App.lastSync).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "";
  document.getElementById("manageInfo").innerHTML =
    `${list.length} dari ${App.events.length} kegiatan${App.manageSearch ? " (hasil cari)" : ""}<br><span style="font-size:11px">server: online${syncStr}</span>`;

  const editAllowed = isEditAllowed();
  const colCount = editAllowed ? 7 : 6;
  document.getElementById("mthead").innerHTML = "<tr>" +
    ["Promo", "Kegiatan", "Tanggal", "Kategori", "Divisi", "Status", ...(editAllowed ? ["Aksi"] : [])].map(h => `<th>${h}</th>`).join("") +
    "</tr>";

  const totalPages = Math.max(1, Math.ceil(list.length / App.pageSize));
  if (App.managePage > totalPages) App.managePage = totalPages;
  const start = (App.managePage - 1) * App.pageSize;
  const rows = list.slice(start, start + App.pageSize);

  const tbody = document.getElementById("mtbody");
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" class="table-empty">Tidak ada kegiatan. Klik "Tambah Kegiatan" untuk membuat data baru.</td></tr>`;
  } else {
    for (const ev of rows) {
      const st = statusInfo(ev.status);
      const dateStr = isSameDay(ev.tglMulai, ev.tglSelesai) ? fmtDate(ev.tglMulai) : `${fmtDate(ev.tglMulai)} &ndash; ${fmtDate(ev.tglSelesai)}`;
      const aksi = editAllowed
        ? `<td class="aksi-cell">
             <button class="aksi-btn edit needs-pin" data-edit="${esc(ev.id)}">Edit</button>
             <button class="aksi-btn del needs-pin" data-del="${esc(ev.id)}">Hapus</button>
           </td>`
        : "";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="promo-cell" data-promo="${esc(ev.id)}">&#8230;</td>
        <td><div class="td-name">${esc(ev.nama)}</div><div class="td-sub">${esc(ev.pj)}</div></td>
        <td style="white-space:nowrap">${esc(dateStr)}${ev.jamMulai ? " &middot; " + esc(ev.jamMulai) : ""}</td>
        <td><span class="badge cat" style="background:${catColor(ev.kategori)}">${esc(ev.kategori)}</span></td>
        <td>${esc(ev.divisi)}</td>
        <td><span class="badge stat">${esc(st.label)}</span></td>
        ${aksi}`;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => openForm(b.dataset.edit));
    tbody.querySelectorAll("[data-del]").forEach(b => b.onclick = () => deleteEvent(b.dataset.del));
    fillPromoThumbs(rows);
  }
  renderManagePagination(list.length, totalPages);
}

async function fillPromoThumbs(list) {
  for (const ev of list) {
    const cell = document.querySelector(`td.promo-cell[data-promo="${esc(ev.id)}"]`);
    if (!cell) continue;
    try {
      const blob = await ImageAPI.get(ev.id);
      if (blob) {
        const img = document.createElement("img");
        img.className = "promo-thumb";
        img.alt = "Promo";
        const u = URL.createObjectURL(blob);
        img.src = u;
        thumbUrls.add(u);
        cell.textContent = "";
        cell.appendChild(img);
      } else {
        cell.textContent = "&mdash;";
      }
    } catch (e) {
      cell.textContent = "&mdash;";
    }
  }
}

function renderManagePagination(total, totalPages) {
  const wrap = document.getElementById("mpagination");
  const start = (App.managePage - 1) * App.pageSize + 1;
  const end = Math.min(App.managePage * App.pageSize, total);
  wrap.innerHTML = `
    <span class="pinfo">Menampilkan ${total ? start : 0}–${end} dari ${total} kegiatan</span>
    <button id="mpPrev" ${App.managePage <= 1 ? "disabled" : ""}>‹ Sebelumnya</button>
    <button id="mpNext" ${App.managePage >= totalPages ? "disabled" : ""}>Berikutnya ›</button>`;
  wrap.querySelector("#mpPrev").onclick = () => { if (App.managePage > 1) { App.managePage--; renderManage(); } };
  wrap.querySelector("#mpNext").onclick = () => { if (App.managePage < totalPages) { App.managePage++; renderManage(); } };
}

/* Form CRUD */
function setFormError(msg) {
  const el = document.getElementById("formError");
  el.textContent = msg || "";
  el.classList.toggle("show", !!msg);
}
function refreshDivisiList() {
  const dl = document.getElementById("divisiList");
  const vals = [...new Set(App.events.map(e => e.divisi))].filter(d => d && d !== "—");
  dl.innerHTML = vals.map(v => `<option value="${esc(v)}"></option>`).join("");
}
function populateForm(ev) {
  setFormError("");
  const def = ev || {};
  const todayIso = iso(todayMidnight());
  const katSel = document.getElementById("f-kategori");
  const defKat = def.kategori || (katSel.options.length ? katSel.options[0].value : "");
  const vals = {
    nama: def.nama || "",
    kategori: defKat,
    status: def.status || "Rencana",
    jenis: def.jenis || "",
    tglMulai: def.tglMulai ? iso(def.tglMulai) : todayIso,
    jamMulai: def.jamMulai || "",
    tglSelesai: def.tglSelesai ? iso(def.tglSelesai) : todayIso,
    jamSelesai: def.jamSelesai || "",
    lokasi: def.lokasi || "",
    divisi: def.divisi || "",
    pj: def.pj || "",
    sasaran: def.sasaran || "",
    peserta: def.peserta == null ? "" : def.peserta,
    keterangan: def.keterangan || ""
  };
  for (const [k, v] of Object.entries(vals)) {
    const el = document.getElementById("eventForm").elements[k];
    if (el) el.value = v;
  }
}
function buildEventFromForm() {
  const fd = new FormData(document.getElementById("eventForm"));
  const get = k => (fd.get(k) || "").trim();
  const tglMulai = parseDate(get("tglMulai"));
  const tglSelesai = parseDate(get("tglSelesai")) || tglMulai;
  const peserta = parseInt(get("peserta"), 10);
  return {
    nama: get("nama"),
    kategori: get("kategori") || "Lainnya",
    jenis: get("jenis") || "—",
    tglMulai, jamMulai: get("jamMulai"),
    tglSelesai, jamSelesai: get("jamSelesai"),
    lokasi: get("lokasi") || "—",
    divisi: get("divisi") || "—",
    pj: get("pj") || "—",
    sasaran: get("sasaran") || "—",
    peserta: isNaN(peserta) ? null : peserta,
    status: get("status") || "Rencana",
    keterangan: get("keterangan") || ""
  };
}
function validateEvent(ev) {
  if (!ev.tglMulai) return "Tanggal Mulai wajib diisi.";
  if (!ev.nama.trim()) return "Nama Event wajib diisi.";
  if (!ev.kategori) return "Kategori wajib dipilih.";
  if (!ev.status) return "Status wajib dipilih.";
  if (ev.tglSelesai < ev.tglMulai) return "Tanggal Selesai tidak boleh sebelum Tanggal Mulai.";
  if (ev.jamMulai && !/^\d{2}:\d{2}$/.test(ev.jamMulai)) return "Format Jam Mulai harus HH:MM.";
  if (ev.jamSelesai && !/^\d{2}:\d{2}$/.test(ev.jamSelesai)) return "Format Jam Selesai harus HH:MM.";
  return null;
}

let editingId = null;
async function openForm(id) {
  const targetId = id || null;
  editingId = targetId;
  const ev = editingId ? App.events.find(e => e.id === editingId) : null;
  refreshDivisiList();
  document.getElementById("fTitle").textContent = ev ? "Edit Kegiatan" : "Tambah Kegiatan";
  document.getElementById("fSubmit").textContent = ev ? "Simpan Perubahan" : "Tambah";
  resetPromoState();
  if (targetId) {
    const blob = await ImageAPI.get(targetId);
    if (blob) {
      existingImageUrl = URL.createObjectURL(blob);
      formHasImage = true;
    }
  }
  populateForm(ev);
  renderPromoField();
  document.getElementById("formOverlay").classList.add("open");
}
function closeForm() {
  document.getElementById("formOverlay").classList.remove("open");
  editingId = null;
  resetPromoState();
}

async function saveEventFromForm() {
  const wasEdit = !!editingId;
  const ev = buildEventFromForm();
  const err = validateEvent(ev);
  if (err) { setFormError(err); return; }
  let savedId = editingId;
  try {
    if (editingId) {
      await API.update(editingId, evToPayload(ev));
    } else {
      const created = await API.create(evToPayload(ev));
      savedId = created.id;
    }
  } catch (e) {
    setFormError(e.message);
    return;
  }
  if (pendingPromo) {
    ImageAPI.put(savedId, pendingPromo.blob).catch(() => toast("Gambar gagal disimpan"));
  } else if (removePromo) {
    ImageAPI.del(savedId).catch(() => {});
  }
  closeForm();
  App.page = 1; App.managePage = 1;
  await loadEvents({ silent: true });
  if (App.view === "calendar" && ev.tglMulai) { App.cal.y = ev.tglMulai.getFullYear(); App.cal.m = ev.tglMulai.getMonth(); App.selDate = null; }
  toast(wasEdit ? "Perubahan disimpan" : "Kegiatan ditambahkan");
}

async function deleteEvent(id) {
  const ev = App.events.find(e => e.id === id);
  if (!ev) return;
  if (!confirm(`Hapus kegiatan "${ev.nama}"?`)) return;
  try {
    await API.del(id);
  } catch (e) {
    toast(e.message);
    return;
  }
  App.managePage = 1;
  await loadEvents({ silent: true });
  toast("Kegiatan dihapus");
}

async function importFromFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const rows = parseCSV(String(reader.result));
      if (rows.length < 2) throw new Error("File CSV tidak berisi data baris.");
      const events = normalizeRows(rows);
      if (!events.length) throw new Error("Tidak ada baris valid (butuh kolom Tanggal Mulai).");
      const payload = events.map(evToPayload);
      const res = await API.bulk(payload);
      App.filters.preset = "all";
      App.filters.from = null; App.filters.to = null;
      App.filters.kategori = { mode: "all", subset: new Set() };
      App.filters.status = { mode: "all", subset: new Set() };
      App.filters.divisi = { mode: "all", subset: new Set() };
      App.filters.search = "";
      document.getElementById("searchBox").value = "";
      document.getElementById("fromDate").value = "";
      document.getElementById("toDate").value = "";
      App.page = 1; App.managePage = 1; App.manageSearch = "";
      await loadEvents({ silent: true });
      toast(res.count + " kegiatan diimpor");
    } catch (err) {
      alert("Gagal mengimpor data: " + err.message);
    }
  };
  reader.readAsText(file);
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ============== Promo (Gambar Kegiatan) ============== */
function downscaleImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 1600;
      let w = img.width, h = img.height;
      const scale = Math.min(1, MAX / Math.max(w, h));
      if (scale < 1) { w = Math.round(w * scale); h = Math.round(h * scale); }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      const isPng = /png/i.test(file.type);
      canvas.toBlob(b => {
        URL.revokeObjectURL(url);
        if (b) resolve(b);
        else reject(new Error("Gagal mengompresi gambar."));
      }, isPng ? "image/png" : "image/jpeg", isPng ? undefined : 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("File tidak bisa dibaca sebagai gambar.")); };
    img.src = url;
  });
}

let pendingPromo = null, existingImageUrl = null, formHasImage = false, removePromo = false;
const thumbUrls = new Set();
function cleanupThumbUrls() { thumbUrls.forEach(u => URL.revokeObjectURL(u)); thumbUrls.clear(); }

function setPendingPromo(blob) {
  if (pendingPromo && pendingPromo.url) URL.revokeObjectURL(pendingPromo.url);
  pendingPromo = { blob, url: URL.createObjectURL(blob) };
  removePromo = false;
  renderPromoField();
}

function renderPromoField() {
  const preview = document.getElementById("f-promoPreview");
  const img = preview.querySelector("img");
  const clearBtn = document.getElementById("f-promoClear");
  const hint = document.getElementById("f-promoHint");
  if (removePromo) {
    preview.hidden = true;
    img.removeAttribute("src");
    clearBtn.hidden = true;
    hint.textContent = "Gambar akan dihapus saat disimpan.";
  } else if (pendingPromo) {
    preview.hidden = false;
    img.src = pendingPromo.url;
    clearBtn.hidden = false;
    hint.textContent = "Gambar baru akan disimpan saat Anda menekan Simpan.";
  } else if (formHasImage) {
    preview.hidden = false;
    img.src = existingImageUrl || "";
    clearBtn.hidden = false;
    hint.textContent = "Gambar aktif. Klik Hapus Gambar untuk membuangnya.";
  } else {
    preview.hidden = true;
    img.removeAttribute("src");
    clearBtn.hidden = true;
    hint.textContent = "Maksimum 2MB &middot; otomatis diperkecil ke &le;1600px";
  }
}

function resetPromoState() {
  if (pendingPromo && pendingPromo.url) URL.revokeObjectURL(pendingPromo.url);
  if (existingImageUrl) URL.revokeObjectURL(existingImageUrl);
  pendingPromo = null;
  existingImageUrl = null;
  formHasImage = false;
  removePromo = false;
  renderPromoField();
}

/* ============== Main render ============== */
function render() {
  const list = filteredEvents();
  const activeCount = App.events.filter(e => e.status === "Berlangsung").length;
  document.getElementById("countLabel").textContent = App.ready
    ? `Menampilkan ${list.length} dari ${App.events.length} kegiatan` +
      (activeCount ? ` · ${activeCount} sedang berlangsung` : "")
    : "Memuat data…";

  const range = timeFilter();
  const banner = document.getElementById("infoBanner");
  if (range) {
    const s = document.getElementById("fromDate").value || iso(range[0]);
    const e = document.getElementById("toDate").value || iso(range[1]);
    banner.hidden = false;
    document.getElementById("infoBannerText").textContent =
      `Periode aktif: ${fmtDate(parseDate(s))} s/d ${fmtDate(parseDate(e))}`;
  } else {
    banner.hidden = true;
  }

  const calEl = document.getElementById("calView");
  const tabEl = document.getElementById("tableView");
  const manEl = document.getElementById("manageView");
  calEl.hidden = App.view !== "calendar";
  tabEl.hidden = App.view !== "table";
  manEl.hidden = App.view !== "manage";
  document.getElementById("viewCal").classList.toggle("active", App.view === "calendar");
  document.getElementById("viewTable").classList.toggle("active", App.view === "table");
  document.getElementById("viewManage").classList.toggle("active", App.view === "manage");

  if (App.view === "calendar") {
    renderCalendar();
    renderDayPanel();
  } else if (App.view === "table") {
    renderTable();
  } else {
    renderManage();
  }
  buildPresetChips();
  applyPinState();
}

/* ============== Export ============== */
const CSV_HEADER = ["ID","Nama Event","Kategori","Jenis Kegiatan","Tanggal Mulai","Jam Mulai","Tanggal Selesai","Jam Selesai","Lokasi","Divisi Penyelenggara","Penanggung Jawab","Sasaran","Perkiraan Peserta","Status","Keterangan"];
function evToRow(ev) {
  return [
    ev.id, ev.nama, ev.kategori, ev.jenis,
    iso(ev.tglMulai), ev.jamMulai, iso(ev.tglSelesai), ev.jamSelesai,
    ev.lokasi, ev.divisi, ev.pj, ev.sasaran,
    ev.peserta == null ? "" : ev.peserta, ev.status, ev.keterangan
  ];
}
function downloadCSV(list, label) {
  if (!list.length) return;
  const csv = toCSV([CSV_HEADER, ...list.map(evToRow)]);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${label}-${iso(new Date())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportFiltered() { downloadCSV(filteredEvents(), "kegiatan-terfilter"); }
function exportAll() { downloadCSV(App.events, "kegiatan-gereja"); }

/* ============== Theme ============== */
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("kegiatanGerejaTheme", next);
  document.getElementById("themeBtn").textContent = next === "dark" ? "☀" : "🌙";
}

/* ============== Init ============== */
function init() {
  const savedTheme = localStorage.getItem("kegiatanGerejaTheme");
  if (savedTheme) {
    document.documentElement.setAttribute("data-theme", savedTheme);
    document.getElementById("themeBtn").textContent = savedTheme === "dark" ? "☀" : "🌙";
  }

  buildPresetChips();
  setupRangeInputs();
  rebuildDropdowns();

  const katSet = new Set([...Object.keys(CAT_COLORS), ...App.events.map(e => e.kategori), "Lainnya"]);
  document.getElementById("f-kategori").innerHTML = [...katSet].sort().map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join("");
  document.getElementById("f-status").innerHTML = Object.keys(STATUS_META).map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");

  const searchEl = document.getElementById("searchBox");
  let debounce;
  searchEl.oninput = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { App.filters.search = searchEl.value.trim(); render(); }, 200);
  };

  document.getElementById("resetBtn").onclick = () => {
    App.filters = {
      preset: "all", from: null, to: null,
      kategori: { mode: "all", subset: new Set() },
      status: { mode: "all", subset: new Set() },
      divisi: { mode: "all", subset: new Set() },
      search: ""
    };
    searchEl.value = "";
    document.getElementById("fromDate").value = "";
    document.getElementById("toDate").value = "";
    App.page = 1;
    buildPresetChips();
    rebuildDropdowns();
    render();
  };

  document.getElementById("viewCal").onclick = () => { App.view = "calendar"; render(); };
  document.getElementById("viewTable").onclick = () => { App.view = "table"; render(); };
  document.getElementById("viewManage").onclick = () => { App.view = "manage"; render(); };

  document.getElementById("addBtn").onclick = () => openForm(null);
  document.getElementById("importBtn2").onclick = () => document.getElementById("fileInput").click();
  document.getElementById("exportAllBtn").onclick = exportAll;
  document.getElementById("refreshBtn").onclick = () => {
    loadEvents({ silent: true }).then(() => toast("Data disegarkan")).catch(() => {});
  };

  const manageSearchEl = document.getElementById("manageSearch");
  let mDebounce;
  manageSearchEl.oninput = () => {
    clearTimeout(mDebounce);
    mDebounce = setTimeout(() => { App.manageSearch = manageSearchEl.value.trim(); App.managePage = 1; renderManage(); }, 200);
  };

  document.getElementById("calPrev").onclick = () => { App.cal.m--; if (App.cal.m < 0) { App.cal.m = 11; App.cal.y--; } render(); };
  document.getElementById("calNext").onclick = () => { App.cal.m++; if (App.cal.m > 11) { App.cal.m = 0; App.cal.y++; } render(); };
  document.getElementById("calToday").onclick = () => { const t = todayMidnight(); App.cal.y = t.getFullYear(); App.cal.m = t.getMonth(); App.selDate = null; render(); };

  document.getElementById("themeBtn").onclick = toggleTheme;
  document.getElementById("exportBtn").onclick = exportFiltered;
  document.getElementById("mClose").onclick = closeModal;
  document.getElementById("mEdit").onclick = () => {
    if (modalEventId != null) { closeModal(); openForm(modalEventId); }
  };
  document.getElementById("overlay").onclick = e => { if (e.target === e.currentTarget) closeModal(); };
  document.getElementById("fClose").onclick = closeForm;
  document.getElementById("fCancel").onclick = closeForm;
  document.getElementById("formOverlay").onclick = e => { if (e.target === e.currentTarget) closeForm(); };
  document.getElementById("eventForm").addEventListener("submit", e => { e.preventDefault(); saveEventFromForm(); });

  const pinBtn = document.getElementById("pinBtn");
  pinBtn.onclick = () => { if (isEditAllowed()) lockEdit(); else openPinModal(); };
  document.getElementById("pinClose").onclick = closePinModal;
  document.getElementById("pinSkip").onclick = () => {
    sessionStorage.setItem(PIN_LS, JSON.stringify({ ok: false }));
    closePinModal();
    applyPinState();
  };
  document.getElementById("pinSubmit").onclick = submitPin;
  document.getElementById("pinOverlay").onclick = e => { if (e.target === e.currentTarget) closePinModal(); };
  document.getElementById("pinInput").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); submitPin(); }
  });

  const fTglMulai = document.getElementById("f-tglMulai");
  const fTglSelesai = document.getElementById("f-tglSelesai");
  fTglMulai.addEventListener("change", () => {
    if (fTglMulai.value && (!fTglSelesai.value || fTglSelesai.value < fTglMulai.value)) {
      fTglSelesai.value = fTglMulai.value;
    }
  });

  const fPromoPick = document.getElementById("f-promoPick");
  const fPromoFile = document.getElementById("f-promoFile");
  const fPromoClear = document.getElementById("f-promoClear");
  fPromoPick.onclick = () => fPromoFile.click();
  fPromoClear.onclick = () => { removePromo = true; pendingPromo = null; renderPromoField(); };
  fPromoFile.addEventListener("change", async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { toast("Gambar maksimal 2MB"); return; }
    if (!/^image\//.test(f.type)) { toast("File harus berupa gambar"); return; }
    try {
      const blob = await downscaleImage(f);
      setPendingPromo(blob);
    } catch (err) {
      toast(err.message);
    }
  });

  const fileInput = document.getElementById("fileInput");
  fileInput.addEventListener("change", e => {
    const f = e.target.files && e.target.files[0];
    if (f) importFromFile(f);
    fileInput.value = "";
  });

  document.getElementById("mImg").addEventListener("click", () => {
    const src = document.getElementById("mImg").src;
    if (src) openLightbox(src);
  });
  document.getElementById("lbClose").onclick = closeLightbox;
  document.getElementById("lightbox").onclick = e => { if (e.target === e.currentTarget) closeLightbox(); };

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      if (document.getElementById("lightbox").classList.contains("open")) closeLightbox();
      else if (document.getElementById("pinOverlay").classList.contains("open")) closePinModal();
      else { closeModal(); closeForm(); }
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pollEvents();
  });

  document.getElementById("dash").hidden = false;
  loadEvents().catch(() => {});
  applyPinState();

  if (sessionStorage.getItem(PIN_LS) == null) openPinModal();

  setInterval(pollEvents, 30000);
}

init();