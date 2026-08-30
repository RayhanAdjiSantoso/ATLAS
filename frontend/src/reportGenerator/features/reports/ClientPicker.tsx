import { useEffect, useState } from 'react';
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
          <select className="custom-col-select" value={clientId ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— pilih klien —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
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
