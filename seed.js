"use strict";

require("dotenv").config();

const fs = require("fs");
const db = require("./server/db");
const { csvToPayloads } = require("./server/csv");

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Gunakan: node seed.js <path/file.csv>");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL belum diatur. Salin .env.example menjadi .env dan isi dulu.");
    process.exit(1);
  }

  const text = fs.readFileSync(file, "utf8");
  const payloads = csvToPayloads(text);
  if (!payloads.length) {
    console.error("Tidak ada baris valid (butuh kolom Tanggal Mulai).");
    process.exit(1);
  }

  const client = await db.pool.connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");
    for (const p of payloads) {
      await client.query(
        `INSERT INTO events (nama,kategori,jenis,tgl_mulai,jam_mulai,tgl_selesai,jam_selesai,lokasi,divisi,pj,sasaran,peserta,status,keterangan)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [p.nama, p.kategori, p.jenis, p.tglMulai, p.jamMulai, p.tglSelesai, p.jamSelesai,
         p.lokasi, p.divisi, p.pj, p.sasaran, p.peserta, p.status, p.keterangan]
      );
      inserted++;
    }
    await client.query("COMMIT");
    console.log(`${inserted} kegiatan berhasil diimpor ke database.`);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Gagal mengimpor:", e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.pool.end();
  }
}

main();