import useSessionState from '../../../hooks/useSessionState.js';
import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
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
// filter (Active / Inactive / …) sits inside the dropdown, with the list it
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

  const client = clients.find((c) => c.id === clientId) ?? null;

  return (
    <div className="client-bar">
      <span className="client-bar-label">Klien</span>
      <ClientAvatar client={client} />
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

// The picked brand's logo (from Brand Setting), its initials when it has
// none, or an empty placeholder before a brand is picked.
function ClientAvatar({ client }: { client: Client | null }) {
  if (!client) {
    return <span className="client-bar-avatar is-empty" aria-hidden="true"><Building2 size={18} /></span>;
  }
  const initials = client.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <span className="client-bar-avatar" aria-hidden="true">
      {client.logoVersion
        ? <img key={client.id} src={`/api/public/brand-logo/${client.id}?v=${client.logoVersion}`} alt="" />
        : initials}
    </span>
  );
}
