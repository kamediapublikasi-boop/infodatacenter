# Pusat Informasi Kegiatan Gereja

Dashboard web multi-admin untuk data kegiatan gereja. Online, gratis (Vercel + Supabase), tanpa login — **baca bebas, edit butuh PIN bersama**.

## Status: Sudah Online

- **URL produksi:** https://infodatacenter.vercel.app/
- **Repo GitHub:** https://github.com/kamediapublikasi-boop/infodatacenter
- **Frontend** (static `public/`) + **API serverless** (`/api/*`) aktif di Vercel; setiap push ke `main` auto re-deploy.
- **Database** PostgreSQL di Supabase (region `ap-northeast-1`) terhubung; skema `events` + `promo_images` sudah dibuat & dijalankan.
- **Data contoh:** 7 event dari `template.csv` sudah ter-import — siap diganti data asli lewat **Kelola → Impor CSV**.
- **Terverifikasi:** `GET /` 200, `GET /api/events` 200 (7 event), `POST /api/verify-pin` → `{"ok":true}`. Gambar promo tampil di modal detail (fix `[hidden]` CSS, 2026-08-20).

## Fitur

- Kalender bulanan + panel hari, tabel terfilter/sort, kelola (CRUD)
- Tambah kegiatan cepat dari kalender: **double-click tanggal** (atau tombol ＋ di panel hari) → form popup dengan tanggal otomatis terisi
- **Impor dari Teks (WhatsApp)**: tempel daftar jadwal chat → deteksi otomatis (tanggal, jam, lokasi, kategori) → tinjau & pilih → tambah sekaligus (batch, tanpa API eksternal)
- **Anti-duplikat otomatis**: kegiatan dengan nama, tanggal, jam, dan tempat yang sama tidak akan dicatat dua kali — data yang lebih lengkap digabung ke kegiatan yang sudah ada (berlaku untuk form tambah/edit, impor WA, dan impor CSV)
- **Indikator proses**: spinner + pesan "Menyimpan N kegiatan…" muncul saat menambah/mengimpor banyak event; tombol terkunci agar tidak ada klik ganda
- Filter periode/kategori/status/divisi/pencarian; ekspor CSV
- Gambar promo per kegiatan
- Sinkron otomatis antar admin (polling 30 detik)
- Mode baca tanpa PIN; mode edit dengan PIN (disimpan sementara di browser)

## Jalankan Lokal (Dev)

1. `npm install`
2. Salin `.env.example` menjadi `.env`, isi `DATABASE_URL` (dari Supabase) dan `EDIT_PIN`.
3. Jalankan `start-server.bat` (atau `node server/index.js`) → buka `http://localhost:3000`.

## Set Up Database (Supabase)

1. Daftar di https://supabase.com → New Project.
2. Buka **SQL Editor** → tempel isi `schema.sql` → Run.
3. Salin **Connection string** (Project Settings → Database) ke `DATABASE_URL`.

## Workflow Perubahan

Setiap update: **uji lokal dulu, baru push → auto-deploy Vercel** (dev lokal & produksi memakai database Supabase yang sama).

1. Edit kode.
2. Cek syntax: `npm run check` (server) + `node --check public/app.js`.
3. Uji di `http://localhost:3000` (browser) — pastikan fitur yang diubah berfungsi.
4. `git commit` + `git push main` → Vercel re-deploy otomatis (~1 menit).

Pengecualian: perubahan sangat kecil (teks/tombol) boleh langsung push, tapi tetap minim risiko.

## Deploy ke Vercel (Gratis)

Sudah diterapkan untuk project ini. `vercel.json` mengatur: folder `public/` sebagai static, route `/api/*` ke `server/index.js`.

Langkah untuk project baru:
1. `git init`, commit, push ke GitHub.
2. https://vercel.com → **Add New Project** → pilih repo.
3. Set **Environment Variables**: `DATABASE_URL`, `EDIT_PIN`.
4. Deploy. Selesai — akses URL `https://<nama>.vercel.app`.

## Import Data Lama

- Lewat UI: view **Kelola → Impor CSV** (format 15 kolom lama).
- Lewat CLI: `node seed.js path/file.csv` (dipakai untuk meng-seed `template.csv`).

## Keamanan

- PIN hanya ada di server (env var). Tidak pernah dikirim ke frontend sebagai kode.
- Rate-limit percobaan PIN: 5 gagal → blokir 10 menit.
- Tanpa login = tanpa jejak per-user. Untuk data sensitif lebih lanjut, rencanakan auth asli.
- `DATABASE_URL`/`EDIT_PIN` disimpan di env Vercel + `.env` lokal (git-ignored, tidak pernah di-commit).

## Struktur

```
server/      Express API (index.js, db.js, pin.js, csv.js)
public/      Frontend vanilla (index.html, style.css, app.js)
schema.sql   DDL database
seed.js      Import CSV via CLI
```