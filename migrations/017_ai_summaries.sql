-- =====================================================================
-- AI SUMMARY — ringkasan analisis per brand + platform + periode
--
-- Bagian C dari "Simplified Client Context Framework" (Period Context)
-- tidak pernah punya tempat penyimpanan: brand_profiles hanya memuat
-- bagian A (Brand Context) dan B (Current Direction), yang keduanya
-- di-update jarang. Tabel ini yang memegang bagian C, dan sengaja
-- append-only per periode: satu baris per (brand, platform, isi payload),
-- jadi periode lama tidak pernah tertimpa dan bisa dibaca lagi sebagai
-- historical learning saat menyusun periode berikutnya.
--
-- payload_hash memberi dua hal sekaligus: kunci cache (data yang sama
-- tidak memanggil model dua kali) dan definisi "data berubah" yang tidak
-- bisa diperdebatkan — kalau angka yang masuk berbeda, hash-nya berbeda,
-- dan ringkasannya digenerate ulang.
--
-- input_payload disimpan apa adanya supaya sebuah ringkasan selalu bisa
-- dipertanggungjawabkan: enam bulan lagi, "kenapa AI bilang begitu"
-- dijawab oleh baris ini, bukan oleh tebakan.
-- =====================================================================

SET search_path TO public, ads_reports;

CREATE TABLE IF NOT EXISTS ads_reports.ai_summaries (
    id                  SERIAL PRIMARY KEY,
    brand_id            INTEGER NOT NULL REFERENCES public.brands(brand_id) ON DELETE CASCADE,
    platform            ads_reports.platform_enum NOT NULL,

    -- Label apa adanya dari laporan ("Juli 2026" → "Agustus 2026"); tanggal
    -- ISO-nya nullable karena tidak semua ekspor menyebutkan periodenya
    -- sebagai tanggal (Meta memberi kolom "Month", Shopee memberi rentang).
    period_old_label    TEXT,
    period_cur_label    TEXT,
    period_old_start    DATE,
    period_old_end      DATE,
    period_cur_start    DATE,
    period_cur_end      DATE,

    payload_hash        TEXT NOT NULL,
    input_payload       JSONB NOT NULL,
    summary             JSONB NOT NULL,
    -- Hasil suntingan tim. NULL selama belum pernah diedit, sehingga
    -- "apa kata model" dan "apa yang tim setujui" tetap bisa dibedakan.
    edited_summary      JSONB,
    edited_by           INTEGER REFERENCES public.users(user_id),
    edited_at           TIMESTAMPTZ,

    model               TEXT NOT NULL,
    generated_by        INTEGER REFERENCES public.users(user_id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cache key: payload yang sama pada brand+platform yang sama = satu baris.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_summaries_payload
    ON ads_reports.ai_summaries (brand_id, platform, payload_hash);
-- Jalur baca untuk historical learning: periode terbaru lebih dulu.
CREATE INDEX IF NOT EXISTS ix_ai_summaries_history
    ON ads_reports.ai_summaries (brand_id, platform, created_at DESC);
