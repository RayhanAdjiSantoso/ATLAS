# Catatan Merge — Pengaturan Brand jadi jalur upload tunggal

Untuk yang memegang `main` dan database produksi. Branch: **`Jonathan`** → `main`
(7 commit, `c9097a0` … `79f500f`).

**Ringkasnya:** merge seperti biasa, lalu jalankan `npm run migrate` sekali di
database. Tidak ada tabel lama yang diubah bentuknya dan tidak ada data lama
yang dihapus — semua migration baru hanya `CREATE TABLE`/`ADD COLUMN`.

---

## 1. Apa yang berubah

Pengaturan Brand berubah dari halaman mock jadi tempat semua file diunggah.
Setiap brand punya satu perpustakaan file per platform, per channel, per bulan;
Dashboard Business Overview membaca hasilnya, dan Report Generator akan menyusul
memakai sumber yang sama (belum di commit ini).

| Bagian | Perubahan |
|---|---|
| `migrations/015_brand_library.sql` | **baru** — `public.brand_profiles` + `ads_reports.brand_library_files` |
| `migrations/016_brand_library_parts.sql` | **baru** — satu bulan boleh punya beberapa file (ekspor Shopee yang terbagi) |
| `migrations/017_ai_summaries.sql` | **baru** — `ads_reports.ai_summaries`, cache + riwayat AI Summary per periode |
| `backend/src/services/aiSummaryService.js` | **baru** — perakitan konteks + panggilan Gemini |
| `backend/src/routes/reportGenerator/aiSummary.js` | **baru** — endpoint `/api/report-generator/ai-summary` |
| `frontend/src/reportGenerator/features/ai/` | **baru** — kartu AI Summary di bawah tiap laporan platform |
| `backend/src/services/brandLibraryService.js` | **baru** — deteksi periode, simpan, coverage per hari |
| `backend/src/controllers/brandLibraryController.js` | **baru** — endpoint upload/list/hapus/unduh |
| `backend/scripts/importLibraryToDashboard.js` | **baru** — backfill (lihat bagian 4) |
| `backend/src/routes/brandRoutes.js` | route baru di bawah `/api/brands/:brandId/...` |
| `backend/src/config/db.js` | `pool.on('error')` — perbaikan crash, lihat bagian 5 |
| `backend/src/services/import/loaders/orders.js` | impor order jadi batch (menit → detik) |
| `backend/src/services/import/lookupResolver.js` | tambahan `warmSingle` / `warmPair`, API lama tidak berubah |
| `backend/src/middlewares/upload.js`, `errorHandler.js` | terima CSV, batas 25 MB, error multer jadi 400 |
| `frontend/src/pages/BrandSettingsPage.jsx` + `console.css` | halaman baru |
| `frontend/src/components/layout/AppLayout.jsx`, `pages/HomePage.jsx`, `index.css`, `index.html` | logo ATLAS baru + favicon |
| `frontend/src/assets/` | **baru** — `atlas-icon.png`, `atlas-wordmark.png` |

Tidak ada endpoint lama yang dihapus atau diubah kontraknya. Tab Upload Data
lama dan `POST /api/uploads` tetap berfungsi persis seperti sebelumnya.

---

## 2. Urutan yang aman

```bash
# 1. Merge
git checkout main
git pull
git merge Jonathan          # atau lewat Pull Request
git push origin main

# 2. Database — WAJIB, sebelum deploy backend
cd backend
npm run migrate             # jalankan sekali; aman diulang

# 3. Environment — tambahkan satu variabel baru di server
#    GEMINI_API_KEY=<key dari Google AI Studio>
#    (opsional) GEMINI_MODEL=gemini-flash-latest

# 4. Deploy backend, lalu frontend
```

Tanpa `GEMINI_API_KEY`, seluruh aplikasi tetap jalan normal — hanya tombol
"Generate AI Summary" yang menjawab dengan pesan bahwa key belum diset.

**Urutannya penting:** migrate dulu, baru deploy backend. Backend versi baru
menulis ke kolom yang belum ada kalau migration belum jalan.

Sebaliknya aman: menjalankan migration **sebelum** deploy tidak merusak backend
versi lama — tabel dan kolom baru tidak disentuh olehnya.

---

## 3. Soal `npm run migrate`

`backend/scripts/migrate.js` menjalankan **semua** file di `migrations/`
berurutan setiap kali, tanpa tabel pencatat. Itu memang desainnya: setiap file
ditulis idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS`), jadi menjalankan ulang di database yang sudah
terisi bukan masalah dan tidak menyentuh data.

Satu catatan yang sudah dibuktikan, bukan asumsi: `015` sempat **tidak**
idempotent karena `016` menghapus lalu mengganti salah satu indeksnya, jadi
menjalankan migrate untuk kedua kalinya gagal di tengah jalan. Sudah
diperbaiki (indeks lama hanya dibuat kalau kolom `part_index` belum ada), dan
sudah diverifikasi dengan menjalankan `npm run migrate` dua kali berturut-turut
sampai 17 file lolos tanpa error. Kalau kamu pernah menarik branch ini sebelum
perbaikan itu, tarik ulang dulu.

Skrip memakai `DATABASE_URL` dari `backend/.env`. Untuk Neon, pakai connection
string **unpooled** saat migrate (butuh sesi sungguhan):

```bash
DATABASE_URL="$DATABASE_URL_UNPOOLED" node scripts/migrate.js
```

Sesudahnya, cek cepat:

```sql
-- harus mengembalikan 2 baris
SELECT table_name FROM information_schema.tables
WHERE (table_schema='public'      AND table_name='brand_profiles')
   OR (table_schema='ads_reports' AND table_name='brand_library_files');

-- harus ada: part_index, period_source, dashboard_upload_id
SELECT column_name FROM information_schema.columns
WHERE table_schema='ads_reports' AND table_name='brand_library_files';

-- harus ada (lihat bagian 5)
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='uploads' AND column_name='raw_file';

-- AI Summary
SELECT to_regclass('ads_reports.ai_summaries');
```

---

## 4. Backfill — kemungkinan besar TIDAK perlu

`backend/scripts/importLibraryToDashboard.js` hanya untuk file yang sudah
telanjur ada di perpustakaan tapi belum masuk ke tabel fakta Dashboard. Di
database produksi, tabel perpustakaannya baru dibuat, jadi isinya kosong dan
skrip ini tidak ada kerjaan.

Jalankan hanya kalau ada yang mengunggah lewat Pengaturan Brand sebelum backend
versi ini terpasang:

```bash
node scripts/importLibraryToDashboard.js            # semua brand
node scripts/importLibraryToDashboard.js 95         # satu brand
node scripts/importLibraryToDashboard.js 95 --force # impor ulang
```

Aman diulang: file yang sudah terimpor dilewati kecuali `--force`, dan `--force`
menghapus impor sebelumnya lebih dulu supaya tabel fakta tidak dobel.

---

## 5. Dua hal yang mungkin sudah lama bermasalah di produksi

**a. `public.uploads.raw_file` mungkin belum ada.** Migration `013` sudah lama
di repo, tapi di branch database dev ternyata belum pernah dijalankan — akibatnya
setiap upload Dashboard gagal dengan error "missing column raw_file". Kolom ini
wajib: kode upload menulis ke sana dan endpoint Download membacanya. `npm run
migrate` sekaligus memperbaikinya. Cek dengan query di bagian 3.

**b. API bisa mati sendiri tanpa jejak.** `pg-pool` melempar error koneksi idle
ke pool, dan event `'error'` tanpa listener adalah crash keras di Node. Setiap
koneksi idle yang putus — laptop sleep, jaringan sesaat, Neon menutup koneksi —
mematikan proses. Terlihat di frontend sebagai `ECONNREFUSED`. Sudah diperbaiki
di `backend/src/config/db.js`; tidak butuh langkah tambahan saat deploy.

---

## 6. Catatan deploy

Batas upload di route perpustakaan **25 MB**, sama dengan route Report
Generator. Vercel memotong body request di ~4,5 MB, jadi kalau backend
di-deploy ke Vercel, file besar (ekspor order sebulan bisa 16 MB) akan ditolak
platform sebelum sampai ke kode. Ini kendala yang sudah ada sejak dulu di route
Report Generator, bukan hal baru — tapi sekarang lebih sering kena karena semua
upload lewat sini. Kalau upload besar dibutuhkan, backend perlu host tanpa batas
itu.

File disimpan sebagai `BYTEA` di dalam Postgres (mengikuti pola
`ads_reports.raw_uploads` yang sudah ada), bukan di disk — jadi tidak ada volume
yang perlu disiapkan, tapi ukuran database akan tumbuh seiring jumlah file.

---

## 7. Cara memastikan berhasil

1. Buka **Pengaturan Brand** → pilih satu brand → tab **Data & file** harus
   memuat tanpa banner merah. Banner "404" berarti backend belum di-deploy ulang.
2. Klik satu sel bulan pada baris **Order** → unggah satu ekspor Shopee. Notifikasi
   harus menyebut jumlah hari terdeteksi **dan** jumlah baris yang masuk ke Dashboard.
3. Buka **Dashboard Business Overview** → brand dan bulan yang sama → KPI terisi.
4. Isi satu field di tab **Brand context** → Simpan → refresh → nilainya bertahan.
5. Report Generator → generate satu laporan → di bawahnya ada kartu **AI Summary** →
   klik Generate. Kalau Gemini sedang sibuk (503), pesannya muncul di kartu itu saja
   dan laporan di atasnya tetap utuh — itu perilaku yang benar, bukan kegagalan deploy.

## 8. Kalau harus mundur

`git revert` commit-commitnya lalu deploy versi lama. **Migration tidak perlu
dibalik**: tabel dan kolom baru tidak dibaca sama sekali oleh kode lama, jadi
membiarkannya tidak menimbulkan efek apa pun. Jangan `DROP TABLE
ads_reports.brand_library_files` kecuali memang ingin membuang file yang sudah
diunggah — byte file aslinya hanya ada di sana.
