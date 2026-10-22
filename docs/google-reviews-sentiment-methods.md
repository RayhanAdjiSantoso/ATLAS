# Google Reviews Analytics — dua metode analisis sentimen

ATLAS menyediakan dua metode yang **terpisah sepenuhnya**. Pengguna memilih metode, lalu menekan **Run Sentiment Analysis**. Setiap ulasan menyimpan satu hasil per metode, berdampingan, dan seluruh dashboard (pie chart, rating, word cloud, tren, insight, ringkasan, Reviews Explorer) membaca **satu metode saja** pada satu waktu. Hasil dua metode tidak pernah dicampur dalam satu distribusi.

| | Code-Based (default) | AI-Based |
|---|---|---|
| Mesin | Aturan + leksikon di backend ATLAS (`services/googleReviews/codeSentiment/`) | Claude (`ANTHROPIC_API_KEY`), cadangan Gemini (`GEMINI_API_KEY`) |
| Biaya | Tanpa API, tanpa token | Token API |
| Kecepatan | ±ribuan ulasan per detik | Batch 25 ulasan per panggilan |
| Topik | Taksonomi aspek tetap (pelayanan, staf, dokter, hasil, harga, waktu tunggu, kebersihan, tempat, lokasi & parkir, reservasi, rasa & menu), hanya yang muncul di ulasan | Dikelompokkan AI dari isi ulasan |
| Ringkasan | Kalimat dari angka dan kata yang terdeteksi; **tanpa rekomendasi bisnis** | AI Executive Summary dengan rekomendasi |
| Keyakinan | Label bukti: `clear`, `low_evidence`, `ambiguous`, `no_evidence` (tanpa angka keyakinan karangan) | Skor keyakinan model |

AI tidak pernah dipakai sebagai cadangan otomatis untuk Code-Based. Tanpa API key, pilihan AI-Based dinonaktifkan dengan penjelasan.

## Cara kerja Code-Based

1. **Normalisasi:** huruf kecil, slang dilipat ke satu ejaan (`gak/nggak/tdk` → `tidak`, `bgt` → `banget`), huruf berulang dipadatkan (`bagussss` → `bagus`).
2. **Tokenisasi:** kata dan emoji; tanda baca memecah klausa.
3. **Deteksi bahasa:** `id` / `en` / `mixed` / `unknown`, dari kata fungsi.
4. **Skor:** frasa dicocokkan dulu (`tidak sesuai harapan`, `worth it`, `never again`), lalu kata tunggal. Setiap temuan diproses aturan berikut:
   - **negasi** membalik arah (`tidak ramah`, `not friendly`); keluhan yang dinegasi menjadi pujian ringan (`not bad`, lebih kuat dengan `at all`);
   - **penguat** memperkuat, baik sebelum (`sangat`, `really`) maupun sesudah (`banget`, `sekali`, `parah`);
   - **pelemah** melunakkan (`agak`, `lumayan`);
   - **kontras:** klausa setelah `tapi/namun/but` berbobot ×1,5 dan sebelumnya ×0,7; `cuma/hanya` hanya catatan sampingan; klausa ber-`meskipun/although` berbobot ×0,5.
5. **Klasifikasi:** `compound = sum / √(sum² + 15)`. Nilai ≥ 0,2 positif, ≤ −0,2 negatif, selain itu netral (termasuk campuran yang seimbang).
6. **Aspek:** setiap klausa menandai aspek yang disebutnya sebagai dipuji atau dikeluhkan, menurut skor klausa itu.

Leksikon disusun khusus untuk ATLAS (240+ kata, 80+ frasa). Leksikon terbuka seperti AFINN dan InSet tidak dipakai karena lisensinya tidak dapat diverifikasi. Model NLP lokal (mis. IndoBERT) juga tidak dipakai: ukurannya ratusan MB dan waktu muatnya tidak cocok dengan batas memori dan cold start fungsi serverless Vercel.

Versi engine (`code-1.1.0`) disimpan bersama setiap hasil. Setelah engine diperbarui, Run berikutnya menganalisis ulang hasil Code-Based secara gratis; hasil AI tidak tersentuh.

## Cache

Satu hasil disimpan per **(ulasan, metode)**, dengan hash teks dan versi engine (untuk AI: model yang dipakai). Ulasan yang tidak berubah tidak dianalisis ulang. Ulasan yang diedit dianalisis ulang **per metode, saat metode itu dijalankan**. Ringkasan di-cache per metode, terhadap tanda tangan hasil yang menjadi dasarnya.

## Hasil benchmark (20 Okt 2026)

| Set | n | Akurasi | Macro-F1 | Catatan |
|---|---|---|---|---|
| A — kalimat berlabel (`test/fixtures/sentiment-benchmark-v1.json`) | 120 (40 pos / 38 neu / 42 neg) | 0,875 | 0,872 | Ditulis dan diberi label oleh penyusun leksikon, jadi **hasilnya optimis**. |
| B — ulasan asli Alluderma (data lokal, teks tidak di repo) | 173 | recall positif 0,977 sebelum perbaikan kosakata (1,000 sesudahnya) | — | Semua ulasan positif, jadi kelas netral dan negatif **tidak teruji** di set ini. |

AI-Based belum dibandingkan secara langsung karena belum ada API key di lingkungan pengujian. Skrip `node scripts/sentimentBenchmark.js <labels.json> --ai` dapat menilai hasil AI yang tersimpan setelah ada run AI.

Untuk evaluasi yang bisa dipercaya, dibutuhkan set ulasan asli yang dilabeli manusia, dengan jumlah ulasan negatif dan netral yang memadai (mis. dari beberapa bisnis dengan rating campuran).

## Keterbatasan Code-Based

- **Sarkasme** dibaca apa adanya ("Bagus banget, 2 jam nunggu 🙄"). Kalimat seperti ini biasanya bertanda `ambiguous`, tetapi tidak pasti dibaca negatif.
- **Slang baru atau tidak umum**, salah ketik berat, dan kata di luar leksikon tidak dihitung.
- **Makna dari konteks**, tanpa kata sentimen, tidak terbaca ("2 jam baru dipanggil" → netral).
- Kalimat informatif yang bernada positif ringan ("Ok", "Cukup") cenderung dibaca positif.
- Taksonomi aspek bersifat umum untuk bisnis jasa. Kategori di luar daftar tidak muncul sebagai topik.

Ulasan bertanda `low_evidence`, `ambiguous`, atau `no_evidence` ditandai "perlu cek", "campuran", atau "tanpa kata sentimen" di Reviews Explorer. Untuk kasus seperti ini, AI-Based biasanya lebih akurat.
