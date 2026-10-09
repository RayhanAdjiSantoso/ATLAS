import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import api from '../../api/client.js';

// One channel's ROAS above its analysis — its own sales over the ad spend
// that buys them, from Brand Tracking (the same pairing and source as
// Executive Snapshot's "ROAS per channel", so the two never disagree). Meta
// Ads has no marketplace of its own: its sales land on the website and in
// chat, so its tab reads the Website & Chat pairing.

const GROUP_OF = { shopee: 'shopee', tiktok: 'tiktok', meta: 'web' };
const SPEND_NOTE = {
  shopee: 'Shopee Iklanku + CPAS Shopee',
  tiktok: 'GMV Max + TTAM',
  web: 'Meta Non-Boost + Google Ads → Website & Chat',
};

const x = (v) => (v == null ? '—' : `${v.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`);
const rp = (v) => (v == null ? '—' : `Rp${Math.round(v).toLocaleString('id-ID')}`);

export default function ChannelRoasStrip({ channelId, filters }) {
  const group = GROUP_OF[channelId];
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!group || !filters.brandId) return undefined;
    let alive = true;
    api.get('/dashboard/executive-summary', {
      params: {
        brandId: filters.brandId,
        startDate: filters.startDate,
        endDate: filters.endDate,
        compareStartDate: filters.compare ? filters.compareStartDate : undefined,
        compareEndDate: filters.compare ? filters.compareEndDate : undefined,
      },
    }).then(({ data: d }) => {
      if (!alive) return;
      const pick = (period) => period?.channelRoas?.find((r) => r.key === group) ?? null;
      setData({ cur: pick(d.current), prev: pick(d.compare), blended: d.current?.totals?.roas ?? null });
    }).catch(() => alive && setData(null));
    return () => { alive = false; };
  }, [group, filters.brandId, filters.startDate, filters.endDate, filters.compare, filters.compareStartDate, filters.compareEndDate]);

  if (!group || !data) return null;
  const { cur, prev, blended } = data;
  const ch = cur?.roas != null && prev?.roas ? (cur.roas - prev.roas) / prev.roas : null;

  return (
    <section className="soft-card roas-strip" aria-label="ROAS channel">
      <div className="roas-strip-main">
        <span className="roas-strip-label">ROAS {cur?.label ?? ''} · Brand Tracking</span>
        <strong>{x(cur?.roas)}</strong>
        {ch != null && <b className={ch >= 0 ? 'is-up' : 'is-down'}>{ch >= 0 ? '▲' : '▼'} {Math.abs(ch * 100).toFixed(1)}%</b>}
      </div>
      <dl className="roas-strip-parts">
        <div><dt>Revenue</dt><dd>{rp(cur?.revenue)}</dd></div>
        <div><dt>Ads spend</dt><dd>{rp(cur?.spend)}</dd></div>
        <div><dt>ROAS blended brand</dt><dd>{x(blended)}</dd></div>
      </dl>
      <p className="roas-strip-note">
        Spend: {SPEND_NOTE[group]}. Sumber: <Link to="/brand-tracking">Brand Tracking <ArrowUpRight size={12} aria-hidden="true" /></Link>
      </p>
    </section>
  );
}
