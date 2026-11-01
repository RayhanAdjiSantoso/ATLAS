# Presentation Report Builder

The second output of Report Generator: a 16:9 monthly client deck, built from the
same saved reports as the Performance Report and exported to PDF. It lives at
`/report-generator/presentation`. The Performance Report's tabs, calculations and
exports are not changed by it.

## How it fits together

```
report_runs (saved reports)   GET /google-ads/report   GET /daily-tracking/entries
        │ reconstruct*()               │                        │
        ▼                              ▼                        ▼
 MetaReport / ShopeeReport …    GadsReport                Revenue Data
        └──────────────┬───────────────┴────────────────────────┘
                       ▼  data/*Blocks.ts  (no metric is calculated here)
                 Snapshot { blocks, sources, missing }        ← frozen in the draft
                       ▼  plan.ts
        PresentationDocument { config, sections, slides }     ← saved on every edit
                       ▼  slides/SlideView.tsx
              Preview, Review grid, and PDF (one component)
```

Two halves are stored apart on purpose:

- **Document**: what a person decides. Config, section and slide order, layouts,
  narrative, supporting data. Autosaved after 1.2 s without typing.
- **Snapshot**: the figures, computed once and frozen. A deck keeps showing what was
  reviewed even if the source report is saved again. "Perbarui data dari ATLAS" in
  Review refreshes the figures and keeps every slide and every word.

Slides reference blocks by id. A block that does not exist renders "Data not
available" and is listed in Review, so a missing metric cannot become a number.

## Files

| Path | Role |
|---|---|
| `migrations/062_presentation_reports.sql` | Draft and image tables (additive) |
| `backend/src/services/presentationReportService.js` | Draft storage, ownership rule, image checks |
| `backend/src/services/presentationAiService.js` | Narrative drafts and the number check |
| `backend/src/routes/reportGenerator/presentations.js` | API, under `/api/report-generator/presentations` |
| `features/presentation/types.ts` | The data model |
| `features/presentation/data/*` | Existing report objects to snapshot blocks |
| `features/presentation/plan.ts` | Layout registry and the dynamic default deck |
| `features/presentation/slides/*` | Templates, charts, `slides.css` (the design system) |
| `features/presentation/validate.ts` | Review checks, export filter, facts for AI |
| `features/presentation/exportPdf.ts` | PDF export |
| `features/presentation/*Step.tsx`, `PresentationTab.tsx`, `useDraft.ts` | The builder |

## Data mapping

Every percentage change goes through `lib/delta.ts`. Whether a change is good or bad
comes from each report's own sentiment rules.

### Meta Ads (saved run, `reconstructMetaReport`)

The report is read per channel it splits the account into: Boost Post, Non-Boost
(Retail and B2B lanes, or one lane), CPAS.

| Slide content | Source |
|---|---|
| KPI tables | `overview.overviewRows` from `lib/metaOverview.ts` |
| Root Cause Analysis | `boostFunnel`, `lane.funnel`, `cpas.funnel` (`lib/metaFunnel.ts`) |
| Campaign, age, gender | `build{Sales,Brand,B2b}Audience` (`lib/metaAudience.ts`) |
| New Visitor vs Remarketing | `audiences.NV/RM`, `cpas.nv/rm` |
| Top & bottom creative | Audience builders over the Ad column |
| Boost vs Non-Boost | `summary.spend`; CPAS uses `cpasOverall`, which already holds NV and RM |

Metrics shown depend on the channel: selling channels read purchases, cost per
purchase and ROAS; Boost Post reads profile visits and follows; B2B reads leads.
Top & bottom ranks only items with at least 1,000 impressions.

Reach-dependent metrics follow the report's existing rules, including leaving them
out of multi-day Day-breakdown files.

### Shopee Ads (saved run, three `reconstructShopee*` calls)

| Slide content | Source |
|---|---|
| KPI table | Deep-dive `overall` (Product + Shop + Live) |
| Product vs Shop vs Live | Deep-dive `produk`, `toko`, `live` |
| Root Cause Analysis | Funnel report `tree` (Live is excluded; it has no impressions) |
| Per-ad-type analysis | Funnel report `channels[]` |
| Products, traffic, conversion | `produkPivot` |
| Pareto | Ad GMV per product from `produkPivot` (see limitations) |
| Daily trend and store KPIs | Product Overview: whole-store sales, labelled as such |
| Keywords | `keywordPivot` |

Ad-attributed GMV and whole-store sales are separate slides with separate labels.

### TikTok GMV Max (saved run, `reconstructTiktokReport`)

KPI table (Cost, Orders, Cost per Order, Gross Revenue, AOV, ROI), plus the same
metrics per campaign through `calcTiktokMetrics`. The export has no impressions,
clicks or creatives, so those do not appear.

### Google Ads (`fetchReport`, range based)

KPI table, daily clicks, campaigns, keywords, locations. Rates arrive as fractions
and are scaled to percentage points in `googleBlocks.ts`.

### Sales and Channel Revenue (Brand Tracking › Revenue Data)

Same source and totals as the Business Overview tab, limited to the deck's dates. A
channel with no entries is not shown, rather than shown as zero.

### Cross-channel

Ad spend is totalled. Revenue is **not**: Purchase Value, GMV (Ads), Gross Revenue,
Conversion Value and Brand Tracking revenue are different definitions, so each keeps
its own row and label and they are never added together.

## Periods

Each channel has its own period and is included when it has data; there is no deck-wide
period picker and no checkbox per channel.

- **Meta, Shopee, TikTok** offer only reports already generated (reports saved without
  dates are not listed). A new deck picks the newest report overall, then each channel's
  report for those same dates, or that channel's newest. "Tidak dipakai" excludes one.
- **Google Ads and Revenue Data** are live, so their dates are typed. They follow the
  reports' period until edited. A section can still be turned off in Step 2.
- **The deck's period** (cover, footer, file name) is the one most channels use.

When channels disagree, Step 1 and Review warn, each channel's columns use its own period
labels, and overview rows name their period. Total ad spend and spend share are left out,
because adding different periods would mean nothing.

## Data not available

| Situation | What happens |
|---|---|
| Channel has no saved report or data | No slides; shown in Step 1 and Step 2 |
| One analysis cannot be built | Listed in Step 2 with "Isi manual" and, where it applies, "Impor data" |
| Source fails to load | Other sources continue; Review shows an error |
| Block removed after a refresh | Slide shows "Data not available"; Review lists it |
| Saved report's dates differ from the deck | Its columns use its own period labels; Review warns |
| Google Ads or Revenue Data stops before the period ends | Review warns, so a partial month is not read as a real decline |

Offline sales, organic social, activations and client data have no ATLAS source. They
go on Supporting Data slides, entered manually and tagged with their source so they
never read as ATLAS figures. Their change % uses the same `computeDelta`.

## Access

- `authenticate`, `requireModule('report_generator')` and the view-only write block
  come from `reportGeneratorRoutes.js`.
- A draft belongs to its brand's team: anyone who can open the brand can open, edit
  and delete it, within `allowedBrandIds`. Refused requests get the same 404 as a
  missing draft, so ids reveal nothing.
- A `client` account never sees the team's drafts, even if Pengaturan Akses gives
  clients this module, because they hold unfinished internal wording.
- Images are identified by their bytes (PNG, JPG, WebP). SVG is refused because it
  can carry script.

## Working on one deck together

Saves name the revision they build on. When a teammate saved first, `merge.ts`
combines both versions against the one they started from, field by field per slide,
and saves again. Different slides, or different fields of one slide, simply combine.
Only the same field changed differently by both, or an edit to a slide someone else
deleted, stops the save: the builder names the slide and offers the latest version.

Changes from others appear when this person's next save runs or the draft is
reopened; there is no live view of what a teammate is typing.

## AI

AI never runs on its own: only when someone presses a Generate button, and Generate All
asks first, stating how many requests it will use. Building, editing and exporting a
deck use none.

Optional, and uses the existing setup: Claude when `ANTHROPIC_API_KEY` is set, Gemini
otherwise. No key means the buttons are replaced by a note and everything else works.

The browser sends what the slide shows as plain lines, and the model may use only
those numbers. The system prompt forbids invented data and causal claims without
evidence, and tags each point as fact, hypothesis or recommendation. Afterwards
`unmatchedNumbers` checks every number against the facts and the builder marks any
it cannot trace. This catches invented figures, but it cannot judge whether a true
number is used fairly, so a person still reads the draft.

Suggestions sit in their own card. Nothing changes until someone presses "Ganti isi"
or "Tambahkan". Generate All makes one request per slide, to stay inside the
serverless function's 60-second limit.

## PDF export

In the browser, on the html2canvas and jsPDF already bundled. Each slide is captured
from a hidden host at full size and placed on a 1440×810 pt page. A slide that is an
empty narrative is skipped and the Export step says how many.

Three things are deliberate, because html2canvas differs from the browser:

- No `font-variant-numeric` in `slides.css`: tabular digits are measured but
  proportional ones are drawn, which misaligns every number.
- The cover mark is an `<img>`: an inline SVG gradient stroke disappears.
- Supporting images are backgrounds: `object-fit` is not honoured, `background-size` is.

## Tests

```bash
cd backend && node --test test/presentationReports.test.js
cd backend && PRESENTATION_IT=1 node --test test/presentationReports.integration.test.js
cd frontend && npm run test:presentation
```

The integration test creates throw-away brands and accounts and removes them.

## Known limitations

- **PDF pages are images**, so text cannot be selected or searched. A 45-slide deck is
  about 15 MB.
- **Currency is a label.** Only Petite Fleur KL uses MYR. There is no brand setting for
  it: Step 1 defaults from the Google Ads account's currency, and the choice is kept in
  the draft. Values are never converted.
- **Some MYR figures are whole units.** Rows without exact figures are read back from
  rounded display strings and shown without decimals rather than with invented ones.
  Meta overview, Shopee, Google and revenue figures are exact.
- **No store-level Pareto.** Product Performance files are not persisted with a report,
  so Pareto uses ad GMV per product and says so.
- **Meta daily trends are not included.** Saved Meta reports are mostly month breakdowns.
- **Long tables stop at 24 rows** (three slides), with a note saying how many exist.
- **Meta total spend can differ from Summary Overview** for CPAS campaigns not named NV
  or RM: this uses CPAS Overall, while Summary adds only NV and RM.
- **Snapshots are not re-read per chart option.** Picking other metrics means changing
  the slide's data block, not the chart's series.
