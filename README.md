# Pusat Informasi Kegiatan Gereja

Dashboard web multi-admin untuk data kegiatan gereja. Online, gratis (Vercel + Supabase), tanpa login — **baca bebas, edit butuh PIN bersama**.

## Fitur

- Kalender bulanan + panel hari, tabel terfilter/sort, kelola (CRUD)
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

## Deploy ke Vercel (Gratis)

1. `git init`, commit, push ke GitHub.
2. https://vercel.com → **Add New Project** → pilih repo.
3. Set **Environment Variables**: `DATABASE_URL`, `EDIT_PIN`.
4. Deploy. Selesai — akses URL `https://<nama>.vercel.app`.

`vercel.json` sudah mengatur: folder `public/` sebagai static, route `/api/*` ke `server/index.js`.

## Import Data Lama

- Lewat UI: view **Kelola → Impor CSV** (format 15 kolom lama).
- Lewat CLI: `node seed.js path/file.csv`.

## Keamanan

- PIN hanya ada di server (env var). Tidak pernah dikirim ke frontend sebagai kode.
- Rate-limit percobaan PIN: 5 gagal → blokir 10 menit.
- Tanpa login = tanpa jejak per-user. Untuk data sensitif lebih lanjut, rencanakan auth asli.

## Struktur

```
server/      Express API (index.js, db.js, pin.js, csv.js)
public/      Frontend vanilla (index.html, style.css, app.js)
schema.sql   DDL database
seed.js      Import CSV via CLI
```