import { useMemo, useState, Fragment } from 'react';
import { ChevronRight, Target, CornerDownRight, Info, TriangleAlert } from 'lucide-react';

// Root Cause Analysis — interactive GMV decomposition tree.
//
// The backend hands us one tree for the main period and (optionally) one for
// the comparison period, both with identical node ids. We index the compare
// tree by id and, for every node, draw its value plus a delta vs the same
// node in the other period — the same "value + %change" pairing the Report
// Generator uses for its period comparison, but walked down a tree instead of
// a flat table.
//
// Two independent interactions per node:
//   - the chevron expands/collapses that node's children
//   - clicking the label "drills down" — re-roots the visible tree at that
//     node, with a breadcrumb back up to GMV

const idFmt = new Intl.NumberFormat('id-ID');

function fmtValue(value, unit) {
  if (value == null) return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  switch (unit) {
    case 'idr': {
      const abs = Math.abs(num);
      if (abs >= 1e9) return `Rp ${idFmt.format(Number((num / 1e9).toFixed(2)))} M`;
      if (abs >= 1e6) return `Rp ${idFmt.format(Number((num / 1e6).toFixed(1)))} jt`;
      return `Rp ${idFmt.format(Math.round(num))}`;
    }
    case 'idr_per_unit':
      return `Rp ${idFmt.format(Math.round(num))}`;
    case 'percent':
      return `${idFmt.format(Number((num * 100).toFixed(2)))}%`;
    case 'unit_per_order':
      return `${idFmt.format(Number(num.toFixed(2)))} unit`;
    case 'ratio':
      return idFmt.format(Number(num.toFixed(2)));
    default:
      return idFmt.format(Math.round(num));
  }
}

function fmtValueFull(value, unit) {
  if (value == null) return 'Tidak tersedia';
  const num = Number(value);
  if (!Number.isFinite(num)) return 'Tidak tersedia';
  if (unit === 'idr' || unit === 'idr_per_unit') return `Rp ${idFmt.format(Math.round(num))}`;
  if (unit === 'percent') return `${idFmt.format(Number((num * 100).toFixed(4)))}%`;
  return idFmt.format(num);
}

// Report Generator's computeDelta business rule, mirrored here (the RG lib is
// a separate TS bundle): prev 0 + cur 0 -> flat; prev 0 + cur > 0 -> "Baru";
// missing side -> em dash.
function computeDelta(vCur, vOld) {
  if (vOld == null || vCur == null) return { num: null, str: '—' };
  if (vOld === 0) {
    if (vCur === 0) return { num: 0, str: '0%' };
    if (vCur > 0) return { num: null, str: 'Baru' };
    return { num: null, str: 'N/A' };
  }
  const num = ((vCur - vOld) / Math.abs(vOld)) * 100;
  return { num, str: `${num >= 0 ? '+' : ''}${idFmt.format(Number(num.toFixed(2)))}%` };
}

function deltaClass(num) {
  if (num == null || Math.abs(num) < 0.05) return 'rca-d-flat';
  return num > 0 ? 'rca-d-up' : 'rca-d-down';
}

// Depth at which a node starts collapsed. Keeps the first open view to
// GMV -> Orders/AOV -> Traffic/CR without the whole traffic-source forest.
const DEFAULT_OPEN_DEPTH = 2;

function collectIds(node, depth, openSet) {
  if (!node) return;
  if (depth < DEFAULT_OPEN_DEPTH && node.children?.length) openSet.add(node.id);
  for (const c of node.children || []) collectIds(c, depth + 1, openSet);
}

function indexById(node, map) {
  if (!node) return map;
  map.set(node.id, node);
  for (const c of node.children || []) indexById(c, map);
  return map;
}

// Flatten to non-placeholder nodes that have a value in BOTH periods, so the
// "largest movements" readout can rank them. Path is the label trail.
function collectMovers(node, compareMap, trail, out) {
  if (!node) return;
  const path = [...trail, node.label];
  const prev = compareMap.get(node.id);
  if (!node.placeholder && node.value != null && prev && prev.value != null) {
    const d = computeDelta(Number(node.value), Number(prev.value));
    if (d.num != null && Number.isFinite(d.num)) {
      out.push({ id: node.id, label: node.label, path, unit: node.unit, value: node.value, prev: prev.value, delta: d });
    }
  }
  for (const c of node.children || []) collectMovers(c, compareMap, path, out);
}

function NodeRow({ node, depth, open, onToggle, onDrill, compareNode, hasCompare, expandedInfo, onToggleInfo }) {
  const hasChildren = (node.children || []).length > 0;
  const delta = hasCompare ? computeDelta(
    node.value == null ? null : Number(node.value),
    compareNode && compareNode.value != null ? Number(compareNode.value) : null,
  ) : null;

  const implied = node.impliedValue != null && node.value != null
    && Math.abs(Number(node.impliedValue) - Number(node.value)) > (Math.abs(Number(node.value)) * 0.005 + 0.0001);

  const infoOpen = expandedInfo.has(node.id);
  const hasInfo = node.formula || node.note || implied;

  return (
    <>
      <div
        className={`rca-row${node.placeholder ? ' is-placeholder' : ''}`}
        style={{ '--depth': depth }}
      >
        <button
          type="button"
          className={`rca-caret${hasChildren ? '' : ' is-leaf'}${open ? ' is-open' : ''}`}
          onClick={() => hasChildren && onToggle(node.id)}
          aria-label={open ? 'Tutup' : 'Buka'}
          aria-expanded={hasChildren ? open : undefined}
          disabled={!hasChildren}
        >
          {hasChildren && <ChevronRight size={14} strokeWidth={2.6} />}
        </button>

        <button type="button" className="rca-label" onClick={() => onDrill(node.id)} title="Fokus ke cabang ini">
          <span className="rca-label-main">
            {node.label}
            {node.placeholder && <span className="rca-tag">belum tersedia</span>}
          </span>
          {node.sublabel && <span className="rca-label-sub">{node.sublabel}</span>}
        </button>

        <div className="rca-value">
          {node.value == null
            ? <span className="rca-null" title={node.absentReason || node.note || 'Data belum tersedia'}>&mdash;</span>
            : fmtValue(node.value, node.unit)}
        </div>

        {hasCompare && (
          <div className="rca-delta">
            {compareNode && compareNode.value != null && (
              <span className="rca-prev" title="Nilai periode pembanding">
                {fmtValue(compareNode.value, node.unit)}
              </span>
            )}
            {delta && delta.str !== '—' && (
              <span className={`rca-d ${deltaClass(delta.num)}`}>{delta.str}</span>
            )}
          </div>
        )}

        <button
          type="button"
          className={`rca-info-btn${hasInfo ? '' : ' is-hidden'}${infoOpen ? ' is-on' : ''}`}
          onClick={() => onToggleInfo(node.id)}
          aria-label="Keterangan"
        >
          <Info size={13} strokeWidth={2.4} />
        </button>
      </div>

      {infoOpen && hasInfo && (
        <div className="rca-info" style={{ '--depth': depth }}>
          {node.formula && (
            <div className="rca-info-line">
              <span className="rca-info-k">Formula</span>
              <span>{node.formula}</span>
            </div>
          )}
          {implied && (
            <div className="rca-info-line">
              <span className="rca-info-k">Hasil formula</span>
              <span>
                {fmtValueFull(node.impliedValue, node.unit)}
                {' '}
                <span className="rca-info-muted">
                  (terukur {fmtValueFull(node.value, node.unit)} — selisih karena beda sumber/checkpoint)
                </span>
              </span>
            </div>
          )}
          {node.note && (
            <div className="rca-info-line">
              <TriangleAlert size={12} strokeWidth={2.4} className="rca-info-ic" />
              <span>{node.note}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function renderSubtree(node, depth, ctx) {
  if (!node) return null;
  const open = ctx.openSet.has(node.id);
  const compareNode = ctx.compareMap.get(node.id) || null;
  return (
    <Fragment key={node.id}>
      <NodeRow
        node={node}
        depth={depth}
        open={open}
        onToggle={ctx.onToggle}
        onDrill={ctx.onDrill}
        compareNode={compareNode}
        hasCompare={ctx.hasCompare}
        expandedInfo={ctx.expandedInfo}
        onToggleInfo={ctx.onToggleInfo}
      />
      {open && (node.children || []).map((c) => renderSubtree(c, depth + 1, ctx))}
    </Fragment>
  );
}

export default function RootCauseTree({ tree, compareTree = null, hasCompare = false, mainRange, compareRange, meta }) {
  const [openSet, setOpenSet] = useState(() => {
    const s = new Set();
    if (tree) { s.add(tree.id); collectIds(tree, 0, s); }
    return s;
  });
  const [focusId, setFocusId] = useState(null);
  const [expandedInfo, setExpandedInfo] = useState(() => new Set());

  const byId = useMemo(() => indexById(tree, new Map()), [tree]);
  const compareMap = useMemo(() => indexById(compareTree, new Map()), [compareTree]);

  const movers = useMemo(() => {
    if (!hasCompare || !tree || !compareTree) return [];
    const out = [];
    collectMovers(tree, compareMap, [], out);
    return out.sort((a, b) => Math.abs(b.delta.num) - Math.abs(a.delta.num)).slice(0, 6);
  }, [hasCompare, tree, compareTree, compareMap]);

  if (!tree) return null;

  const onToggle = (id) => setOpenSet((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const onToggleInfo = (id) => setExpandedInfo((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const onDrill = (id) => {
    setFocusId(id === tree.id ? null : id);
    setOpenSet((prev) => new Set(prev).add(id));
  };

  // Breadcrumb path from GMV down to the focused node.
  const crumbs = [];
  if (focusId) {
    const path = [];
    (function findPath(node, trail) {
      if (!node) return false;
      const t = [...trail, node];
      if (node.id === focusId) { path.push(...t); return true; }
      for (const c of node.children || []) if (findPath(c, t)) return true;
      return false;
    })(tree, []);
    crumbs.push(...path);
  }

  const viewRoot = (focusId ? byId.get(focusId) : tree) || tree;
  const ctx = { openSet, onToggle, onDrill, compareMap, hasCompare, expandedInfo, onToggleInfo };

  return (
    <div className="rca">
      <div className="rca-head">
        <div>
          <h3>Root Cause Analysis — Dekomposisi GMV</h3>
          <p>
            Telusuri tiap komponen GMV: Orders (Traffic × Conversion Rate) dan AOV (ABS × AUR).
            Klik nama node untuk fokus ke satu cabang; ikon <Info size={11} /> menampilkan formula &amp; catatan rekonsiliasi.
          </p>
        </div>
        <div className="rca-periods">
          <span><b>Periode:</b> {mainRange}</span>
          {hasCompare && <span><b>Pembanding:</b> {compareRange}</span>}
        </div>
      </div>

      {meta?.conversionRateGrain?.message && (
        <p className="rca-grain">
          <TriangleAlert size={12} strokeWidth={2.4} />
          {meta.conversionRateGrain.message}
        </p>
      )}

      {hasCompare && movers.length > 0 && (
        <div className="rca-movers">
          <div className="rca-movers-title">Pergerakan terbesar antar periode</div>
          <ol>
            {movers.map((m) => (
              <li key={m.id}>
                <span className={`rca-d ${deltaClass(m.delta.num)}`}>{m.delta.str}</span>
                <span className="rca-movers-label">{m.label}</span>
                <span className="rca-movers-path">{m.path.slice(0, -1).join(' › ')}</span>
                <span className="rca-movers-val">
                  {fmtValue(m.prev, m.unit)} → {fmtValue(m.value, m.unit)}
                </span>
              </li>
            ))}
          </ol>
          <p className="rca-movers-foot">
            Diurutkan berdasarkan besar perubahan persen — menandai di mana perubahan terjadi, bukan membuktikan sebab-akibat.
          </p>
        </div>
      )}

      {crumbs.length > 1 && (
        <div className="rca-crumbs">
          <button type="button" onClick={() => setFocusId(null)}>
            <Target size={12} strokeWidth={2.4} /> GMV (penuh)
          </button>
          {crumbs.slice(1).map((c, i) => (
            <Fragment key={c.id}>
              <CornerDownRight size={11} className="rca-crumb-sep" />
              <button
                type="button"
                onClick={() => setFocusId(c.id)}
                className={i === crumbs.length - 2 ? 'is-current' : ''}
              >
                {c.label}
              </button>
            </Fragment>
          ))}
        </div>
      )}

      <div className={`rca-tree${hasCompare ? ' has-compare' : ''}`}>
        <div className="rca-row rca-row-header">
          <span />
          <span>Komponen</span>
          <span className="rca-value">Nilai</span>
          {hasCompare && <span className="rca-delta">Pembanding / Δ</span>}
          <span />
        </div>
        {renderSubtree(viewRoot, 0, ctx)}
      </div>
    </div>
  );
}
