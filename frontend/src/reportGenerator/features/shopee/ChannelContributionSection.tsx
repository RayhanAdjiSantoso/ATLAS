import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { fmtPivotVal } from '../../lib/shopeeDeepDivePivot';
import type { ChannelMixEntry } from './shopeeFunnelReport';

// ── Kontribusi Antar Channel Iklan ──────────────────────────────────────────
// Which Shopee ad type (Produk / Toko / Live) pulls its weight. Two 100%
// stacked bars — share of Spend vs share of GMV — plus an efficiency index
// per channel (GMV share ÷ spend share). Index > 1 = the channel returns more
// revenue than its slice of the budget; that, not raw ROAS, is the verdict
// signal (raw ROAS spikes when a low-spend channel happens to land one big
// order).

function pctLabel(v: number): string {
  return `${v.toFixed(v < 10 ? 1 : 0).replace('.', ',')}%`;
}

function StackedBar({ title, entries, valueOf, total }: { title: string; entries: ChannelMixEntry[]; valueOf: (e: ChannelMixEntry) => number; total: number }) {
  return (
    <div className="chan-bar-row">
      <div className="chan-bar-label">{title}</div>
      <div className="chan-bar">
        {entries.map((e) => {
          const share = total > 0 ? (valueOf(e) / total) * 100 : 0;
          if (share <= 0) return null;
          return (
            <div key={e.key} className="chan-seg" style={{ width: `${share}%`, background: e.color }} title={`${e.label} · ${pctLabel(share)}`}>
              {share >= 9 ? pctLabel(share) : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ChannelContributionSection({ mix, periodLabel }: { mix: ChannelMixEntry[]; periodLabel: string }) {
  if (mix.length < 1) return null;

  const totalSpend = mix.reduce((s, e) => s + e.spend, 0);
  const totalGmv = mix.reduce((s, e) => s + e.gmv, 0);

  const rows = mix.map((e) => {
    const spendShare = totalSpend > 0 ? (e.spend / totalSpend) * 100 : 0;
    const gmvShare = totalGmv > 0 ? (e.gmv / totalGmv) * 100 : 0;
    const eff = spendShare > 0 ? gmvShare / spendShare : null;
    return { ...e, spendShare, gmvShare, eff };
  });

  // Most effective = highest efficiency index among channels that actually
  // carry a meaningful slice of the budget (≥ 8%).
  const ranked = rows.filter((r) => r.spendShare >= 8 && r.eff !== null).sort((a, b) => (b.eff ?? 0) - (a.eff ?? 0));
  const best = ranked[0];

  const effTag = (eff: number | null) => {
    if (eff === null) return { text: '—', cls: 'chan-eff-neutral' };
    if (eff >= 1.15) return { text: `${eff.toFixed(2).replace('.', ',')}× · efisien`, cls: 'chan-eff-good' };
    if (eff <= 0.85) return { text: `${eff.toFixed(2).replace('.', ',')}× · kurang efisien`, cls: 'chan-eff-bad' };
    return { text: `${eff.toFixed(2).replace('.', ',')}× · seimbang`, cls: 'chan-eff-neutral' };
  };

  return (
    <div className="sec-block">
      <div className="sec-heading shopee-heading">
        Kontribusi Antar Channel Iklan <span className="sec-badge">periode {periodLabel}</span>
        <SectionDownloadButton />
      </div>
      <div style={{ padding: '1rem 1.4rem 1.4rem' }}>
        {mix.length >= 2 && best ? (
          <div className="chan-verdict">
            <strong>{best.label}</strong> paling efektif — {pctLabel(best.spendShare)} dari spend menghasilkan {pctLabel(best.gmvShare)} dari GMV Ads
            (indeks efisiensi {best.eff!.toFixed(2).replace('.', ',')}×, ROAS {best.roas.toFixed(1).replace('.', ',')}×).
          </div>
        ) : mix.length === 1 ? (
          <div className="chan-verdict">
            Hanya <strong>{mix[0].label}</strong> yang punya data periode ini — ROAS {mix[0].roas.toFixed(1).replace('.', ',')}×. Upload Iklan Toko / Iklan Live
            untuk membandingkan kontribusi antar channel.
          </div>
        ) : null}

        <div className="chan-legend">
          {mix.map((e) => (
            <span key={e.key} className="chan-legend-item">
              <span className="chan-legend-dot" style={{ background: e.color }} />
              {e.label}
            </span>
          ))}
        </div>

        <StackedBar title="Distribusi Spend" entries={mix} valueOf={(e) => e.spend} total={totalSpend} />
        <StackedBar title="Distribusi GMV (Ads)" entries={mix} valueOf={(e) => e.gmv} total={totalGmv} />

        <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
          <table className="kpi-table chan-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Channel</th>
                <th>Spend</th>
                <th>Share Spend</th>
                <th>GMV Ads</th>
                <th>Share GMV</th>
                <th>ROAS</th>
                <th style={{ textAlign: 'left' }}>Indeks Efisiensi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tag = effTag(r.eff);
                return (
                  <tr key={r.key}>
                    <td style={{ textAlign: 'left', fontWeight: 700 }}>
                      <span className="chan-legend-dot" style={{ background: r.color, display: 'inline-block', marginRight: 6 }} />
                      {r.label}
                    </td>
                    <td>{fmtPivotVal(r.spend, 'rp')}</td>
                    <td>{pctLabel(r.spendShare)}</td>
                    <td>{fmtPivotVal(r.gmv, 'rp')}</td>
                    <td>{pctLabel(r.gmvShare)}</td>
                    <td>{r.roas.toFixed(1).replace('.', ',')}×</td>
                    <td style={{ textAlign: 'left' }}>
                      <span className={`chan-eff ${tag.cls}`}>{tag.text}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="empty-note" style={{ paddingTop: '.7rem' }}>
          Indeks efisiensi = share GMV ÷ share spend. Di atas 1,00× berarti channel menghasilkan porsi omzet lebih besar dari porsi budget-nya.
          Dipakai sebagai penilai utama, bukan ROAS mentah, karena ROAS bisa melonjak saat channel ber-spend kecil kebetulan menutup 1 order besar.
        </div>
      </div>
    </div>
  );
}
