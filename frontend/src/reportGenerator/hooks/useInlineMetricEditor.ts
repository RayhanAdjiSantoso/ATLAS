import { useState, type DragEvent } from 'react';

// Shared "click name to rename, drag the ☰ handle to reorder" interaction
// used directly on table rows/column headers (KpiTable, DemoBreakdownCard,
// MultiMetricTable) — no separate pill/list control. This hook only owns the
// ephemeral UI state (which id is being edited/dragged); the caller owns
// where the renamed label and the new order actually get stored.
//
// Reorder is triggered ONLY by the dedicated drag handle: `dragHandleProps`
// goes on the ☰ icon (the sole `draggable` element), while `dropZoneProps`
// goes on the whole row / column header so it can still receive the drop.
// The metric name and value are never draggable, so a click — or a
// click-and-hold — on them keeps working as before and never starts a drag.
export function useInlineMetricEditor({ onRename, onReorder }: { onRename: (id: string, newLabel: string) => void; onReorder: (fromId: string, toId: string) => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  function startEdit(id: string, currentLabel: string) {
    setEditingId(id);
    setEditingValue(currentLabel);
  }
  function commitEdit() {
    if (editingId && editingValue.trim()) onRename(editingId, editingValue.trim());
    setEditingId(null);
  }
  function cancelEdit() {
    setEditingId(null);
  }

  function clearDrag() {
    setDragId(null);
    setDragOverId(null);
  }

  // Props for the ☰ drag handle only — the one element that starts a
  // reorder drag.
  function dragHandleProps(id: string) {
    return {
      draggable: true,
      onDragStart: (e: DragEvent) => {
        e.stopPropagation();
        try {
          // Firefox refuses to start a drag unless dataTransfer is set.
          e.dataTransfer.setData('text/plain', id);
          e.dataTransfer.effectAllowed = 'move';
        } catch {
          /* some browsers disallow touching dataTransfer in onDragStart */
        }
        setDragId(id);
      },
      onDragEnd: clearDrag,
    };
  }

  // Props for the row / column header that can receive a drop — never makes
  // the element itself draggable.
  function dropZoneProps(id: string) {
    return {
      onDragOver: (e: DragEvent) => {
        if (dragId === null) return;
        e.preventDefault();
        setDragOverId(id);
      },
      onDragLeave: () => setDragOverId((prev) => (prev === id ? null : prev)),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        if (dragId !== null && dragId !== id) onReorder(dragId, id);
        clearDrag();
      },
      onDragEnd: clearDrag,
    };
  }

  function dragClass(id: string): string {
    let cls = '';
    if (dragId === id) cls += ' dragging';
    if (dragOverId === id && dragId !== null && dragId !== id) cls += ' drag-over';
    return cls;
  }

  return { editingId, editingValue, setEditingValue, startEdit, commitEdit, cancelEdit, dragHandleProps, dropZoneProps, dragClass };
}

// Reorders `order` by moving `fromId` to sit right where `toId` was — shared
// splice logic for every caller's onReorder.
export function reorderIds(order: string[], fromId: string, toId: string): string[] {
  const from = order.indexOf(fromId);
  if (from === -1 || fromId === toId) return order;
  const next = [...order];
  next.splice(from, 1);
  const to = next.indexOf(toId);
  if (to === -1) return order;
  next.splice(to, 0, fromId);
  return next;
}
