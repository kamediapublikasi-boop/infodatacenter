"use strict";

require("dotenv").config();

const path = require("path");
const express = require("express");
const db = require("./db");
const { checkPin, verifyPin } = require("./pin");
const dedup = require("./dedup");

const app = express();
app.disable("x-powered-by");

app.use(express.static(path.join(__dirname, "..", "public"), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  }
}));
app.use(express.json({ limit: "1mb" }));

/* ============== Mapping ============== */

function toDB(payload) {
  return {
    nama: payload.nama || "Tanpa Nama",
    kategori: payload.kategori || "Lainnya",
    jenis: payload.jenis || "—",
    tgl_mulai: payload.tglMulai || null,
    jam_mulai: payload.jamMulai || "",
    tgl_selesai: payload.tglSelesai || null,
    jam_selesai: payload.jamSelesai || "",
    lokasi: payload.lokasi || "—",
    divisi: payload.divisi || "—",
    pj: payload.pj || "—",
    sasaran: payload.sasaran || "—",
    peserta: payload.peserta == null || payload.peserta === "" ? null : payload.peserta,
    status: payload.status || "Rencana",
    keterangan: payload.keterangan || ""
  };
}

function toJSON(r) {
  return {
    id: r.id,
    nama: r.nama,
    kategori: r.kategori,
    jenis: r.jenis,
    tglMulai: r.tgl_mulai,
    jamMulai: r.jam_mulai,
    tglSelesai: r.tgl_selesai,
    jamSelesai: r.jam_selesai,
    lokasi: r.lokasi,
    divisi: r.divisi,
    pj: r.pj,
    sasaran: r.sasaran,
    peserta: r.peserta,
    status: r.status,
    keterangan: r.keterangan,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

const SELECT = `SELECT id, nama, kategori, jenis, tgl_mulai::text AS tgl_mulai, jam_mulai,
                       tgl_selesai::text AS tgl_selesai, jam_selesai, lokasi, divisi, pj,
                       sasaran, peserta, status, keterangan, created_at, updated_at
                FROM events`;

const INSERT_COLS = `(nama,kategori,jenis,tgl_mulai,jam_mulai,tgl_selesai,jam_selesai,lokasi,divisi,pj,sasaran,peserta,status,keterangan)`;
const INSERT_VALS = `($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`;
const UPDATE_SQL = `UPDATE events SET nama=$2, kategori=$3, jenis=$4, tgl_mulai=$5, jam_mulai=$6,
               tgl_selesai=$7, jam_selesai=$8, lokasi=$9, divisi=$10, pj=$11, sasaran=$12,
               peserta=$13, status=$14, keterangan=$15, updated_at=now()
       WHERE id=$1`;

function insertParams(d) {
  return [d.nama, d.kategori, d.jenis, d.tgl_mulai, d.jam_mulai, d.tgl_selesai, d.jam_selesai,
          d.lokasi, d.divisi, d.pj, d.sasaran, d.peserta, d.status, d.keterangan];
}

function parseId(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID tidak valid." });
    return null;
  }
  return id;
}

/* Serialisasi semua operasi tulis (POST/PUT/bulk) dengan advisory lock database.
   Mencegah race: dua transaksi konkuren yang sama-sama tidak melihat baris belum-commit
   lawannya lalu keduanya INSERT event identik (duplikat). Lock dilepas otomatis saat COMMIT/ROLLBACK. */
const DEDUP_LOCK = `SELECT pg_advisory_xact_lock(hashtext('events_dedup_lock')::bigint)`;

async function withWriteLock(fn) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(DEDUP_LOCK);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/* ============== API: baca (publik) ============== */

app.get("/api/events", async (req, res) => {
  try {
    const { rows } = await db.q(`${SELECT} ORDER BY tgl_mulai ASC, id ASC`);
    res.json(rows.map(toJSON));
  } catch (e) {
    res.status(500).json({ error: "Gagal memuat data: " + e.message });
  }
});

app.get("/api/events/:id", async (req, res) => {
  const id = parseId(req, res);
  if (id == null) return;
  try {
    const { rows } = await db.q(`${SELECT} WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Kegiatan tidak ditemukan." });
    res.json(toJSON(rows[0]));
  } catch (e) {
    res.status(500).json({ error: "Gagal memuat data: " + e.message });
  }
});

app.get("/api/events/:id/image", async (req, res) => {
  const id = parseId(req, res);
  if (id == null) return;
  try {
    const { rows } = await db.q(`SELECT data, content_type FROM promo_images WHERE event_id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Tidak ada gambar untuk kegiatan ini." });
    res.set("Content-Type", rows[0].content_type);
    res.set("Cache-Control", "no-store");
    res.send(rows[0].data);
  } catch (e) {
    res.status(500).json({ error: "Gagal memuat gambar: " + e.message });
  }
});

/* ============== API: verifikasi PIN (tanpa ubah data) ============== */

app.post("/api/verify-pin", (req, res) => {
  const r = verifyPin(req);
  if (r.ok) return res.json({ ok: true });
  return res.status(401).json({ ok: false, error: r.error });
});

/* ============== API: tulis (wajib PIN) ============== */

app.post("/api/events", checkPin, async (req, res) => {
  const d = toDB(req.body || {});
  if (!d.tgl_mulai) return res.status(400).json({ error: "Tanggal Mulai wajib diisi." });
  if (!d.nama) return res.status(400).json({ error: "Nama Event wajib diisi." });
  try {
    const result = await withWriteLock(async client => {
      const dup = await dedup.findDuplicate(client, d);
      if (dup) {
        const merged = dedup.mergeFields(dup, d);
        if (dedup.hasChange(dup, merged)) {
          const { rows } = await client.query(`${UPDATE_SQL} RETURNING *`, [dup.id, ...insertParams(merged)]);
          return { status: 200, body: Object.assign({}, toJSON(rows[0]), { _deduped: true, _merged: true }) };
        }
        return { status: 200, body: Object.assign({}, toJSON(dup), { _deduped: true, _merged: false }) };
      }
      const { rows } = await client.query(
        `INSERT INTO events ${INSERT_COLS} VALUES ${INSERT_VALS} RETURNING *`,
        insertParams(d)
      );
      return { status: 201, body: toJSON(rows[0]) };
    });
    res.status(result.status).json(result.body);
  } catch (e) {
    res.status(500).json({ error: "Gagal menyimpan: " + e.message });
  }
});

app.put("/api/events/:id", checkPin, async (req, res) => {
  const id = parseId(req, res);
  if (id == null) return;
  const d = toDB(req.body || {});
  if (!d.tgl_mulai) return res.status(400).json({ error: "Tanggal Mulai wajib diisi." });
  try {
    const result = await withWriteLock(async client => {
      const collide = await dedup.findDuplicateExcept(client, d, id);
      if (collide) {
        return { status: 409, body: { error: "Kegiatan lain sudah memiliki nama, tanggal, jam, dan tempat yang sama." } };
      }
      const { rows } = await client.query(`${UPDATE_SQL} RETURNING *`, [id, ...insertParams(d)]);
      if (!rows.length) return { status: 404, body: { error: "Kegiatan tidak ditemukan." } };
      return { status: 200, body: toJSON(rows[0]) };
    });
    res.status(result.status).json(result.body);
  } catch (e) {
    res.status(500).json({ error: "Gagal menyimpan: " + e.message });
  }
});

app.delete("/api/events/:id", checkPin, async (req, res) => {
  const id = parseId(req, res);
  if (id == null) return;
  try {
    const { rows } = await db.q(`DELETE FROM events WHERE id = $1 RETURNING id`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Kegiatan tidak ditemukan." });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Gagal menghapus: " + e.message });
  }
});

app.post("/api/events/bulk", checkPin, async (req, res) => {
  const raw = req.body || {};
  const list = Array.isArray(raw) ? raw : raw.events || [];
  if (!Array.isArray(list) || !list.length) {
    return res.status(400).json({ error: "Tidak ada data untuk diimpor." });
  }
  const client = await db.pool.connect().catch(() => null);
  if (!client) return res.status(500).json({ error: "DATABASE_URL belum diatur." });
  let inserted = 0, updated = 0, skipped = 0;
  try {
    await client.query("BEGIN");
    await client.query(DEDUP_LOCK);
    for (const item of list) {
      const d = toDB(item || {});
      if (!d.tgl_mulai) continue;
      const dup = await dedup.findDuplicate(client, d);
      if (dup) {
        const merged = dedup.mergeFields(dup, d);
        if (dedup.hasChange(dup, merged)) {
          await client.query(UPDATE_SQL, [dup.id, ...insertParams(merged)]);
          updated++;
        } else {
          skipped++;
        }
        continue;
      }
      await client.query(
        `INSERT INTO events ${INSERT_COLS} VALUES ${INSERT_VALS}`,
        insertParams(d)
      );
      inserted++;
    }
    await client.query("COMMIT");
    res.json({ ok: true, count: inserted, updated, skipped });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Gagal mengimpor: " + e.message });
  } finally {
    client.release();
  }
});

app.post(
  "/api/events/:id/image",
  checkPin,
  express.raw({ type: () => true, limit: "3mb" }),
  async (req, res) => {
    const id = parseId(req, res);
    if (id == null) return;
    const buf = req.body;
    if (!buf || !buf.length) return res.status(400).json({ error: "Tidak ada data gambar." });
    const contentType = req.headers["content-type"] || "image/jpeg";
    try {
      await db.q(
        `INSERT INTO promo_images (event_id, data, content_type) VALUES ($1,$2,$3)
         ON CONFLICT (event_id) DO UPDATE SET data = $2, content_type = $3, updated_at = now()`,
        [id, buf, contentType]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Gagal menyimpan gambar: " + e.message });
    }
  }
);

app.delete("/api/events/:id/image", checkPin, async (req, res) => {
  const id = parseId(req, res);
  if (id == null) return;
  try {
    await db.q(`DELETE FROM promo_images WHERE event_id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Gagal menghapus gambar: " + e.message });
  }
});

/* ============== Fallback API ============== */

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Endpoint tidak ditemukan." });
});

/* ============== Local dev ============== */

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Pusat Informasi Kegiatan Gereja berjalan di http://localhost:${port}`);
    console.log("Catatan: DATABASE_URL " + (process.env.DATABASE_URL ? "sudah" : "BELUM") + " diatur.");
  });
}

module.exports = app;