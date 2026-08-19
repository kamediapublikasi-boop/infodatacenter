"use strict";

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

const COLS = {
  id: 0, nama: 1, kategori: 2, jenis: 3,
  tglMulai: 4, jamMulai: 5, tglSelesai: 6, jamSelesai: 7,
  lokasi: 8, divisi: 9, pj: 10, sasaran: 11, peserta: 12, status: 13, keterangan: 14
};

function csvToPayloads(text) {
  const rows = parseCSV(text);
  const header = rows[0] || [];
  const idx = {};
  for (const [key, pos] of Object.entries(COLS)) {
    idx[key] = header[pos] !== undefined && header[pos].trim() !== "" ? pos : -1;
  }
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const get = k => (idx[k] >= 0 ? (row[idx[k]] || "").trim() : "");
    const tglMulai = get("tglMulai");
    if (!tglMulai) continue;
    const peserta = parseInt(get("peserta"), 10);
    out.push({
      nama: get("nama") || "Tanpa Nama",
      kategori: get("kategori") || "Lainnya",
      jenis: get("jenis") || "—",
      tglMulai,
      jamMulai: get("jamMulai"),
      tglSelesai: get("tglSelesai") || tglMulai,
      jamSelesai: get("jamSelesai"),
      lokasi: get("lokasi") || "—",
      divisi: get("divisi") || "—",
      pj: get("pj") || "—",
      sasaran: get("sasaran") || "—",
      peserta: isNaN(peserta) ? null : peserta,
      status: get("status") || "Rencana",
      keterangan: get("keterangan") || ""
    });
  }
  return out;
}

module.exports = { parseCSV, csvToPayloads };