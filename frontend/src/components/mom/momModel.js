// One reading of a Minutes of Meeting record, shared by the editor in
// Pengaturan Brand and the workspace in Business Overview. Both pages used to
// carry their own copy of the labels and date formatting; the task parser only
// existed on the dashboard, so the editor could not show what the dashboard
// would make of the text being typed.

export const MOM_TYPES = [
  { value: 'regular', label: 'Meeting reguler', description: 'Pertemuan terjadwal dengan klien' },
  { value: 'non_regular', label: 'Meeting non reguler', description: 'Pertemuan tambahan di luar jadwal' },
  { value: 'whatsapp_quick_call', label: 'WhatsApp (quick call)', description: 'Panggilan singkat atau diskusi cepat' },
];
export const MOM_TYPE_LABELS = Object.fromEntries(MOM_TYPES.map((type) => [type.value, type.label]));

const pad = (n) => String(n).padStart(2, '0');
// Local calendar date, not toISOString(): in WIB anything before 07:00 is still
// "yesterday" in UTC, which pre-filled the editor with the wrong day.
export const todayISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

export const emptyMinute = () => ({ meeting_date: todayISO(), meeting_type: 'regular', meeting_recap: '', todo_client: '', todo_mil: '' });

export const parseISO = (value) => {
  if (!value) return null;
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const dateLabel = (value, options = { day: '2-digit', month: 'short', year: 'numeric' }) =>
  value ? parseISO(value).toLocaleDateString('id-ID', options) : '—';
export const longDateLabel = (value) => dateLabel(value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const splitLines = (value) => (value ?? '').split('\n').map((line) => line.trim()).filter(Boolean);

// A line ending in a colon names a PIC; the lines under it are that person's
// tasks; anything before the first heading belongs to "Tanpa PIC". The key is
// scope + PIC + text so completion survives edits to other parts of the record
// (see migration 021) — and, by the same token, rewording a task resets it.
export function taskGroups(value, scope) {
  const groups = [];
  let current = { name: 'Tanpa PIC', tasks: [] };
  for (const raw of splitLines(value)) {
    const clean = raw.replace(/^[-•✓*]\s*/, '');
    if (/^[^:]{1,60}:$/.test(clean)) {
      if (current.tasks.length) groups.push(current);
      current = { name: clean.slice(0, -1).trim(), tasks: [] };
    } else if (clean) {
      current.tasks.push({ text: clean, key: `${scope}|${current.name}|${clean}`.toLowerCase() });
    }
  }
  if (current.tasks.length) groups.push(current);
  return groups;
}

export function taskStats(minute) {
  const done = new Set(minute?.completed_task_keys ?? []);
  const all = [...taskGroups(minute?.todo_mil, 'mil'), ...taskGroups(minute?.todo_client, 'client')].flatMap((group) => group.tasks);
  return { total: all.length, done: all.filter((task) => done.has(task.key)).length };
}

export const recapPreview = (text, length = 140) => {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length).trimEnd()}…` : flat;
};

// A task is "tertunda" once its meeting is more than a week old and it is
// still unticked. The same threshold drives the dashboard tag, Pusat Kendali
// and the sidebar badge (backend/src/services/controlCenterService.js).
export const OVERDUE_DAYS = 7;

export function daysSince(fromISO, toISO = todayISO()) {
  if (!fromISO) return 0;
  const from = Date.parse(`${fromISO.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toISO.slice(0, 10)}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}
