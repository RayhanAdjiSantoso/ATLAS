import { META_OBJECTIVE_SOURCE_LABEL, type MetaObjectiveKey, type MetaObjectiveSource } from '../../lib/meta';

// Which objective the Non-Boost breakdowns below are reading. Non-Boost is
// not one kind of campaign: a file can carry Sales, Leads and Engagement side
// by side, and each is judged on its own results — a Leads campaign on cost
// per lead, not on average order value. Each campaign's objective comes from
// the Objective column, else its name, else its metrics.

export function MetaObjectivePicker({
  objectives,
  active,
  source,
  onPick,
}: {
  objectives: { key: MetaObjectiveKey; label: string; spend: number | null }[];
  active: MetaObjectiveKey | null;
  source: MetaObjectiveSource | null;
  onPick: (key: MetaObjectiveKey) => void;
  // Read by SectionAccordion: a chooser, not a section, so it never folds.
  alwaysOpen?: boolean;
}) {
  const total = objectives.reduce((a, o) => a + (o.spend ?? 0), 0);
  const many = objectives.length > 1;
  return (
    <div className="sec-block obj-pick">
      <div className="obj-pick-head">
        <div>
          <h3>{many ? 'Breakdown per objective' : `Objective: ${objectives[0]?.label ?? '—'}`}</h3>
          <p>
            {many
              ? 'Non-Boost Post di file ini menjalankan beberapa objective. Pilih satu — Age, Gender, dan Creative di bawah dihitung hanya dari campaign objective itu, dengan metrik yang sesuai.'
              : 'Age, Gender, dan Creative di bawah memakai metrik yang sesuai objective ini.'}
            {source && <> Objective tiap campaign dibaca dari <strong>{META_OBJECTIVE_SOURCE_LABEL[source]}</strong>.</>}
          </p>
        </div>
      </div>
      <div className="obj-pick-list" role={many ? 'tablist' : undefined}>
        {objectives.map((o) => {
          const share = total > 0 && o.spend !== null ? (o.spend / total) * 100 : null;
          const on = o.key === active;
          return (
            <button
              key={o.key}
              type="button"
              role={many ? 'tab' : undefined}
              aria-selected={many ? on : undefined}
              className={`obj-chip${on ? ' is-on' : ''}`}
              disabled={!many}
              onClick={() => onPick(o.key)}
            >
              <span className="obj-chip-label">{o.label}</span>
              <span className="obj-chip-meta">
                {o.spend !== null ? `Rp${Math.round(o.spend).toLocaleString('id-ID')}` : '—'}
                {share !== null && many && <> · {share.toLocaleString('id-ID', { maximumFractionDigits: 1 })}% spend</>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
