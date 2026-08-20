"use strict";

/* Pencegahan duplikat kegiatan: kunci = nama + tanggal + jam mulai + lokasi (ternormalisasi).
   "Detail lebih lengkap menang": kolom kosong/placeholder pada data existing diisi dari data baru;
   nilai existing yang sudah terisi tidak ditimpa. */

const PLACEHOLDER = new Set(["", "—"]);

function normKey(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim();
}

async function findDuplicate(client, d) {
  const { rows } = await client.query(
    `SELECT id, nama, kategori, jenis, tgl_mulai::text AS tgl_mulai, jam_mulai,
            tgl_selesai::text AS tgl_selesai, jam_selesai, lokasi, divisi, pj,
            sasaran, peserta, status, keterangan
     FROM events
     WHERE lower(regexp_replace(nama, '\\s+', ' ', 'g')) = lower(regexp_replace($1, '\\s+', ' ', 'g'))
       AND tgl_mulai = $2
       AND (COALESCE(jam_mulai, '') = COALESCE($3, '') OR COALESCE(jam_mulai, '') = '' OR COALESCE($3, '') = '')
       AND (lower(regexp_replace(lokasi, '\\s+', ' ', 'g')) = lower(regexp_replace($4, '\\s+', ' ', 'g'))
            OR COALESCE(lokasi, '') IN ('', '—') OR COALESCE($4, '') IN ('', '—'))
     LIMIT 1`,
    [d.nama, d.tgl_mulai, d.jam_mulai || "", d.lokasi]
  );
  return rows[0] || null;
}

async function findDuplicateExcept(client, d, exceptId) {
  const { rows } = await client.query(
    `SELECT id, nama, kategori, jenis, tgl_mulai::text AS tgl_mulai, jam_mulai,
            tgl_selesai::text AS tgl_selesai, jam_selesai, lokasi, divisi, pj,
            sasaran, peserta, status, keterangan
     FROM events
     WHERE lower(regexp_replace(nama, '\\s+', ' ', 'g')) = lower(regexp_replace($1, '\\s+', ' ', 'g'))
       AND tgl_mulai = $2
       AND (COALESCE(jam_mulai, '') = COALESCE($3, '') OR COALESCE(jam_mulai, '') = '' OR COALESCE($3, '') = '')
       AND (lower(regexp_replace(lokasi, '\\s+', ' ', 'g')) = lower(regexp_replace($4, '\\s+', ' ', 'g'))
            OR COALESCE(lokasi, '') IN ('', '—') OR COALESCE($4, '') IN ('', '—'))
       AND id <> $5
     LIMIT 1`,
    [d.nama, d.tgl_mulai, d.jam_mulai || "", d.lokasi, exceptId]
  );
  return rows[0] || null;
}

/* Gabungkan data baru (d, gaya toDB) ke baris existing (row, gaya SELECT). */
function mergeFields(row, d) {
  const out = { nama: row.nama, tgl_mulai: row.tgl_mulai };
  const take = (col, val) => {
    const cur = row[col];
    const curS = cur == null ? "" : cur;
    if (PLACEHOLDER.has(curS) || (col === "kategori" && curS === "Lainnya")) {
      out[col] = val;
    } else {
      out[col] = cur;
    }
  };
  take("kategori", d.kategori || "Lainnya");
  take("jenis", d.jenis || "—");
  take("jam_mulai", d.jam_mulai || "");
  take("tgl_selesai", d.tgl_selesai || null);
  take("jam_selesai", d.jam_selesai || "");
  take("lokasi", d.lokasi || "—");
  take("divisi", d.divisi || "—");
  take("pj", d.pj || "—");
  take("sasaran", d.sasaran || "—");
  out.peserta = (row.peserta == null && d.peserta != null) ? d.peserta : row.peserta;
  take("status", d.status || "Rencana");
  take("keterangan", d.keterangan || "");
  return out;
}

function hasChange(row, merged) {
  for (const k of Object.keys(merged)) {
    const a = row[k] == null ? "" : row[k];
    const b = merged[k] == null ? "" : merged[k];
    if (String(a) !== String(b)) return true;
  }
  return false;
}

module.exports = { normKey, findDuplicate, findDuplicateExcept, mergeFields, hasChange };