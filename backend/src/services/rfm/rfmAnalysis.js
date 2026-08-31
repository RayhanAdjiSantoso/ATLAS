import { buildKMeansScore, capOutliersPercentile } from './kmeansScoring.js';

/** Business segmentation rules on 1-5 R/F/M scores -- ported from assign_segment_generic() in the notebook. */
export function assignSegment(r, f, m) {
  if (r >= 4 && f >= 4 && m >= 4) return 'Champions';
  if (r >= 3 && f >= 4 && m >= 3) return 'Loyal Customers';
  if (r >= 4 && f >= 2 && f <= 3 && m >= 2) return 'Potential Loyalist';
  if (r >= 4 && f <= 2 && m <= 2) return 'New Customers';
  if (r >= 3 && f <= 2 && m <= 3) return 'Promising';
  if (r === 3 && f === 3 && m === 3) return 'Need Attention';
  if (r <= 2 && f >= 3 && m >= 3) return 'At Risk';
  if (r === 1 && f >= 4 && m >= 4) return "Can't Lose Them";
  if (r <= 2 && f <= 2 && m <= 2 && !(r === 1 && f === 1 && m === 1)) return 'Hibernating';
  if (r === 1 && f === 1 && m === 1) return 'Lost';
  return 'Others';
}

// Every possible assignSegment() output, in a fixed display order (roughly
// healthiest to most at-risk). Used to enumerate segments in the API
// response so a segment with zero customers this period still appears
// (count 0, valid data) instead of silently disappearing the way iterating
// only the segments actually present in the scored rows would.
export const RFM_SEGMENTS = [
  'Champions', 'Loyal Customers', 'Potential Loyalist', 'Promising', 'New Customers',
  'Need Attention', 'At Risk', "Can't Lose Them", 'Hibernating', 'Lost', 'Others',
];

// Standard RFM-segment playbook actions -- static business guidance per
// segment (industry-standard mapping, not derived from this brand's data).
// Kept separate from assignSegment()/computeRfmAnalysis() on purpose: this
// is presentation/recommendation content, not scoring logic, and must never
// influence which segment a customer is assigned to.
//
// `description` explains what the segment *means* (its R/F/M profile, per
// assignSegment() above) -- shown in the dashboard's segment table so the
// column reads as "what is this segment" rather than "what to do about it".
// `goal`/`recommendations` are kept for other consumers (e.g. tooltips).
export const SEGMENT_ACTIONS = {
  'Champions': {
    description: 'Pelanggan terbaik: baru saja bertransaksi, paling sering membeli, dan nilai transaksinya paling tinggi.',
    goal: 'Retention dan advocacy',
    recommendations: ['Loyalty program', 'Early access produk baru', 'Personal offer', 'Program referral'],
  },
  'Loyal Customers': {
    description: 'Sering bertransaksi dengan nilai tinggi dan cukup baru aktif, meski belum sekonsisten Champions.',
    goal: 'Retention dan advocacy',
    recommendations: ['Loyalty program', 'Early access produk baru', 'Personal offer', 'Program referral'],
  },
  'Potential Loyalist': {
    description: 'Baru-baru ini bertransaksi dengan frekuensi dan nilai transaksi menengah -- berpotensi menjadi pelanggan loyal.',
    goal: 'Mendorong customer menjadi loyal customer',
    recommendations: ['Reminder repeat purchase', 'Voucher pembelian berikutnya', 'Rekomendasi produk personal', 'Cross-sell'],
  },
  'Promising': {
    description: 'Cukup baru bertransaksi, tapi frekuensi dan nilai transaksinya masih rendah.',
    goal: 'Mendorong customer menjadi loyal customer',
    recommendations: ['Reminder repeat purchase', 'Voucher pembelian berikutnya', 'Rekomendasi produk personal'],
  },
  'New Customers': {
    description: 'Baru pertama kali bertransaksi, dengan frekuensi dan nilai transaksi yang masih rendah.',
    goal: 'Mengubah first-time customer menjadi repeat customer',
    recommendations: ['Onboarding', 'Cross-selling', 'Follow-up setelah transaksi pertama', 'Insentif pembelian kedua'],
  },
  'Need Attention': {
    description: 'Recency, frekuensi, dan nilai transaksi berada di level rata-rata -- berisiko menurun jika dibiarkan.',
    goal: 'Mencegah penurunan lebih lanjut menuju churn',
    recommendations: ['Reminder aktivasi', 'Penawaran bernilai sedang', 'Rekomendasi produk relevan'],
  },
  'At Risk': {
    description: 'Dulu sering bertransaksi dengan nilai tinggi, tapi sudah cukup lama tidak kembali bertransaksi.',
    goal: 'Mengurangi customer churn',
    recommendations: ['Win-back campaign', 'Penawaran khusus', 'Komunikasi personal', 'Rekomendasi berdasarkan histori pembelian'],
  },
  "Can't Lose Them": {
    description: 'Pelanggan bernilai dan frekuensi transaksi tertinggi, namun sudah paling lama tidak bertransaksi lagi.',
    goal: 'Mengurangi churn pada pelanggan bernilai tinggi',
    recommendations: ['Win-back campaign prioritas', 'Penawaran eksklusif', 'Komunikasi personal langsung', 'Survei alasan tidak aktif'],
  },
  'Hibernating': {
    description: 'Sudah lama tidak bertransaksi, dengan frekuensi dan nilai transaksi yang rendah.',
    goal: 'Reaktivasi pelanggan tidak aktif',
    recommendations: ['Kampanye reaktivasi', 'Penawaran diskon signifikan', 'Survei alasan berhenti membeli'],
  },
  'Lost': {
    description: 'Paling lama tidak bertransaksi, dengan frekuensi dan nilai transaksi paling rendah.',
    goal: 'Reaktivasi pelanggan yang sudah lama tidak aktif',
    recommendations: ['Kampanye reaktivasi skala besar', 'Penawaran terbaik', 'Evaluasi ulang worth reaktivasi'],
  },
  'Others': {
    description: 'Kombinasi skor Recency, Frequency, dan Monetary yang tidak sesuai pola segmen standar lainnya.',
    goal: 'Butuh analisis lanjutan',
    recommendations: ['Tinjau profil RFM individual sebelum menentukan strategi'],
  },
};

/**
 * rows: [{ username, recency, frequency, monetary }] already scoped by
 * brand + selected date range (see dashboardRepository.getRfmRawMetrics).
 *
 * Scoring method: K-Means (Tanpa Outlier) -- the notebook's validated
 * default -- i.e. R/F/M are winsorized (1st/99th percentile capping,
 * loosened automatically for low-cardinality columns like Frequency) before
 * clustering into 5 natural-break groups. Segment averages are reported
 * using the RAW (uncapped) values, matching generate_segment_report().
 */
function buildMatrix(scored, scoreKeyA, scoreKeyB) {
  const counts = new Map();
  for (const row of scored) {
    const key = `${row[scoreKeyA]}|${row[scoreKeyB]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => {
    const [aScore, bScore] = key.split('|').map(Number);
    return { aScore, bScore, count };
  });
}

export function computeRfmAnalysis(rows) {
  if (rows.length === 0) {
    return { segments: [], matrices: { rf: [], rm: [], fm: [] }, customersBySegment: {} };
  }

  const recency = rows.map((r) => Number(r.recency));
  const frequency = rows.map((r) => Number(r.frequency));
  const monetary = rows.map((r) => Number(r.monetary));

  const { capped: recencyCapped } = capOutliersPercentile(recency);
  const { capped: frequencyCapped } = capOutliersPercentile(frequency);
  const { capped: monetaryCapped } = capOutliersPercentile(monetary);

  const rScores = buildKMeansScore(recencyCapped, { labelsAscending: false });
  const fScores = buildKMeansScore(frequencyCapped, { labelsAscending: true });
  const mScores = buildKMeansScore(monetaryCapped, { labelsAscending: true });

  const scored = rows.map((row, i) => ({
    username: row.username,
    recency: recency[i],
    frequency: frequency[i],
    monetary: monetary[i],
    rScore: rScores[i],
    fScore: fScores[i],
    mScore: mScores[i],
    segment: assignSegment(rScores[i], fScores[i], mScores[i]),
  }));

  const segmentMap = new Map();
  for (const row of scored) {
    if (!segmentMap.has(row.segment)) {
      segmentMap.set(row.segment, { count: 0, sumRecency: 0, sumFrequency: 0, sumMonetary: 0 });
    }
    const acc = segmentMap.get(row.segment);
    acc.count += 1;
    acc.sumRecency += row.recency;
    acc.sumFrequency += row.frequency;
    acc.sumMonetary += row.monetary;
  }

  const segments = [...segmentMap.entries()]
    .map(([segment, acc]) => ({
      segment,
      customer_count: acc.count,
      avg_recency: Math.round((acc.sumRecency / acc.count) * 100) / 100,
      avg_frequency: Math.round((acc.sumFrequency / acc.count) * 100) / 100,
      avg_monetary: Math.round((acc.sumMonetary / acc.count) * 100) / 100,
    }))
    .sort((a, b) => b.customer_count - a.customer_count);

  const matrices = {
    rf: buildMatrix(scored, 'rScore', 'fScore'),
    rm: buildMatrix(scored, 'rScore', 'mScore'),
    fm: buildMatrix(scored, 'fScore', 'mScore'),
  };

  // Per-segment username list, for the "download user id" export on the
  // segment detail table — the per-customer assignment already exists in
  // `scored` above, just wasn't kept past the aggregation step before.
  const customersBySegment = {};
  for (const row of scored) {
    if (!customersBySegment[row.segment]) customersBySegment[row.segment] = [];
    customersBySegment[row.segment].push(row.username);
  }

  return { segments, matrices, customersBySegment };
}
