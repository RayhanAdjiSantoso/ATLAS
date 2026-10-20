// Google Reviews › where businesses and reviews come from.
//
// A source is an adapter with this shape (all methods async):
//
//   id, label
//   coverage        'full'    — can page through every public review
//                   'limited' — returns only a sample (say so on the page)
//   coverageNote    one line for the page when coverage is limited
//   retentionDays   how long its reviews may be stored (null = no limit
//                   under its terms); the service sets expires_at from it
//   searchBusinesses(query) → [{ placeId, name, address, category,
//                               rating, totalReviews, mapsUrl }]
//   getBusiness(placeId)    → one of the above, or null
//   fetchReviewsPage({ placeId, cursor, onProgress })
//                           → { reviews, nextCursor, business?, notice? }
//                             newest first; nextCursor null when there is no
//                             more. business: fresh info read on the way;
//                             notice: one line on what could not be read.
//     review: { externalId, reviewerName, rating (1–5|null), date (ISO|null),
//               datePrecision (null exact | day|week|month|year), text,
//               language, ownerResponse, ownerResponseDate }
//     onProgress(phase): 'init' | 'open' | 'load' | 'collect', optional
//   endCollection(placeId)  optional: the run has finished collecting
//   An error with fatal: true ends the run at once (a block, a missing
//   browser) instead of being retried.
//
// Searching and reviews may come from different sources (e.g. Places API
// for search, another provider for the reviews), so the two are configured
// separately.
//
// No paid source is wired in: each needs a key and a go-ahead first. Until a
// source is chosen the page says it is not set up instead of showing anything
// that was not really collected.

import { createPlaywrightProvider } from './playwright.js';

const registry = { search: null, reviews: null };

// GOOGLE_REVIEWS_PROVIDER picks the source at start-up, so swapping it for an
// official API or a paid provider later touches nothing but this switch.
//   playwright — experimental, local development only (providers/playwright.js)
// Unset: no source; the page says so.
function fromEnv() {
  const choice = String(process.env.GOOGLE_REVIEWS_PROVIDER || '').trim().toLowerCase();
  if (choice === 'playwright') {
    const p = createPlaywrightProvider();
    registry.search = p;
    registry.reviews = p;
  } else if (choice) {
    console.warn(`[google-reviews] GOOGLE_REVIEWS_PROVIDER="${choice}" tidak dikenal; sumber tidak diaktifkan.`);
  }
}
// Read on first use rather than at import, so .env has been loaded by then.
let configured = false;
const ensure = () => {
  if (!configured) {
    configured = true;
    fromEnv();
  }
};

export function registerProviders({ search, reviews }) {
  ensure();
  if (search !== undefined) registry.search = search;
  if (reviews !== undefined) registry.reviews = reviews;
}

export const getSearchProvider = () => { ensure(); return registry.search; };
export const getReviewsProvider = () => { ensure(); return registry.reviews; };

// The candidates the page lists when nothing is configured, and the env vars
// each would need. Informational — nothing here makes a request.
export const CANDIDATE_SOURCES = [
  {
    id: 'google_places',
    label: 'Google Places API (New)',
    role: 'Pencarian bisnis + info (rating, total ulasan)',
    env: ['GOOGLE_PLACES_API_KEY'],
    note: 'Resmi. Hanya mengembalikan maks. 5 ulasan per bisnis, dan konten selain Place ID tidak boleh disimpan permanen.',
  },
  {
    id: 'business_profile',
    label: 'Google Business Profile API',
    role: 'Semua ulasan — hanya bisnis yang dikelola/diotorisasi',
    env: ['GBP_CLIENT_ID', 'GBP_CLIENT_SECRET'],
    note: 'Resmi dan gratis, tapi perlu persetujuan akses API dari Google dan OAuth dari akun pengelola lokasi. Tidak bisa untuk kompetitor.',
  },
  {
    id: 'playwright',
    label: 'Google Maps lewat Playwright (eksperimen)',
    role: 'Pencarian + ulasan yang terlihat tanpa login (±5 per bisnis)',
    env: ['GOOGLE_REVIEWS_PROVIDER=playwright'],
    note: 'Hanya untuk development lokal. Google membatasi pengunjung yang tidak login; tidak berjalan di Vercel.',
  },
  {
    id: 'third_party',
    label: 'Penyedia data pihak ketiga (SerpApi / Outscraper / Apify)',
    role: 'Pencarian + semua ulasan publik, dengan tanggal dan balasan pemilik',
    env: ['GR_PROVIDER_API_KEY'],
    note: 'Berbayar per pemakaian. Penyedia yang mengambil data dari Google Maps; perlu ditinjau ketentuan layanannya.',
  },
];
