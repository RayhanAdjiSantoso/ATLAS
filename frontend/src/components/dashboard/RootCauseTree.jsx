import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { ChevronRight, Crosshair, Maximize2, Minimize2, TriangleAlert } from 'lucide-react';
import { InfoTip } from './figures.jsx';

// Root Cause Analysis — GMV decomposition drawn as an actual tree.
//
// GMV sits on the left; each node's drivers branch off to its right, joined by
// the operator that relates them (Orders × AOV, Budget ÷ CPM …), so the page
// reads the way an analyst sketches a root-cause tree on a whiteboard. With a
// comparison period every card carries its previous value and change, and the
// card's edge takes the colour of that change — scanning for the red branch
// IS the root-cause reading.
//
// The backend hands one tree per period with identical node ids; the compare
// tree is indexed by id and zipped in per node.
//
// Interactions:
//   - the +n / − tab on a card expands or collapses its drivers
//   - the card title re-roots the view on that branch (breadcrumb back to GMV)
//   - a "temuan" chip opens the path to that node and flashes it

const idFmt = new Intl.NumberFormat('id-ID');

function fmtValue(value, unit) {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  switch (unit) {
    case 'idr':
    case 'idr_per_unit':
      return `Rp ${idFmt.format(Math.round(num))}`;
    case 'percent':
      return `${idFmt.format(Number((num * 100).toFixed(2)))}%`;
    case 'unit_per_order':
      return `${idFmt.format(Number(num.toFixed(2)))} unit`;
    case 'ratio':
      return `${idFmt.format(Number(num.toFixed(2)))}×`;
    default:
      return idFmt.format(Math.round(num));
  }
}

// Report Generator's computeDelta rule: prev 0 + cur 0 -> flat; prev 0 + cur > 0
// -> "Baru"; a missing side -> no delta.
function computeDelta(vCur, vOld) {
  if (vOld == null || vCur == null) return null;
  if (vOld === 0) {
    if (vCur === 0) return { num: 0, str: '0%' };
    return vCur > 0 ? { num: null, str: 'Baru' } : null;
  }
  const num = ((vCur - vOld) / Math.abs(vOld)) * 100;
  return { num, str: `${num >= 0 ? '+' : ''}${idFmt.format(Number(num.toFixed(1)))}%` };
}

function toneOf(delta) {
  if (!delta || delta.num == null) return 'none';
  if (Math.abs(delta.num) < 0.5) return 'flat';
  return delta.num > 0 ? 'up' : 'down';
}

// The symbol on the connector between a node and its drivers.
function operatorOf(formula) {
  if (!formula) return null;
  if (formula.includes('×')) return '×';
  if (formula.includes('÷') || formula.includes('/')) return '÷';
  if (formula.includes('Σ') || formula.includes('+')) return '+';
  return null;
}

const DEFAULT_OPEN_DEPTH = 2;

function defaultOpen(tree) {
  const s = new Set();
  (function walk(node, depth) {
    if (!node) return;
    if (depth < DEFAULT_OPEN_DEPTH && node.children?.length) s.add(node.id);
    for (const c of node.children || []) walk(c, depth + 1);
  })(tree, 0);
  return s;
}

function allBranchIds(tree) {
  const s = new Set();
  (function walk(node) {
    if (!node) return;
    if (node.children?.length) s.add(node.id);
    for (const c of node.children || []) walk(c);
  })(tree);
  return s;
}

function indexById(node, map) {
  if (!node) return map;
  map.set(node.id, node);
  for (const c of node.children || []) indexById(c, map);
  return map;
}

function pathTo(tree, id) {
  const out = [];
  (function find(node, trail) {
    if (!node) return false;
    const t = [...trail, node];
    if (node.id === id) { out.push(...t); return true; }
    return (node.children || []).some((c) => find(c, t));
  })(tree, []);
  return out;
}

// Nodes with a value in both periods, for the "temuan utama" ranking. A node
// that was a sliver of its parent last period (an ad type going from 32 to a
// million impressions) produces an enormous percentage that explains nothing
// about the parent, so anything under 2% of its same-unit parent is left out.
const MIN_SHARE_OF_PARENT = 0.02;

function collectMovers(node, compareMap, trail, out, parent = null) {
  if (!node) return;
  const path = [...trail, node.label];
  const prev = compareMap.get(node.id);
  const parentPrev = parent ? compareMap.get(parent.id)?.value : null;
  const tooSmall = parent && parent.unit === node.unit && Number(parentPrev) > 0
    && Math.max(Number(prev?.value) || 0, Number(node.value) || 0) / Number(parentPrev) < MIN_SHARE_OF_PARENT;
  // A child that just restates its parent (Impressions under a source whose
  // value IS its impressions) would list the same move twice.
  const echoesParent = parent && parent.unit === node.unit
    && Number(parent.value) === Number(node.value) && Number(parentPrev) === Number(prev?.value);
  if (!node.placeholder && node.value != null && prev?.value != null && trail.length > 0 && !tooSmall && !echoesParent) {
    const d = computeDelta(Number(node.value), Number(prev.value));
    if (d?.num != null && Number.isFinite(d.num)) {
      out.push({ id: node.id, label: node.label, path, unit: node.unit, value: node.value, prev: prev.value, delta: d });
    }
  }
  for (const c of node.children || []) collectMovers(c, compareMap, path, out, node);
}

function infoText(node, implied) {
  const parts = [];
  if (node.sublabel) parts.push(`Sumber: ${node.sublabel}.`);
  if (node.formula) parts.push(`Formula: ${node.formula}`);
  if (implied) parts.push(`Hasil formula: ${fmtValue(node.impliedValue, node.unit)} (nilai terukur ${fmtValue(node.value, node.unit)}; selisih karena beda sumber/checkpoint).`);
  if (node.note) parts.push(node.note);
  if (node.value == null && node.absentReason) parts.push(node.absentReason);
  return parts.join('\n\n');
}

function NodeCard({ node, depth, ctx }) {
  const compareNode = ctx.compareMap.get(node.id) || null;
  const kids = node.children || [];
  const open = ctx.openSet.has(node.id);
  const delta = ctx.hasCompare
    ? computeDelta(node.value == null ? null : Number(node.value), compareNode?.value == null ? null : Number(compareNode.value))
    : null;
  const tone = node.placeholder || node.value == null ? 'none' : toneOf(delta);
  const implied = node.impliedValue != null && node.value != null
    && Math.abs(Number(node.impliedValue) - Number(node.value)) > (Math.abs(Number(node.value)) * 0.005 + 0.0001);
  const value = fmtValue(node.value, node.unit);

  return (
    <div
      className={`rt-node tone-${tone}${depth === 0 ? ' is-root' : ''}${node.placeholder ? ' is-ph' : ''}${ctx.flashId === node.id ? ' is-flash' : ''}`}
      data-node={node.id}
    >
      <div className="rt-node-top">
        <button type="button" className="rt-node-title" onClick={() => ctx.onDrill(node.id)} title="Fokus ke cabang ini">
          {node.label}
        </button>
        <InfoTip text={infoText(node, implied)} />
      </div>

      {node.placeholder ? (
        <div className="rt-node-ph">Belum tersedia</div>
      ) : (
        <div className="rt-node-val">
          {value ?? <span className="con-null" title={node.absentReason || 'Data belum tersedia'}>&mdash;</span>}
        </div>
      )}

      {ctx.hasCompare && !node.placeholder && (
        <div className="rt-node-cmp">
          <span>{fmtValue(compareNode?.value, node.unit) ?? '—'}</span>
          {delta && <b className={`rt-delta tone-${toneOf(delta)}`}>{delta.str}</b>}
        </div>
      )}

      {kids.length > 0 && (
        <button
          type="button"
          className={`rt-toggle${open ? ' is-open' : ''}`}
          onClick={() => ctx.onToggle(node.id)}
          aria-expanded={open}
          aria-label={open ? 'Tutup cabang' : `Buka ${kids.length} cabang`}
        >
          {open ? '−' : `+${kids.length}`}
        </button>
      )}
    </div>
  );
}

function Branch({ node, depth, ctx }) {
  const kids = node.children || [];
  const open = ctx.openSet.has(node.id) && kids.length > 0;
  const op = operatorOf(node.formula);
  return (
    <div className="rt-branch">
      <NodeCard node={node} depth={depth} ctx={ctx} />
      {open && (
        <div className={`rt-children${kids.length === 1 ? ' is-single' : ''}`}>
          {op && <span className="rt-op" title={node.formula}>{op}</span>}
          {kids.map((c) => (
            <div className="rt-child" key={c.id}>
              <Branch node={c} depth={depth + 1} ctx={ctx} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RootCauseTree({ tree, compareTree = null, hasCompare = false, mainRange, compareRange, meta }) {
  const [openSet, setOpenSet] = useState(() => defaultOpen(tree));
  const [focusId, setFocusId] = useState(null);
  const [flashId, setFlashId] = useState(null);
  const canvasRef = useRef(null);

  const byId = useMemo(() => indexById(tree, new Map()), [tree]);
  const compareMap = useMemo(() => indexById(compareTree, new Map()), [compareTree]);

  const movers = useMemo(() => {
    if (!hasCompare || !tree || !compareTree) return [];
    const out = [];
    collectMovers(tree, compareMap, [], out);
    // Drivers moving the same way as GMV explain its change, so they lead;
    // within each group the larger move comes first.
    const rootPrev = compareMap.get(tree.id)?.value;
    const rootDir = Math.sign(Number(tree.value) - Number(rootPrev)) || 0;
    const rank = (m) => (rootDir !== 0 && Math.sign(m.delta.num) === rootDir ? 0 : 1);
    return out
      .sort((a, b) => rank(a) - rank(b) || Math.abs(b.delta.num) - Math.abs(a.delta.num))
      .slice(0, 5);
  }, [hasCompare, tree, compareTree, compareMap]);

  // Bring a flashed node into view once it has rendered.
  useEffect(() => {
    if (!flashId || !canvasRef.current) return undefined;
    const el = canvasRef.current.querySelector(`[data-node="${flashId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    const t = setTimeout(() => setFlashId(null), 1800);
    return () => clearTimeout(t);
  }, [flashId]);

  if (!tree) return null;

  const onToggle = (id) => setOpenSet((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const onDrill = (id) => {
    setFocusId(id === tree.id ? null : id);
    setOpenSet((prev) => new Set(prev).add(id));
  };
  const reveal = (id) => {
    const path = pathTo(tree, id);
    setFocusId(null);
    setOpenSet((prev) => {
      const next = new Set(prev);
      path.slice(0, -1).forEach((n) => next.add(n.id));
      return next;
    });
    setFlashId(id);
  };

  const crumbs = focusId ? pathTo(tree, focusId) : [];
  const viewRoot = (focusId ? byId.get(focusId) : tree) || tree;
  const ctx = { openSet, onToggle, onDrill, compareMap, hasCompare, flashId };

  return (
    <div className="rt">
      <div className="rt-head">
        <div>
          <span className="rt-kicker">Root Cause Analysis</span>
          <h3>Pohon dekomposisi GMV</h3>
          <p>
            GMV dipecah ke pendorongnya: <b>Orders</b> (Traffic × Conversion Rate) dan <b>AOV</b> (ABS × AUR), lalu turun sampai sumber traffic dan iklan.
            {hasCompare ? ' Warna tepi kartu mengikuti perubahan terhadap periode pembanding: ikuti cabang merah untuk menemukan sumber penurunan.' : ' Aktifkan "Bandingkan periode" untuk melihat cabang mana yang naik atau turun.'}
          </p>
        </div>
        <div className="rt-periods">
          <span><i className="rt-dot" />Periode <b>{mainRange}</b></span>
          {hasCompare && <span><i className="rt-dot is-cmp" />Pembanding <b>{compareRange}</b></span>}
        </div>
      </div>

      {meta?.conversionRateGrain?.message && (
        <p className="rt-grain">
          <TriangleAlert size={13} strokeWidth={2.4} />
          {meta.conversionRateGrain.message}
        </p>
      )}

      {movers.length > 0 && (
        <div className="rt-movers">
          <div className="rt-movers-title">
            Temuan utama
            <InfoTip text="Node yang bergerak searah dengan GMV didahulukan (kandidat penyebab), lalu diurutkan dari perubahan persen terbesar. Node yang porsinya kurang dari 2% terhadap induknya tidak ditampilkan agar basis kecil tidak menghasilkan persentase yang menyesatkan. Menunjukkan di mana perubahan terjadi, bukan membuktikan sebab-akibat. Klik untuk membuka posisinya di pohon." />
          </div>
          <div className="rt-movers-list">
            {movers.map((m) => (
              <button type="button" key={m.id} className={`rt-mover tone-${toneOf(m.delta)}`} onClick={() => reveal(m.id)}>
                <b>{m.delta.str}</b>
                <span className="rt-mover-label">{m.label}</span>
                <span className="rt-mover-path">{m.path.slice(1, -1).join(' › ') || 'GMV'}</span>
                <span className="rt-mover-val">{fmtValue(m.prev, m.unit)} → {fmtValue(m.value, m.unit)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="rt-toolbar">
        <div className="rt-crumbs">
          {crumbs.length > 1 ? (
            <>
              <button type="button" onClick={() => setFocusId(null)}><Crosshair size={12} strokeWidth={2.4} /> GMV</button>
              {crumbs.slice(1).map((c, i) => (
                <Fragment key={c.id}>
                  <ChevronRight size={12} className="rt-crumb-sep" />
                  <button type="button" onClick={() => setFocusId(c.id)} className={i === crumbs.length - 2 ? 'is-current' : ''}>{c.label}</button>
                </Fragment>
              ))}
            </>
          ) : (
            <span className="rt-hint">Klik nama kartu untuk fokus ke satu cabang · tombol <b>+n</b> membuka pendorongnya · <b>?</b> menjelaskan sumber & formula</span>
          )}
        </div>
        <div className="rt-actions">
          <button type="button" onClick={() => setOpenSet(allBranchIds(viewRoot))}><Maximize2 size={12} strokeWidth={2.4} /> Buka semua</button>
          <button type="button" onClick={() => setOpenSet(defaultOpen(tree))}><Minimize2 size={12} strokeWidth={2.4} /> Ringkas</button>
        </div>
      </div>

      {hasCompare && (
        <div className="rt-legend" aria-hidden>
          <span><i className="tone-up" />Naik</span>
          <span><i className="tone-down" />Turun</span>
          <span><i className="tone-flat" />Stabil (&lt; 0,5%)</span>
          <span><i className="tone-none" />Tidak ada pembanding</span>
        </div>
      )}

      <div className="rt-canvas" ref={canvasRef}>
        <Branch node={viewRoot} depth={0} ctx={ctx} />
      </div>
    </div>
  );
}
