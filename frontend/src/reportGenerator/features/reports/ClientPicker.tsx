import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient, getClients } from './api';
import type { Client } from './types';

interface ClientPickerProps {
  clientId: number | null;
  onChange: (id: number | null) => void;
}

// Brand/client dropdown shown above the platform tabs. "Clients" here map
// 1:1 to ATLAS's public.brands table (GET /api/clients). A brand that
// doesn't exist in ATLAS yet can be created directly from here (POST
// /api/clients inserts into that same table) instead of blocking the user
// until someone adds it there first.
export function ClientPicker({ clientId, onChange }: ClientPickerProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  function loadClients() {
    getClients()
      .then(setClients)
      .catch((err) => setError((err as Error).message));
  }

  useEffect(loadClients, []);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const client = await createClient(name);
      setClients((prev) => [...prev, client].sort((a, b) => a.name.localeCompare(b.name)));
      onChange(client.id);
      setNewName('');
      setAdding(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="client-bar">
      <span className="client-bar-label">Klien</span>
      {!adding ? (
        <>
          <ClientCombo clients={clients} clientId={clientId} onChange={onChange} />
          <span className="mpill mpill-add" onClick={() => setAdding(true)}>
            + Klien baru
          </span>
        </>
      ) : (
        <>
          <input
            className="period-text-input"
            style={{ maxWidth: 220, border: '1.5px solid var(--border)', borderRadius: 8, padding: '.4rem .6rem' }}
            placeholder="Nama klien baru"
            value={newName}
            autoFocus
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') {
                setAdding(false);
                setNewName('');
              }
            }}
          />
          <button className="btn btn-primary" style={{ padding: '.45rem 1rem' }} disabled={creating || !newName.trim()} onClick={handleCreate}>
            {creating ? 'Menyimpan…' : 'Simpan'}
          </button>
          <button
            className="btn btn-ghost"
            style={{ padding: '.45rem 1rem' }}
            onClick={() => {
              setAdding(false);
              setNewName('');
            }}
          >
            Batal
          </button>
        </>
      )}
      {error && <span className="client-bar-error">{error}</span>}
    </div>
  );
}

// Type-to-filter combobox over the client list. Replaces a plain <select>
// that got unwieldy once every ATLAS brand (~140) showed up in it.
function ClientCombo({
  clients,
  clientId,
  onChange,
}: {
  clients: Client[];
  clientId: number | null;
  onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = clients.find((c) => c.id === clientId) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(q));
  }, [clients, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery('');
  }, [open]);

  function pick(id: number | null) {
    onChange(id);
    setOpen(false);
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', minWidth: 220 }}>
      <button
        type="button"
        className="custom-col-select"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', textAlign: 'left' }}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selected ? 'var(--text)' : 'var(--muted)' }}>
          {selected ? selected.name : '— pilih klien —'}
        </span>
        <span style={{ fontSize: '.6rem', color: 'var(--muted)' }}>▼</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 100,
            marginTop: 5,
            minWidth: 240,
            background: 'var(--surface)',
            border: '1.5px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 8px 30px rgba(30,62,184,.12)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '.5rem' }}>
            <input
              ref={inputRef}
              className="saved-modal-search"
              style={{ margin: 0, width: '100%' }}
              placeholder="Cari klien…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
                if (e.key === 'Enter' && filtered.length > 0) {
                  e.preventDefault();
                  pick(filtered[0].id);
                }
              }}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '.5rem .7rem', fontSize: '.76rem', color: 'var(--muted)' }}>Tidak ada klien yang cocok.</div>
            )}
            {filtered.map((c) => (
              <div
                key={c.id}
                onClick={() => pick(c.id)}
                style={{
                  padding: '.45rem .7rem',
                  fontSize: '.8rem',
                  cursor: 'pointer',
                  background: c.id === clientId ? 'var(--acc-100)' : 'transparent',
                  color: c.id === clientId ? 'var(--acc)' : 'var(--text)',
                  fontWeight: c.id === clientId ? 700 : 400,
                }}
              >
                {c.name}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
