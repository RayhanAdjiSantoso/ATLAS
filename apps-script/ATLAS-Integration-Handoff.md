# Handoff ke Claude Code — Integrasi 3 Automasi Meta Ads ke ATLAS

Untuk ditempel/dilampirkan di sesi Claude Code (VSCode) yang sudah punya
konteks repo ATLAS (/Users/rayhanadjisantoso/Desktop/MIL Coding/ATLAS). Berisi: konteks project, kontrak API terpadu, dan
prompt siap pakai di bagian paling bawah.

**Perubahan dari draft sebelumnya:** awalnya cuma "Daily Tracking Boost
Post" yang mau diintegrasikan. Sekarang **digabung dengan 2 automasi lain**
yang sudah lebih dulu jalan di project Apps Script yang sama (Weekly
Campaign Review & Daily Urgent Check) — jadi satu halaman baru di ATLAS
dengan **3 tab**, satu JSON API terpadu untuk ketiganya.

---

## 1. Konteks Project

### Tiga automasi, satu project Apps Script
Semuanya di **satu project Google Apps Script**, bound ke satu
spreadsheet ("Weekly Campaign Review", `CONFIG.SHEET_ID`), 3 file kode:

**a) `Weekly.gs` (v5) — automasi paling lama, sudah production.**
Tiap Senin 09:00 WIB: bandingkan performa campaign 3 hari terakhir vs 3
hari sebelumnya (eskalasi ke 7 hari kalau volume tipis), drill-down ke
adset untuk campaign yang perlu dicek, tulis ke tab "Weekly Campaign
Review" & "Weekly Adset Drilldown", kirim email ringkasan. Entry point:
`weeklyRun()`. Ada `checkTokens()` buat verifikasi token Meta Ads hidup.

**b) `Daily.gs` — pelengkap Weekly, juga production.**
Tiap hari 08:00 WIB: bandingkan kemarin vs rata-rata harian 7 hari
sebelumnya, cuma kirim email kalau ada temuan mendesak (delivery
berhenti / result berhenti / cost per result naik ≥50% / spend naik
≥100%). Ada cooldown 3 hari supaya temuan yang sama tidak spam email
tiap pagi. Entry point: `dailyUrgentCheck()`.

**c) `DailyTrackingBoostPost.gs` — yang paling baru, dikerjakan bareng
di sesi ini.** Multi-brand: tiap hari ~01:00 WIB, isi kolom Boost Post &
kolom non-boost (nama kolomnya beda per brand — brand pertama, Petite
Fleur, menyebutnya "FB Ads") di Google Sheets Daily Tracking tiap brand,
berdasar SUM Amount Spent campaign H-1 yang diklasifikasi lewat nama
campaign (mengandung kata kunci, default `"profile visit"` -> Boost
Post). Idempotent (baris yang sama selalu di-overwrite), aman terhadap
error (sheet tidak pernah ditulis kalau API gagal atau baris tidak
ketemu). Konfigurasi tiap brand disimpan sebagai JSON array di Script
Properties (`DAILY_TRACKING_CONFIGS`), bukan hardcoded. Entry point:
`updateAllDailyTrackingSpend()`. Sudah divalidasi nyata: Petite Fleur
(H-1 = 19 Agustus 2026, Boost Post Rp308.961, FB Ads Rp289.872, 8
campaign) dicocokkan manual ke Ads Manager oleh user, hasilnya benar.

Ketiga file berbagi helper yang sama (didefinisikan di `Weekly.gs`):
`CONFIG` (termasuk `CONFIG.ACCOUNTS` — tiap akun Meta Ads dengan
`client`, `id`, `tokenKey` ke Script Property token-nya), `fetchJson_`,
`fetchInsights_`, `tokenFor_`, `num_`, `tz_`, `openSpreadsheet_`,
`writeLog_`. Ketiganya juga sama-sama menulis ke tab "Automation Log" di
spreadsheet yang sama lewat `writeLog_` — barusan diberi prefix
`[WEEKLY]` / `[DAILY]` / `[TRACKING]` di teks detail-nya supaya bisa
dibedakan sumbernya lewat satu API.

### Yang mau dicapai sekarang
User punya sistem sendiri bernama **ATLAS** (dibangun sendiri, jalan
lokal — konteksnya ada di sesi Claude Code lain, bukan di sini).
Rencana: **1 halaman baru di ATLAS dengan 3 tab** — Weekly, Daily, Daily
Tracking — jadi panel kontrol untuk ketiga automasi ini, menggantikan
kebutuhan buka Google Sheets/Apps Script editor buat memantau/menjalankan
manual.

Arah integrasi:
```
Browser (halaman baru, 3 tab, di ATLAS)
   -> Backend ATLAS (route baru, PERLU DIBUAT)
      -> Apps Script Web App doPost()  [server-to-server, SATU endpoint untuk 3 tab]
         -> Google Sheets + Meta Marketing API
```
**Penting:** frontend ATLAS jangan panggil langsung ke Apps Script Web
App — Apps Script tidak menangani CORS preflight untuk
`Content-Type: application/json`, jadi fetch dari browser kemungkinan
besar gagal. Backend ATLAS yang jadi perantara (panggilan server-to-server
tidak kena CORS).

---

## 2. Kontrak API (`doPost`, sudah jadi & siap dipanggil)

```
POST {WEB_APP_URL}
Content-Type: text/plain        <- WAJIB text/plain, bukan application/json
                                    (soal CORS preflight, lihat di atas)

Body (string, tapi isinya JSON):
{ "action": "...", "apiKey": "...", "payload": { ... } }
```

Response selalu salah satu dari dua bentuk ini:
```json
{ "ok": true,  "data": ... }
{ "ok": false, "error": "pesan error dalam bahasa Indonesia" }
```

### Action bersama (dipakai di ketiga tab)

| action | payload | `data` kalau sukses |
|---|---|---|
| `accounts` | *(tidak perlu)* | array akun Meta Ads: `{ client, id, portfolio, type }` |
| `log` | `{ limit? }` (default 20) | N baris terakhir tab Automation Log: `{ timestamp, durationSec, status, detail }`, terbaru duluan. `detail` diawali `[WEEKLY]`/`[DAILY]`/`[TRACKING]` — **filter tab di frontend berdasar prefix ini** |

### Tab Weekly

| action | payload | efek |
|---|---|---|
| `weeklyRun` | *(tidak perlu)* | **Menjalankan `weeklyRun()` sungguhan** — menulis tab "Weekly Campaign Review" & "Weekly Adset Drilldown", kirim email. Beri konfirmasi di UI sebelum panggil. |
| `weeklyCheckTokens` | *(tidak perlu)* | Cek semua token Meta Ads hidup, `data`: array `{ client, ok, accountName?, currency?, business?, error? }` |

### Tab Daily

| action | payload | efek |
|---|---|---|
| `dailyRun` | *(tidak perlu)* | **Menjalankan `dailyUrgentCheck()` sungguhan** — email cuma terkirim kalau ada temuan (atau ada akun gagal ditarik). Beri konfirmasi di UI. |
| `dailyResetCooldown` | *(tidak perlu)* | Reset cooldown alert — temuan yang sama akan dikirim ulang di run berikutnya. |

### Tab Daily Tracking

| action | payload | `data` kalau sukses |
|---|---|---|
| `trackingList` | *(tidak perlu)* | array semua config brand |
| `trackingSave` | object config (`label, sheetUrl, tabName, headerRow, dateHeader, boostHeader, nonBoostHeader, accountClient, boostMatch, emailOnFailure`; sertakan `id` untuk edit) | object config tersimpan (sudah tervalidasi ke sheet asli — kalau tab/header tidak ketemu, ini yang gagal duluan, pesan error-nya tampilkan apa adanya) |
| `trackingDelete` | `{ id }` | array config yang tersisa |
| `trackingPreview` | `{ id }` | dry run: `{ label, date, row, boostSpend, nonBoostSpend, campaigns, existingBoost, existingNonBoost, status }` — **tidak menulis apa pun** |
| `trackingRunAll` | *(tidak perlu)* | **Menjalankan H-1 untuk SEMUA brand & menulis ke sheet.** Beri konfirmasi di UI. |

Auth: `apiKey` harus cocok dengan Script Property `API_SHARED_KEY`. Kalau
salah/kosong, `doPost` balikin `{ ok: false, error: "apiKey tidak
valid." }` sebelum action apa pun (termasuk yang read-only) dijalankan.

Contoh cepat dari terminal (buat verifikasi manual, bukan dari kode ATLAS):
```bash
curl -X POST "URL_WEB_APP_KAMU" \
  -H "Content-Type: text/plain" \
  -d '{"action":"log","apiKey":"GANTI_DENGAN_KEY_ASLI","payload":{"limit":10}}'
```

---

## 3. Prompt untuk Claude Code

Tempel blok di bawah ini ke Claude Code:

> Saya mau menambahkan **1 halaman baru dengan 3 tab** di ATLAS — Weekly,
> Daily, Daily Tracking — jadi panel kontrol untuk 3 automasi Meta Ads
> yang sudah jalan di Google Apps Script (bukan di ATLAS). Saya cuma mau
> ATLAS jadi panel kontrolnya, bukan pindah logic-nya ke ATLAS.
>
> Konteks lengkap & kontrak API-nya ada di file terlampir
> `ATLAS-Integration-Handoff.md`. Ringkasnya: Apps Script sudah punya
> satu endpoint `doPost()` (JSON API terpadu) dengan 11 action —
> 2 bersama (`accounts`, `log`), 2 untuk Weekly (`weeklyRun`,
> `weeklyCheckTokens`), 2 untuk Daily (`dailyRun`,
> `dailyResetCooldown`), 5 untuk Daily Tracking (`trackingList`,
> `trackingSave`, `trackingDelete`, `trackingPreview`,
> `trackingRunAll`) — semuanya dilindungi `apiKey` yang sama. Saya
> butuh:
>
> 1. **Cek dulu struktur & konvensi ATLAS yang sudah ada** (routing
>    pattern, cara bikin halaman baru + tab, komponen UI yang biasa
>    dipakai, cara nyimpen config/secret) sebelum nulis apa pun, supaya
>    kodenya konsisten dengan yang sudah ada.
> 2. **Route backend baru** di ATLAS yang jadi perantara ke Apps Script
>    Web App itu (server-to-server, bukan dipanggil langsung dari
>    frontend — soal CORS, lihat handoff doc). URL Web App dan `apiKey`
>    disimpan sebagai environment variable, jangan hardcode/ke-commit.
>    Satu route ini bisa dipakai ketiga tab (parameter `action` yang
>    beda-beda), tidak perlu 3 route terpisah.
> 3. **Halaman baru di frontend ATLAS, 3 tab**, dibangun pakai
>    komponen/style ATLAS sendiri:
>    - **Tab Weekly**: tombol "Run Now" (action `weeklyRun`, **minta
>      konfirmasi dulu** — ini beneran nulis sheet & kirim email),
>      tombol "Check Tokens" (action `weeklyCheckTokens`, tampilkan
>      status tiap akun), dan panel log terbaru (action `log`, filter
>      baris yang detail-nya diawali `[WEEKLY]`).
>    - **Tab Daily**: tombol "Run Now" (action `dailyRun`, **minta
>      konfirmasi**), tombol "Reset Cooldown" (action
>      `dailyResetCooldown`), panel log (`[DAILY]`).
>    - **Tab Daily Tracking**: list brand (action `trackingList`), form
>      tambah/edit (action `trackingSave` — dropdown akun dari action
>      `accounts`, tampilkan error dari response apa adanya kalau
>      validasi sheet gagal), tombol Test per brand (action
>      `trackingPreview`, ini dry run — jangan diklaim "tersimpan"),
>      tombol Hapus (`trackingDelete`), tombol "Jalankan Sekarang
>      (Semua Brand)" (`trackingRunAll`, **minta konfirmasi**, ini
>      beneran nulis ke sheet semua brand), panel log (`[TRACKING]`).
>    - Boleh baca `Sidebar.html` yang saya lampirkan sebagai referensi
>      fitur & alur tab Daily Tracking (jangan disalin HTML-nya
>      mentah-mentah, bangun ulang pakai komponen ATLAS).
>
> Tanya saya dulu kalau ada bagian yang ambigu (terutama soal di mana
> baiknya route & halaman baru ini ditaruh mengikuti struktur folder
> ATLAS yang sudah ada, dan apakah 1 route backend cukup atau perlu
> dipecah), jangan asumsi sendiri untuk hal yang berdampak ke struktur
> project.
