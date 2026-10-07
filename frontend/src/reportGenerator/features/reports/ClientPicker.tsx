import useSessionState from '../../../hooks/useSessionState.js';
import { useEffect, useState } from 'react';
import DashboardBrandPicker from '../../../components/dashboard/DashboardBrandPicker.jsx';
import { getClients } from './api';
import type { Client } from './types';

interface ClientPickerProps {
  clientId: number | null;
  onChange: (id: number | null) => void;
}

// Brand/client dropdown shown above the platform tabs. "Clients" here map
// 1:1 to ATLAS's public.brands table (GET /api/clients). Brands are created
// and managed in Pengaturan Brand, so this picker only selects; the status
// filter (Aktif / Nonaktif / …) sits inside the dropdown, with the list it
// narrows.
export function ClientPicker({ clientId, onChange }: ClientPickerProps) {
  const [status, setStatus] = useSessionState('generator:client-status', 'active');
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getClients()
      .then(setClients)
      .catch((err) => setError((err as Error).message));
  }, []);

  return (
    <div className="client-bar">
      <span className="client-bar-label">Klien</span>
      <DashboardBrandPicker
        id="report-brand"
        brands={clients.map((client) => ({ brand_id: client.id, brand_name: client.name, status: client.status }))}
        value={clientId}
        onChange={(id) => onChange(Number(id))}
        status={status}
        onStatusChange={setStatus}
        placeholder="Pilih klien…"
        resultHint="Pilih untuk membuat laporan"
      />
      {error && <span className="client-bar-error">{error}</span>}
    </div>
  );
}
