// Pure-logic tests for Pusat Kendali and monthly targets. No database.
//   node tests/control-center.unit.mjs
import { taskGroups as serverTaskGroups, openTasksOf } from '../src/utils/momTasks.js';
import { taskGroups as clientTaskGroups } from '../../frontend/src/components/mom/momModel.js';
import { buildCompleteness, datasetState, expectedDaysFor, countOpenTasks } from '../src/services/controlCenterService.js';
import { daysBetween, monthBounds, shiftMonth, todayJakarta } from '../src/utils/monthPeriod.js';

let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} - ${msg}`); if (!cond) failed += 1; };
const bitmap = (days, from, to) => Array.from({ length: days }, (_, i) => (i + 1 >= from && i + 1 <= to ? '1' : '0')).join('');

// Parser parity: server and browser copies must agree exactly.
const samples = ['Jo:\n- Kirim laporan\n• Revisi iklan\n\nTim Marketing:\nFoto produk', 'tanpa pic\nBudi:\n', '', null, '* satu\nA:\ndua\nA:\ntiga'];
ok(samples.every((s) => JSON.stringify(serverTaskGroups(s, 'mil')) === JSON.stringify(clientTaskGroups(s, 'mil'))), 'parser tugas backend identik dengan momModel.js frontend');

// Month helpers
ok(monthBounds('2024-02').days === 29 && monthBounds('2026-09').end === '2026-09-30', 'monthBounds: kabisat & akhir bulan');
ok(shiftMonth('2026-01', -2) === '2025-11' && shiftMonth('2026-12', 1) === '2027-01', 'shiftMonth melewati batas tahun');
ok(todayJakarta(Date.parse('2026-08-31T18:30:00Z')) === '2026-09-01', 'todayJakarta: 01:30 WIB sudah tanggal 1');
ok(daysBetween('2026-09-04', '2026-09-15') === 11, 'daysBetween 4→15 Sep = 11');

// Expected coverage
ok(expectedDaysFor('2026-08', '2026-09-15') === 31, 'bulan lalu: harus tercakup penuh');
ok(expectedDaysFor('2026-09', '2026-09-15') === 14, 'bulan berjalan: sampai kemarin (14)');
ok(expectedDaysFor('2026-10', '2026-09-15') === 0, 'bulan depan: belum diharapkan');

// Dataset state
const opts = { days: 30, expectedDays: 14 };
ok(datasetState([], opts).state === 'missing', 'tanpa file saat sudah diharapkan → missing');
ok(datasetState([], { days: 30, expectedDays: 0 }).state === 'upcoming', 'tanpa file di bulan depan → upcoming, bukan masalah');
ok(datasetState([{ channel: 'order', import_status: 'failed', day_bitmap: bitmap(30, 1, 14) }], opts).state === 'failed', 'impor dashboard gagal → failed');
ok(datasetState([{ channel: 'order', import_status: 'success', dashboard_upload_id: 'x', day_bitmap: bitmap(30, 1, 14) }], opts).state === 'complete', 'order terimpor & tercakup 1–14 → complete');
ok(datasetState([{ channel: 'produk', period_source: 'mismatch', day_bitmap: null }], opts).state === 'mismatch', 'salah periode → mismatch');
const split = datasetState([{ channel: 'produk', day_bitmap: bitmap(30, 1, 7) }, { channel: 'produk', day_bitmap: bitmap(30, 8, 14) }], opts);
ok(split.state === 'complete' && split.coveredDays === 14, 'dua part 1–7 + 8–14 digabung → complete 14 hari');
const gap = datasetState([{ channel: 'produk', day_bitmap: bitmap(30, 1, 10) }], opts);
ok(gap.state === 'partial' && gap.missingDays === 4, 'hanya 1–10 → partial, 4 hari kurang');
ok(datasetState([{ channel: 'product_performance', import_status: 'success', dashboard_upload_id: 'x', day_bitmap: null }], opts).state === 'complete', 'snapshot bulanan tanpa tanggal → complete');

// Brand roll-up
const report = buildCompleteness({
  month: '2026-09', today: '2026-09-15',
  brands: [{ brand_id: 1, brand_name: 'Aman', status: 'active' }, { brand_id: 2, brand_name: 'Bolong', status: 'active' }, { brand_id: 3, brand_name: 'Sepi', status: 'active' }],
  files: [
    { brand_id: 1, platform: 'shopee', channel: 'produk', month: '2026-08', day_bitmap: bitmap(31, 1, 31) },
    { brand_id: 1, platform: 'shopee', channel: 'produk', month: '2026-09', day_bitmap: bitmap(30, 1, 14) },
    { brand_id: 2, platform: 'shopee', channel: 'produk', month: '2026-08', day_bitmap: bitmap(31, 1, 31) },
    { brand_id: 2, platform: 'meta', channel: 'meta', month: '2026-07', day_bitmap: bitmap(31, 1, 31) },
    { brand_id: 2, platform: 'shopee', channel: 'product_master', month: null },
  ],
});
const byName = Object.fromEntries(report.brands.map((b) => [b.brand_name, b]));
ok(byName.Aman.status === 'complete', 'brand dengan data bulan ini lengkap → complete');
ok(byName.Bolong.status === 'attention' && byName.Bolong.datasets.length === 2, 'brand tanpa upload September (Meta & Shopee pernah ada) → attention, 2 dataset diharapkan');
ok(byName.Bolong.datasets.find((d) => d.channel === 'produk').lastMonthWithData === '2026-08', 'dataset hilang mencatat bulan terakhir berisi data');
ok(byName.Sepi.status === 'idle', 'brand tanpa riwayat upload → idle (tidak dituduh kurang data)');
ok(report.brands[0].brand_name === 'Bolong', 'yang butuh tindakan diurutkan paling atas');
ok(!byName.Bolong.datasets.some((d) => d.channel === 'product_master'), 'file referensi tidak dihitung sebagai data bulanan');

// Open / overdue tasks
const minutes = [
  { meeting_date: '2026-09-12', todo_mil: 'Jo:\nA\nB', todo_client: '', completed_task_keys: ['mil|jo|b'] },
  { meeting_date: '2026-09-01', todo_mil: '', todo_client: 'Tim:\nC\nD', completed_task_keys: [] },
];
ok(openTasksOf(minutes[0]).length === 1, 'tugas yang sudah dicentang tidak dihitung terbuka');
const counts = countOpenTasks(minutes, { today: '2026-09-15' });
ok(counts.open === 3 && counts.overdue === 2, `terbuka 3, tertunda >7 hari 2 (dapat ${counts.open}/${counts.overdue})`);

console.log(failed ? `\n${failed} gagal` : '\nsemua lulus');
process.exit(failed ? 1 : 0);
