-- Pusat Informasi Kegiatan Gereja
-- Jalankan di Supabase SQL Editor (Project -> SQL Editor -> New query -> Run)

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
