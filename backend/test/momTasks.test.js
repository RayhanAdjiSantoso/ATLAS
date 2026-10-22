import test from 'node:test';
import assert from 'node:assert/strict';
import { taskGroups as serverTaskGroups, openTasksOf } from '../src/utils/momTasks.js';
import { taskGroups as clientTaskGroups } from '../../frontend/src/components/mom/momModel.js';

// Parser parity: server and browser copies must agree exactly.
test('backend task parser matches frontend momModel.js', () => {
  const samples = ['Jo:\n- Kirim laporan\n• Revisi iklan\n\nTim Marketing:\nFoto produk', 'tanpa pic\nBudi:\n', '', null, '* satu\nA:\ndua\nA:\ntiga'];
  for (const s of samples) assert.deepEqual(serverTaskGroups(s, 'mil'), clientTaskGroups(s, 'mil'));
});

test('ticked tasks are not counted as open', () => {
  const minute = { meeting_date: '2026-09-12', todo_mil: 'Jo:\nA\nB', todo_client: '', completed_task_keys: ['mil|jo|b'] };
  assert.equal(openTasksOf(minute).length, 1);
});
