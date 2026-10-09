# Google Ads Intelligence — production runbook

For whoever deploys, monitors or calibrates the Google Ads part of ATLAS.
Rules and thresholds live in `backend/src/services/googleAdsRules.js`
(`RULESET_VERSION`, `CALIBRATION_LOG`). Internal views: Data Brand › Google Ads ›
*Operasional & kalibrasi*, and the Report Generator › Google Ads report in the
*Internal* view.

## Deploy

1. **Back up Neon.** Create a branch (or point-in-time restore point) of the production
   database in the Neon console before anything else.
2. Run the migrations against a copy first if you can (a Neon branch works):
   `cd backend && npm run migrate`. They are additive and idempotent:
   `040`–`042` (datasets, optimisation) and `043` (data quality, finding log, feedback,
   ruleset version columns).
3. Run the same command against production. **If a migration fails, stop** — do not
   deploy the code; the migration runner applies each file in its own transaction.
4. `cd backend && npm test` (unit) and, with a scratch database,
   `GOOGLE_ADS_IT=1 DATABASE_URL=… node --test test/googleAds.integration.test.js`.
5. `cd frontend && npm run build`.
6. Deploy (Vercel builds from the deployed branch).
7. Smoke test after deploy:
   - Data Brand › Google Ads: accounts listed, *Riwayat penarikan* shows runs.
   - Wait for (or trigger a Preview of) the Google Ads Script in one account; check the
     run finishes and *Operasional & kalibrasi* shows a duration and reconciliation rows.
   - Report Generator › Google Ads, last month vs the month before: report loads; the
     Overall page shows *Kesehatan Akun & Data*; JKT shows a critical tracking finding.
   - Download PDF and *Excel (semua tabel)*; the Purchase / Lead counts match the report.
   - Optimasi: *Buat rekomendasi AI* (first real Gemini run) — review before sharing.
   - Alerts list loads; JKT has the no-primary-conversion alert.
8. Data Brand › Google Ads › **Isi arsip Data & file** once per brand.

## Rollback

- **Code:** redeploy the previous Vercel deployment (Vercel › Deployments › Promote).
  The old code ignores the new tables and columns.
- **Database:** the 043 changes are additive; leave them in place on a code rollback.
  Restore the Neon backup only if data itself was damaged.
- **Google Ads Script:** unchanged by this release; no action.

## First 7 days — daily check (≈10 minutes)

Use *Operasional & kalibrasi* per brand.

| Check | Where | Action if wrong |
|---|---|---|
| Sync success rate ≈ 100%, no "Tidak selesai" runs | Runs table | Read the run note; check the script log in the client's Google Ads account |
| Row counts in line with previous days | Runs table | A sudden drop: compare with Google Ads UI before trusting the report |
| Reconciliation: devices / hourly / conversions `Valid` | Rekonsiliasi terakhir | `Tidak konsisten` on conversions: do not use Purchase/Lead numbers until explained |
| Freshness: no `Usang` daily dataset | Report › Kesehatan Akun & Data | Usually a missed script run |
| Critical alerts | Alert list | Tracking alerts stay open until fixed in Google Ads |
| Diagnoses and recommendations | Report (Internal) | Mark each with Useful / Not useful / False positive / Needs more data |
| Gemini errors | Vercel function logs (`/api/google-ads/recommendations`, `/ad-copy`) | Quota or key problems; the report itself still works |

After day 7, write a short summary: sync rate, inconsistencies found, alerts opened,
and the *Performa aturan* table (7 hari).

## Calibration after 7 days

Open *Performa aturan* (7 hari). Focus only on rules that

- fire very often (many triggers, few or no reviews),
- have a high false-positive rate (flagged at ≥ 30% with ≥ 5 reviews),
- produced recommendations that were dismissed or judged too aggressive.

For each change: edit the threshold in `googleAdsRules.js`, bump `RULESET_VERSION`,
add a `CALIBRATION_LOG` entry (rule, old → new, reason with the evidence), run the tests,
deploy. Findings and recommendations keep the version that produced them.

## Calibration after 30 days

Re-check with the 30-day view: CPA / CVR change thresholds, anomaly threshold
(`k`, `kHighVariance`), keyword minimum clicks, negative-keyword threshold,
alert cooldowns per type, confidence penalties and levels. Compare with the review
verdicts, not with impressions of the report.

## Still needs real-data verification

- Gemini recommendations and ad copy on real accounts (internal review of 10–20 first).
- Alert volume per brand per week with the v1.1 cooldowns.
- Whether `RECONCILE` tolerances (1% / 5%) fit Google's normal reporting variance per dataset.
- Confidence levels vs the team's verdicts.
