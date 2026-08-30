# ATLAS — Shopee Seller Analytics (PERN Stack)

Aplikasi web untuk mengimpor data ekspor Shopee (Order, Performance Overview, Product Performance) ke PostgreSQL dan mengelola upload dengan autentikasi RBAC.

## Arsitektur

```
web2/
├── backend/          # Express.js REST API + ETL import (Node.js)
├── frontend/         # React + Vite
├── migrations/       # App-layer tables (users, brands, uploads)
└── schema.sql        # Shopee analytics schema (shopee.*)
```

## Prasyarat

- Node.js 18+
- PostgreSQL dengan database `atlas_FIN`
- Schema `shopee` sudah dibuat (`psql -d atlas_FIN -f schema.sql`)

## Setup

```bash
# 1. Install dependencies
npm run install:all

# 2. Konfigurasi backend
cp backend/.env.example backend/.env
# Sesuaikan DATABASE_URL jika perlu

# 3. Jalankan migrasi app layer + seed user demo
npm run migrate
npm run seed

# 4. Jalankan development
npm run dev:backend   # http://localhost:5001
npm run dev:frontend  # http://localhost:5173
```

## Akun Demo

| Role  | Email               | Password    |
|-------|---------------------|-------------|
| Admin | admin@atlas.local   | admin12345  |
| User  | user@atlas.local    | user12345   |

## API Endpoints

| Method | Endpoint           | Deskripsi                    |
|--------|--------------------|------------------------------|
| POST   | /api/auth/register | Registrasi user              |
| POST   | /api/auth/login    | Login (JWT)                  |
| POST   | /api/auth/logout   | Logout                       |
| GET    | /api/auth/me       | Profil user                  |
| POST   | /api/uploads       | Upload & import Excel        |
| GET    | /api/uploads       | History upload (filtered)    |
| GET    | /api/uploads/filters | Opsi filter                |

## Perubahan Desain dari Referensi Python

1. **ETL dipindah ke Node.js** — Logika `import_shopee_data.py` + `lookup_cache.py` di-port ke backend agar satu stack, tanpa dependensi Python runtime.

2. **Tabel app layer (`public`)** — `users`, `brands`, `uploads` ditambahkan untuk auth, tracking upload, dan RBAC. Tidak ada di schema Shopee original.

3. **`brand_id` + `upload_id` pada tabel fakta** — Diperlukan agar multi-brand tidak bentrok pada unique constraint `(report_date, stage_id)` dan `(period_id, product_id)`, serta mendukung filter dashboard per brand.

4. **Periode otomatis** — Order: min/max `Waktu Pesanan Dibuat`; Performance Overview: baris summary `01-06-2026-30-06-2026` atau min/max `Tanggal`; Product Performance: dari upload Performance Overview brand yang sama, atau tanggal di sheet.

5. **Idempotent import** — `ON CONFLICT DO NOTHING` dipertahankan; upload ulang tidak menimpa data existing.

## Pengembangan Selanjutnya

- Dashboard KPI & charts (prompt berikutnya)
- Import sheet tambahan (daily_channel_performance, channel_product_contribution, product_variant_performance)
- Background job queue untuk file besar
