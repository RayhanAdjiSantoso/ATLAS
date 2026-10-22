# Google Reviews CSV — kontrak V1 (`atlas-gr-1`)

Format file yang ditulis Chrome extension **ATLAS Google Reviews Exporter** dan dibaca fitur **Import CSV** di ATLAS (Google Reviews Analytics). Parser: `backend/src/services/googleReviews/csvSchema.js`. Penulis: `extensions/google-reviews-exporter/lib/core.js`. Test kontrak: `backend/test/googleReviewsExtension.test.js`.

## Format file

- CSV standar (RFC 4180): pemisah koma; field berisi koma, tanda kutip, atau baris baru diapit `"…"`, dan tanda kutip di dalamnya ditulis ganda (`""`).
- Encoding UTF-8, diawali BOM (agar Excel menampilkan huruf dan emoji dengan benar). Baris baru antar-record ditulis CRLF.
- Baris pertama berisi header. Urutan kolom bebas; nama kolom tidak peka huruf besar/kecil. Kolom yang tidak dikenal diabaikan, dengan catatan di preview.
- Satu file berisi satu bisnis. File yang berisi lebih dari satu `business_id`, atau lebih dari satu nama bisnis tanpa `business_id`, ditolak.
- Batas default: 4 MB (`GR_CSV_MAX_BYTES`) dan 10.000 baris (`GR_CSV_MAX_ROWS`).

## Versi

Setiap baris membawa `schema_version`. Nilainya untuk V1 adalah `atlas-gr-1`. Versi baru boleh menambah kolom atau nilai; ATLAS tetap membaca file V1, dan file tanpa `schema_version` dibaca dengan aturan V1.

## Kolom

| Kolom | Wajib | Isi |
|---|---|---|
| `schema_version` | – | `atlas-gr-1` |
| `business_name` | **ya** | Nama bisnis |
| `business_id` | – | Identifier bisnis. Dari extension: `cid:<CID Google Maps>`. Tanpa kolom ini, pengguna diminta memilih bisnis saat import. |
| `business_address` | – | Alamat |
| `business_url` | – | URL Google Maps; selain domain Google Maps diabaikan |
| `business_rating` | – | Rating Google bisnis (1,0–5,0) |
| `business_review_count` | – | Jumlah ulasan yang dilaporkan Google |
| `review_id` | – | ID ulasan dari Google Maps (`data-review-id`) |
| `reviewer_name` | – | Nama penulis ulasan (hanya untuk deduplikasi dan menyaring nama dari word cloud; tidak ditampilkan di dashboard) |
| `rating` | **ya** | Bintang, bilangan bulat 1–5 |
| `review_date` | – | Tanggal pasti `YYYY-MM-DD` (atau ISO 8601), hanya bila Google menuliskan tanggal |
| `review_date_raw` | – | Teks tanggal persis seperti di Google (`6 bulan lalu`, `a year ago`, `3 Mar 2024`) |
| `review_date_precision` | – | `exact`, `day`, `week`, `month`, atau `year` |
| `review_text` | **ya** (header) | Teks asli ulasan; boleh kosong untuk ulasan tanpa komentar |
| `review_language` | – | Kode ISO 639-1 (`id`, `en`, …) |
| `owner_response` | – | Balasan pemilik |
| `owner_response_date_raw` | – | Teks tanggal balasan pemilik |
| `collected_at` | – | Waktu pengambilan (ISO 8601 UTC) |
| `source` | – | `atlas_extension` bila dari extension |

## Aturan isi

- **Tanggal tidak dikarang.** Tanggal relatif ("6 bulan lalu") ditulis di `review_date_raw` dengan presisinya, dan `review_date` dibiarkan kosong. ATLAS menghitung mundur dari `collected_at` dan menyimpan presisinya, sehingga ulasan bertanggal "bulan" tidak masuk tren mingguan dan ulasan bertanggal "tahun" tidak masuk tren bulanan. Tanggal di masa depan dibuang.
- **Teks asli.** Extension mengambil teks asli (menekan "See original"/"Lihat versi asli" bila Google menampilkan terjemahan) dan membuka "More"/"Lihat lainnya". Baris baru di dalam ulasan dipertahankan.
- **Ulasan tanpa komentar** tetap valid (`review_text` kosong). Ulasan ini masuk distribusi rating, tetapi tidak masuk distribusi sentimen.
- **Formula spreadsheet.** Sel yang diawali `=`, `+`, `-`, `@`, tab, atau CR diberi apostrof di depannya oleh extension (perlindungan CSV injection). ATLAS membuang tepat apostrof itu saat import, sehingga teks kembali seperti aslinya.
- **Baris tidak valid** (rating di luar 1–5, nama bisnis kosong, field terlalu panjang) dilewati dan dilaporkan per baris dan kolom; baris valid lainnya tetap diimpor.

## Deduplikasi dan idempotensi

1. `review_id` bila ada.
2. Tanpa `review_id`: sidik jari dari bisnis, nama penulis, bintang, teks tanggal, dan teks ulasan (dinormalisasi), tidak pernah dari nama penulis saja. Baris tanpa teks dan tanpa nama yang identik tidak dianggap sama (bisa dua orang berbeda); masing-masing diberi kunci menurut urutannya, sehingga upload ulang file yang sama tetap idempoten.

Mengimpor file yang sama dua kali tidak menduplikasi data. Ulasan yang teks atau ratingnya berubah diperbarui dan dianalisis ulang; ulasan yang tidak berubah tidak dianalisis ulang. Ulasan yang tidak ada di file baru **tidak** dihapus.
