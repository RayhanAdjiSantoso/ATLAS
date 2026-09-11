import assert from 'node:assert/strict';
import { hasCoverageOverlap, placePart } from '../src/services/brandLibraryService.js';
import pool from '../src/config/db.js';

const parts = [
  { id: 11, part_index: 1, original_filename: 'Order_01-09.xlsx', dashboard_upload_id: 'old-upload' },
  { id: 12, part_index: 2, original_filename: 'Order_10-20.xlsx', dashboard_upload_id: 'part-two' },
];

assert.deepEqual(placePart(parts, 'Order_01-31.xlsx', 11), {
  partIndex: 1,
  previousUploadId: 'old-upload',
  replaced: true,
});
assert.equal(placePart(parts, 'Order_01-31.xlsx', 99), null);
assert.equal(placePart(parts, 'Order_01-09.xlsx').partIndex, 1);
assert.equal(placePart(parts, 'Order_21-31.xlsx').partIndex, 3);
assert.equal(hasCoverageOverlap([{ day_bitmap: '111000' }], '001111'), true);
assert.equal(hasCoverageOverlap([{ day_bitmap: '111000' }], '000111'), false);

await pool.end();
console.log('PASS: penggantian file menargetkan part lama; file lanjutan mendapat part baru.');
