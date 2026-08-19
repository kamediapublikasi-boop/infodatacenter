# Rencana Rebuild — Pusat Informasi Kegiatan Gereja

Dokumen desain & panduan untuk membangun ulang aplikasi `dashboard.html` menjadi sistem web multi-admin yang online, gratis, dan dipakai bersama oleh admin internal gereja (call center, dept penyelenggara, publikasi, media, EO, dll).

Status: **Terimplementasi & Sudah Online** — https://infodatacenter.vercel.app/

---

## 1. Ringkasan Keputusan

| Aspek | Keputusan |
|---|---|
| Akses | Online via internet, tanpa login |
| Edit | Semua admin bisa baca + edit semua, dengan **PIN bersama** untuk aksi tulis |
| Workflow | Tidak ada alur persetujuan; kegiatan langsung tampil |
| Frontend | Vanilla JS (warisi tampilan & logika `dashboard.html` yang sudah ada) |
| Backend | Node.js + Express |
| Database | Supabase (PostgreSQL), dipakai juga untuk dev lokal |
| Gambar promo | Disimpan sebagai `bytea` di PostgreSQL (bukan storage bucket) |
| Hosting | **Vercel** (static + API serverless, gratis, tidak sleep) |
| Migrasi | Import CSV format 15 kolom (format lama tetap didukung) |

---

## 2. Alasan Pemilihan Stack

- **Vercel** — gratis, HTTPS otomatis, tidak mati saat idle (beda dengan Glitch/Render yang "sleep"), deploy lewat GitHub.
- **Supabase** — PostgreSQL gratis 500MB, persisten, API langsung via REST/SQL editor untuk inspeksi & backup.
- **Gambar di DB** — gambar promo sudah dikompres (maks 1600px, ~200–500KB); menyimpan sebagai `bytea` membuat seluruh data dalam satu tempat sehingga mudah backup/restore. Di dalam batas free tier untuk skala gereja.
- **Tanpa login + PIN** — sesuai permintaan; pengamanan dikompensasi dengan PIN server-side, rate-limit, dan HTTPS.

---

## 3. Struktur Proyek

```
E:\InfoDataCenter\
  package.json          # dependensi: express, pg (node-postgres), dotenv
  vercel.json           # konfigurasi deploy Vercel (static + serverless API)
  .env.example          # contoh variabel lingkungan
  .env                  # variabel lokal (tidak di-commit)
  schema.sql            # DDL: tabel events + promo_images
  server/
    index.js            # Express app: serve public/ + API routes
    db.js               # koneksi Supabase/PostgreSQL
    pin.js              # middleware cek PIN + rate-limit percobaan
  public/
    index.html          # dashboard hasil rebuild (basis dashboard.html)
    style.css           # CSS dari dashboard.html (dipindah)
    app.js              # logika UI + API client
  seed.js               # (opsional) import CSV lama → DB via CLI
  RENCANA.md            # dokumen ini
  start-server.bat      # diperbaiki: jalankan node server/index.js (dev lokal)
  README.md             # panduan setup & deploy (ringkas)
```

---

## 4. Skema Database (`schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS events (
  id          SERIAL PRIMARY KEY,
  nama        TEXT NOT NULL,
  kategori    TEXT NOT NULL DEFAULT 'Lainnya',
  jenis       TEXT NOT NULL DEFAULT '—',
  tgl_mulai   DATE NOT NULL,
  jam_mulai   TEXT,
  tgl_selesai DATE,
  jam_selesai TEXT,
  lokasi      TEXT NOT NULL DEFAULT '—',
  divisi      TEXT NOT NULL DEFAULT '—',
  pj          TEXT NOT NULL DEFAULT '—',
  sasaran     TEXT NOT NULL DEFAULT '—',
  peserta     INTEGER,
  status      TEXT NOT NULL DEFAULT 'Rencana',
  keterangan  TEXT DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promo_images (
  event_id     INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  data         BYTEA NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_tgl ON events (tgl_mulai, tgl_selesai);
```

Catatan:
- Kolom `events` **identik dengan 15 kolom format CSV lama** → import/ekspor CSV tetap kompatibel.
- `jam_mulai` / `jam_selesai` disimpan sebagai `TEXT` (format `HH:MM`) untuk menyamai perilaku dashboard lama.
- `peserta` boleh NULL (perkiraan peserta tidak diketahui).
- `tgl_selesai` NULL → dianggap sama dengan `tgl_mulai` saat dipakai (perilaku `normalizeRows` lama).

---

## 5. API

| Method | Endpoint | Auth | Fungsi |
|---|---|---|---|
| GET | `/api/events` | Publik | Daftar semua kegiatan |
| GET | `/api/events/:id` | Publik | Detail satu kegiatan |
| GET | `/api/events/:id/image` | Publik | Gambar promo (mime sesuai `content_type`) |
| POST | `/api/events` | PIN | Tambah kegiatan (data JSON) |
| POST | `/api/verify-pin` | Publik | Cek PIN `{pin}` → `{ok}` (tanpa mengubah data) |
| PUT | `/api/events/:id` | PIN | Ubah kegiatan |
| DELETE | `/api/events/:id` | PIN | Hapus kegiatan (gambar ikut terhapus via CASCADE) |
| POST | `/api/events/:id/image` | PIN | Upload/ubah gambar (raw body atau multipart) |
| DELETE | `/api/events/:id/image` | PIN | Hapus gambar promo |
| POST | `/api/events/bulk` | PIN | Bulk insert (dipakai fitur import CSV) |

**Format JSON event (sama dengan skema), mis.:**

```json
{
  "nama": "Ibadah Raya Natal",
  "kategori": "Ibadah Raya",
  "jenis": "Ibadah",
  "tgl_mulai": "2026-12-25",
  "jam_mulai": "09:00",
  "tgl_selesai": "2026-12-25",
  "jam_selesai": "11:00",
  "lokasi": "Gedung Utama",
  "divisi": "Ibadah",
  "pj": "Pdt. Andreas",
  "sasaran": "Jemaat",
  "peserta": 800,
  "status": "Rencana",
  "keterangan": ""
}
```

---

## 6. Keamanan (PIN Tanpa Login)

- PIN disimpan hanya sebagai **env var** server (`EDIT_PIN`). Tidak pernah ada di kode frontend.
- Frontend meminta PIN lewat modal; PIN hanya disimpan di `sessionStorage` (hilang saat tab ditutup).
- Semua endpoint tulis mengharuskan header: `X-Edit-Pin: <pin>`.
- `pin.js`: middleware membandingkan PIN + **rate-limit** (mis. 5 gagal dalam 10 menit → 429). Basis rate-limit sederhana per IP (in-memory; cukup untuk skala kecil).
- Mode **read-only** saat PIN salah/belum dimasukkan: tombol Tambah/Edit/Hapus disembunyikan.
- HTTPS otomatis oleh Vercel.
- Saran: ubah PIN berkala; backup DB via SQL editor Supabase.

**Keterbatasan yang disepakati:** tanpa login, tidak ada audit "siapa" — hanya log waktu aksi. Jika nanti butuh jejak per-user, tinggal menambah tabel `users` + kolom `editor` di log.

---

## 7. Frontend (Rebuild dari `dashboard.html`)

### Dipertahankan
- 3 view: **Kalender** (bulanan + panel hari), **Tabel** (filter + sort + paginasi), **Kelola** (CRUD + thumbnail promo).
- Filter: preset periode (Semua/Hari ini/7 hari/Bulan ini/30 hari/Tahun ini), rentang tanggal custom, kategori, status, divisi, pencarian.
- Aturan filter waktu **overlap** (`startTS <= e && endTS >= s`) — penting untuk event multi-hari.
- Modal detail + lightbox gambar, ekspor CSV terfilter, tema gelap/terang.
- Parser CSV RFC4180-ish (quoted field, `""`, CRLF), tanpa dependensi eksternal.

### Diubah / Ditambah
1. **API client** menggantikan `DataStore` (localStorage) & `ImageStore` (IndexedDB):
   - `GET /api/events` saat load → state `App.events`.
   - Mutasi (tambah/edit/hapus/gambar) → panggil API dengan `X-Edit-Pin`, lalu refetch.
2. **Gerbang PIN**:
   - Saat buka app: jika `sessionStorage` kosong → tampil modal "Masukkan PIN Edit" dengan tombol *Lewati (baca saja)*.
   - Simpan `{ pin, ok }` di `sessionStorage`. Jika `ok === true`, tampilkan tombol tulis.
   - Endpoint khusus `POST /api/verify-pin` untuk memvalidasi tanpa mengubah data (opsional).
3. **Sinkronisasi multi-admin**: polling `GET /api/events` tiap 30 detik + refetch saat `visibilitychange` (tab aktif lagi) + refetch setelah setiap mutasi.
4. **Import CSV → bulk**: parser lama tetap dipakai di client; hasilnya dikirim ke `POST /api/events/bulk` (bukan simpan lokal).
5. **Ekspor**: tetap menghasilkan CSV 15 kolom dari data terfilter.
6. `id` tidak lagi dihasilkan client (`nextId()`), melainkan dari DB (`SERIAL`). URL/modal pakai id dari server.

### Komponen yang dipakai ulang
- `parseCSV`, `normalizeRows`-ke-format-API, `toCSV`, `fmtDate*`, `iso`, `matchesTime`, `presetRange`, `CAT_COLORS`, `STATUS_META`, `buildDropdown`, struktur HTML/CSS (dipindah ke `style.css`).

---

## 8. Migrasi Data Lama

1. **Utama:** buka app baru → view Kelola → "Impor CSV" → pilih CSV 15 kolom lama → bulk POST ke server.
2. **Alternatif CLI:** `node seed.js path/file.csv` (memakai `parseCSV` porting ke Node + `normalizeRows`) untuk impor batch.
3. Gambar promo lama tidak bisa dipindah otomatis dari IndexedDB → catat sebagai kehilangan yang diterima, atau input ulang manual via form.

---

## 9. Deploy Gratis (Vercel + Supabase) — SUDAH DILAKUKAN

Hasil: project aktif di **https://infodatacenter.vercel.app/** (repo: `kamediapublikasi-boop/infodatacenter`). Supabase region `ap-northeast-1`, memakai connection string pooled.

### A. Supabase
1. Daftar di https://supabase.com → New Project (pilih region terdekat, simpan `Database Password`).
2. Buka **SQL Editor** → tempel isi `schema.sql` → Run.
3. Catat **Project Settings → Database → Connection string** (pakai yang "pooled" bila tersedia) untuk diisi ke `DATABASE_URL`. *(Sudah: `postgres.efoymwgwzmvpoyzbeksx` @ `aws-0-ap-northeast-1.pooler.supabase.com`)*

### B. Vercel
1. `git init` + commit proyek → push ke GitHub (repo publik/privat bebas).
2. Daftar di https://vercel.com → **Add New Project** → pilih repo.
3. Di **Settings → Environment Variables**, set:
   - `DATABASE_URL` = connection string PostgreSQL Supabase
   - `EDIT_PIN` = PIN edit bersama (mis. `gereja2026`)
4. Deploy → URL `https://<nama>.vercel.app` aktif.
5. `vercel.json` mengatur: `public/` sebagai static, route `/api/*` → serverless function Node (`server/index.js`).

### C. Dev Lokal
1. `npm install`
2. Salin `.env.example` → `.env`, isi `DATABASE_URL`, `EDIT_PIN`.
3. Jalankan `start-server.bat` (→ `node server/index.js`) → buka `http://localhost:3000`.
4. Dev memakai Supabase yang sama (tidak perlu install PostgreSQL lokal).

---

## 10. Verifikasi

- **Dev:** `node --check server/index.js` untuk cek syntax; buka `localhost:3000`, uji kalender/tabel/kelola + PIN (salah → read-only; benar → bisa CRUD + upload gambar).
- **API:** uji `curl`/`Invoke-WebRequest` terhadap endpoint publik & dengan header PIN.
- **Import:** uji dengan CSV template 15 kolom → jumlah kegiatan sesuai DB.
- **Multi-admin:** buka dua tab/browser → edit di satu, pastikan tab lain ter-refresh via polling.

---

## 11. Catatan & Keputusan Terbuka

- ~~`start-server.bat` lama memanggil `serve.js` yang tidak ada~~ → sudah diganti menjalankan server Express baru (`node server/index.js`).
- ~~`AGENTS.md` akan diperbarui setelah implementasi~~ → sudah (struktur baru, cara verifikasi baru, key API, nilai enumerasi sama).
- Log aktivitas (timestamp aksi) opsional, ditambahkan belakangan bila dibutuhkan.
- Backup rutin: Supabase → SQL Editor → Export, atau gunakan `pg_dump` bila perlu.
- Sudah ter-import: `template.csv` (7 event contoh) ke database produksi — boleh dihapus/diganti data asli.

## 12. Log Implementasi

- 2026-08-19 — Skema + seed `template.csv` (7 event) di Supabase; koneksi DB diverifikasi lokal.
- 2026-08-19 — Vercel env (`DATABASE_URL`, `EDIT_PIN`) diset; `GET /api/events` → 200 (7 data), `POST /api/verify-pin` → `{"ok":true}` di produksi.
- 2026-08-19 — MD files di-sinkronkan dengan status live (README, RENCANA, AGENTS).
