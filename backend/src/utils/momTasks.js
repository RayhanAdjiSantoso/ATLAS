// Server copy of frontend/src/components/mom/momModel.js#taskGroups.
//
// It exists so the sidebar badge can count overdue tasks without shipping
// every meeting note to every page load. The API bundle (api/index.mjs ->
// backend/src) cannot import from frontend/, so the rule is duplicated
// rather than shared — and backend/tests/control-center.unit.mjs asserts both
// copies produce identical groups and keys, so they cannot drift silently.
// The key format is load-bearing: completed_task_keys stored in
// public.brand_minutes are matched against it.

export const splitLines = (value) => (value ?? '').split('\n').map((line) => line.trim()).filter(Boolean);

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

// Every open (not ticked) task of one meeting record, flattened.
export function openTasksOf(minute) {
  const done = new Set(minute.completed_task_keys ?? []);
  return [['mil', minute.todo_mil], ['client', minute.todo_client]].flatMap(([scope, text]) =>
    taskGroups(text, scope).flatMap((group) =>
      group.tasks.filter((task) => !done.has(task.key)).map((task) => ({ ...task, scope, person: group.name }))));
}
