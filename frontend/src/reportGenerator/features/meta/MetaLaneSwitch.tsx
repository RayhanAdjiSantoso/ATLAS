import type { NonBoostLane, NonBoostLaneKey } from './metaReport';

// Non-Boost Post read one lane at a time: Retail (sells — purchase funnel) or
// B2B Leads (collects leads — form leads or chats). Sits above whichever
// section is open, and says how the campaigns were placed, so a reader who
// disagrees knows which lever to pull (campaign name, objective, Industry).

const BASIS: Record<NonBoostLane['basis'], string> = {
  name: 'nama campaign',
  objective: 'objective campaign',
  industry: 'pilihan Industri di form',
};

export function MetaLaneSwitch({
  lanes,
  active,
  onPick,
}: {
  lanes: NonBoostLane[];
  active: NonBoostLaneKey;
  onPick: (k: NonBoostLaneKey) => void;
  // Read by SectionAccordion: context for every section, not a section.
  alwaysOpen?: boolean;
}) {
  const current = lanes.find((l) => l.key === active) ?? lanes[0];
  return (
    <div className="lane-switch">
      <div className="lane-switch-tabs" role="group" aria-label="Lajur Non-Boost">
        {lanes.map((l) => (
          <button key={l.key} type="button" className={`lane-tab${l.key === current.key ? ' is-on' : ''}`} aria-pressed={l.key === current.key} onClick={() => onPick(l.key)}>
            <strong>{l.label}</strong>
            <small>{l.key === 'retail' ? 'Purchase funnel' : 'Leads & chat'}</small>
          </button>
        ))}
      </div>
      <p className="lane-switch-note">
        <strong>{current.label}</strong>
        {current.objectives.length ? <> · objective {current.objectives.join(', ')}</> : null} — dipetakan otomatis dari {BASIS[current.basis]}.
        {lanes.length < 2 && <> Semua campaign Non-Boost periode ini masuk lajur ini.</>} Urutan aturan: nama campaign (B2B / Lead / Retail) → objective (Sales →
        Retail; Leads atau Send Message → B2B Leads) → Industri di form.
      </p>
    </div>
  );
}
