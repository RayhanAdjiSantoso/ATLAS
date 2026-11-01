import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { CornerDownRight, Eye, EyeOff, MapPin, MessageSquarePlus, MessagesSquare, Send, Trash2, X } from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { getLayoutViewport, getUIScale } from '../../utils/uiScale.js';
import { UI_ROOT, describe, labelFor, pickTarget, resolve } from './anchor.js';
import './annotations.css';

// Website Annotation & Feedback — comments pinned to parts of a page.
//
// Mounted once in AppLayout for roles that hold the `annotations` module, so
// it covers every page behind the login. Rendered into <body>, beside the
// page rather than inside it: with Annotation Mode off it is a small launcher
// and the pins, and it listens to nothing on the page. With the mode on,
// hovering outlines the element under the pointer and a click opens a comment
// on it instead of doing what the click normally does.
//
// A comment belongs to an element, not to a spot on the screen (anchor.js);
// each pin's position is measured from its element again whenever the page
// scrolls, resizes or re-renders.

const STATUS = {
  open: { label: 'Open' },
  in_progress: { label: 'In Progress' },
  resolved: { label: 'Resolved' },
};
const STATUS_KEYS = Object.keys(STATUS);
const PINS_KEY = 'atlas_annotation_pins';

const PAGES = {
  '/': 'Beranda',
  '/dashboard': 'Brand Overview',
  '/pengaturan-brand': 'Setup Context & Brand Direction',
  '/data-brand': 'Data Collection Hub',
  '/brand-tracking': 'Brand Tracking',
  '/internal-dashboard': 'Business Insight',
  '/pengaturan-akses': 'Pengaturan Akses',
};
function pageName(path) {
  if (PAGES[path]) return PAGES[path];
  const report = path.match(/^\/report-generator\/([^/]+)/);
  if (report) return `Report Generator · ${report[1].replace(/^./, (c) => c.toUpperCase())}`;
  return path;
}

const dateTime = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtTime = (v) => (v ? dateTime.format(new Date(v)) : '');
const initialsOf = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
const errorText = (err) => err?.response?.data?.message || err?.message || 'Terjadi kesalahan.';

// Is this point of the element actually what the reader sees there? False
// when it is scrolled out of its container, or under a dialog or a sticky bar
// — a pin drawn there would point at something else.
function reachable(el, x, y) {
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
  const top = document.elementsFromPoint(x, y).find((hit) => !hit.closest(UI_ROOT));
  return Boolean(top) && (el.contains(top) || top.contains(el));
}

// A card beside a point: below it when there is room, else above, always
// inside the window. `at` is in layout pixels.
function Floating({ at, className, children, ...rest }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!at || !ref.current) return;
    const viewport = getLayoutViewport();
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    const left = Math.round(Math.max(12, Math.min(at.x - 30, viewport.width - w - 12)));
    const below = at.y + 22;
    const top = Math.round(below + h <= viewport.height - 12 ? below : Math.max(12, Math.min(at.y - h - 22, viewport.height - h - 12)));
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  });
  const style = !at ? undefined : pos ?? { left: 0, top: 0, visibility: 'hidden' };
  return <div ref={ref} className={`${className}${at ? '' : ' is-docked'}`} style={style} {...rest}>{children}</div>;
}

function StatusDot({ status }) {
  return <span className={`ann-dot is-${status}`} aria-hidden />;
}

function Thread({ item, place, busy, canDelete, onStatus, onReply, onDelete, onClose }) {
  const [reply, setReply] = useState('');
  const send = async () => {
    if (!reply.trim() || busy) return;
    if (await onReply(reply)) setReply('');
  };
  return (
    <>
      <header className="ann-card-head">
        <div className="ann-status" role="radiogroup" aria-label="Status komentar">
          {STATUS_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={item.status === key}
              className={`ann-status-opt is-${key}${item.status === key ? ' is-on' : ''}`}
              disabled={busy}
              onClick={() => item.status !== key && onStatus(key)}
            >
              {STATUS[key].label}
            </button>
          ))}
        </div>
        <button type="button" className="ann-icon-btn" onClick={onClose} aria-label="Tutup komentar"><X size={16} /></button>
      </header>

      <p className="ann-where"><MapPin size={13} aria-hidden /> <span>{item.elementLabel || 'Elemen halaman'}</span></p>
      {place === 'approx' && <p className="ann-note">Elemen aslinya tidak ditemukan lagi. Pin ditempatkan di bagian terdekat yang masih ada.</p>}
      {place === 'missing' && <p className="ann-note">Elemen ini tidak terlihat di tampilan sekarang. Mungkin ada di tab, filter atau brand lain pada halaman ini.</p>}

      <div className="ann-thread">
        <article className="ann-msg">
          <span className="ann-avatar" aria-hidden>{initialsOf(item.createdByName)}</span>
          <div>
            <p className="ann-msg-meta"><strong>{item.createdByName || 'Akun dihapus'}</strong> <time>{fmtTime(item.createdAt)}</time></p>
            <p className="ann-msg-body">{item.body}</p>
          </div>
        </article>
        {item.replies.map((r) => (
          <article className="ann-msg is-reply" key={r.id}>
            <span className="ann-avatar" aria-hidden>{initialsOf(r.createdByName)}</span>
            <div>
              <p className="ann-msg-meta"><strong>{r.createdByName || 'Akun dihapus'}</strong> <time>{fmtTime(r.createdAt)}</time></p>
              <p className="ann-msg-body">{r.body}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="ann-reply">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
          placeholder="Tulis balasan…"
          rows={2}
          maxLength={4000}
          aria-label="Balasan"
        />
        <button type="button" className="ann-btn is-primary" disabled={busy || !reply.trim()} onClick={send}>
          <CornerDownRight size={14} aria-hidden /> Balas
        </button>
      </div>

      <footer className="ann-card-foot">
        <span>
          {item.statusChangedByName ? `Status diubah ${item.statusChangedByName} · ${fmtTime(item.statusChangedAt)}` : 'Status belum pernah diubah'}
        </span>
        {canDelete && (
          <button type="button" className="ann-link-danger" disabled={busy} onClick={onDelete}>
            <Trash2 size={13} aria-hidden /> Hapus
          </button>
        )}
      </footer>
    </>
  );
}

export default function AnnotationLayer() {
  const { user, isAdmin } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [mode, setMode] = useState(false);
  const [hover, setHover] = useState(null);
  // The comment being written: { anchor, label }. Its element is kept in a
  // ref — a DOM node is not state.
  const [draft, setDraft] = useState(null);
  const [draftText, setDraftText] = useState('');
  const draftEl = useRef(null);
  const [draftSpot, setDraftSpot] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [panel, setPanel] = useState(false);
  const [scope, setScope] = useState('page');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPins, setShowPins] = useState(() => {
    try { return localStorage.getItem(PINS_KEY) !== '0'; } catch { return true; }
  });
  // id → where its element is right now (layout pixels), or absent when the
  // element is not in this view.
  const [spots, setSpots] = useState({});
  const elements = useRef(new Map());
  const [seek, setSeek] = useState(null);

  const loadedAt = useRef(0);
  const load = useCallback(async (force = false) => {
    if (!force && Date.now() - loadedAt.current < 20_000) return;
    loadedAt.current = Date.now();
    try {
      const { data } = await api.get('/annotations');
      setItems(data.annotations);
    } catch (err) {
      // A role that just lost the module simply has nothing to show.
      if (err?.response?.status !== 403) setError(errorText(err));
    }
  }, []);
  useEffect(() => { load(); }, [load, pathname]);
  useEffect(() => { if (panel) load(true); }, [panel, load]);

  // Oldest first, so a comment keeps its number as more arrive.
  const pageItems = useMemo(
    () => items.filter((a) => a.pagePath === pathname).sort((a, b) => a.id - b.id),
    [items, pathname],
  );
  const numberOf = useMemo(() => new Map(pageItems.map((a, i) => [a.id, i + 1])), [pageItems]);
  const openItem = items.find((a) => a.id === openId) ?? null;

  // Leaving the page drops a half-written comment's target with it.
  useEffect(() => {
    draftEl.current = null;
    setDraft(null);
    setHover(null);
  }, [pathname]);

  /* ── Where every pin is ─────────────────────────────────────────── */

  // Only the pins on screen are placed: unresolved ones while pins are shown,
  // the open thread's, the one being sought — and every one while the list
  // is open, for its "not in this view" flags. Pins hidden and nothing open:
  // nothing is measured at all.
  const tracked = useMemo(
    () => (panel ? pageItems : pageItems.filter((a) => a.id === openId || a.id === seek || (showPins && a.status !== 'resolved'))),
    [pageItems, panel, openId, seek, showPins],
  );

  // Finding a comment's element (resolve) queries the page and can compare
  // the text of every element of a tag — far too slow for each frame of a
  // scroll over a long report. So it runs only when the page may have
  // changed (`full`); a scroll just re-reads where the found elements are.
  const hits = useRef(new Map());
  const measure = useCallback((full) => {
    const scale = getUIScale();
    const next = {};
    elements.current = new Map();
    for (const a of tracked) {
      let hit = hits.current.get(a.id);
      if (full || hit === undefined || (hit && !hit.el.isConnected)) {
        hit = resolve(a.anchor);
        hits.current.set(a.id, hit);
      }
      if (!hit) continue;
      const r = hit.el.getBoundingClientRect();
      // On the nearest surviving section the original click point means
      // nothing, so the pin takes the section's corner.
      const x = hit.exact ? r.left + r.width * (a.anchor.x ?? 0.5) : r.left + 16;
      const y = hit.exact ? r.top + r.height * (a.anchor.y ?? 0.5) : r.top + 16;
      elements.current.set(a.id, hit.el);
      next[a.id] = {
        x: Math.round(x / scale),
        y: Math.round(y / scale),
        exact: hit.exact,
        seen: reachable(hit.el, x, y),
        box: [r.left, r.top, r.width, r.height].map((v) => Math.round(v / scale)),
      };
    }
    setSpots((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));

    const el = draftEl.current;
    if (el?.isConnected && draft) {
      const r = el.getBoundingClientRect();
      const spot = {
        x: Math.round((r.left + r.width * draft.anchor.x) / scale),
        y: Math.round((r.top + r.height * draft.anchor.y) / scale),
        box: [r.left, r.top, r.width, r.height].map((v) => Math.round(v / scale)),
      };
      setDraftSpot((prev) => (JSON.stringify(prev) === JSON.stringify(spot) ? prev : spot));
    } else {
      setDraftSpot(null);
    }
  }, [tracked, draft]);

  // Re-measure whenever something could have moved an element: scrolling
  // (any container — hence capture), resizing, the page re-rendering, a
  // transition settling, an image arriving. Coalesced to one pass a frame,
  // and switched off entirely while there is nothing to place.
  // A change to the page or the window looks for the elements again
  // (`full`); scrolling and a transition settling only move them.
  const tracking = tracked.length > 0 || Boolean(draft);
  useLayoutEffect(() => {
    if (!tracking) {
      setSpots({});
      setDraftSpot(null);
      return undefined;
    }
    // A full pass at most every FULL_GAP ms: on a long report sections keep
    // changing class as they scroll into view, and each change would
    // otherwise search the page again on that frame. In between, the pins
    // still follow the scroll; the deferred search runs once things settle.
    const FULL_GAP = 300;
    let frame = 0;
    let full = false;
    let lastFull = 0;
    let later = 0;
    const schedule = (again) => {
      full = full || again;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const now = performance.now();
        const due = full && now - lastFull >= FULL_GAP;
        if (full && !due && !later) {
          later = window.setTimeout(() => { later = 0; schedule(true); }, FULL_GAP - (now - lastFull));
        }
        if (due) {
          full = false;
          lastFull = now;
        }
        measure(due);
      });
    };
    const move = () => schedule(false);
    const change = () => schedule(true);
    measure(true);
    lastFull = performance.now();
    const observer = new MutationObserver((records) => {
      if (records.some((m) => !(m.target instanceof Element ? m.target : m.target.parentElement)?.closest(UI_ROOT))) change();
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
    const moves = ['scroll', 'transitionend', 'animationend'];
    const changes = ['resize', 'load'];
    moves.forEach((e) => window.addEventListener(e, move, true));
    changes.forEach((e) => window.addEventListener(e, change, true));
    // Slow animations and canvases that grow without touching the DOM.
    const timer = setInterval(change, 1000);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(later);
      observer.disconnect();
      moves.forEach((e) => window.removeEventListener(e, move, true));
      changes.forEach((e) => window.removeEventListener(e, change, true));
      clearInterval(timer);
    };
  }, [tracking, measure]);

  /* ── Annotation Mode ────────────────────────────────────────────── */

  useEffect(() => {
    if (!mode) return undefined;
    const root = document.documentElement;
    root.classList.add('ann-mode');
    let last = null;
    const inUi = (e) => e.target instanceof Element && e.target.closest(UI_ROOT);
    const outline = (el) => {
      if (el === last) return;
      last = el;
      if (!el) { setHover(null); return; }
      const scale = getUIScale();
      const r = el.getBoundingClientRect();
      setHover({ box: [r.left, r.top, r.width, r.height].map((v) => Math.round(v / scale)), label: labelFor(el) });
    };
    const onMove = (e) => outline(inUi(e) ? null : pickTarget(e.target));
    const onScroll = () => outline(null);
    // The page must not react while a part of it is being pointed at: no
    // navigation, no menu opening, no focus moving.
    const swallow = (e) => {
      if (inUi(e)) return false;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return true;
    };
    const onClick = (e) => {
      if (!swallow(e)) return;
      const el = pickTarget(e.target);
      if (!el) return;
      draftEl.current = el;
      setDraft({ anchor: describe(el, { x: e.clientX, y: e.clientY }), label: labelFor(el) });
      setOpenId(null);
      setError('');
    };
    const blocked = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'auxclick', 'contextmenu'];
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('click', onClick, true);
    blocked.forEach((e) => document.addEventListener(e, swallow, true));
    return () => {
      root.classList.remove('ann-mode');
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('click', onClick, true);
      blocked.forEach((e) => document.removeEventListener(e, swallow, true));
      setHover(null);
    };
  }, [mode]);

  const cancelDraft = useCallback(() => {
    draftEl.current = null;
    setDraft(null);
    setDraftText('');
  }, []);

  // Esc backs out one layer at a time: the comment being written, the open
  // thread, the list, then the mode itself.
  const anythingOpen = mode || Boolean(draft) || openId !== null || panel;
  useEffect(() => {
    if (!anythingOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (draft) cancelDraft();
      else if (openId !== null) setOpenId(null);
      else if (panel) setPanel(false);
      else setMode(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [anythingOpen, draft, openId, panel, cancelDraft]);

  /* ── Actions ────────────────────────────────────────────────────── */

  const put = (annotation) => setItems((list) => (list.some((a) => a.id === annotation.id)
    ? list.map((a) => (a.id === annotation.id ? annotation : a))
    : [annotation, ...list]));

  const run = async (request) => {
    setBusy(true);
    setError('');
    try {
      const { data } = await request();
      if (data.annotation) put(data.annotation);
      return data;
    } catch (err) {
      setError(errorText(err));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const submitDraft = async () => {
    if (!draft || !draftText.trim() || busy) return;
    const data = await run(() => api.post('/annotations', {
      pagePath: pathname,
      anchor: draft.anchor,
      elementLabel: draft.label,
      body: draftText,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }));
    if (data) cancelDraft();
  };

  const remove = async (item) => {
    if (!window.confirm('Hapus komentar ini beserta semua balasannya?')) return;
    const data = await run(() => api.delete(`/annotations/${item.id}`));
    if (!data) return;
    setItems((list) => list.filter((a) => a.id !== item.id));
    setOpenId(null);
  };

  const togglePins = () => setShowPins((on) => {
    try { localStorage.setItem(PINS_KEY, on ? '0' : '1'); } catch { /* the choice just is not remembered */ }
    return !on;
  });

  // From the list: go to the comment's page, bring its element into view,
  // open the thread there.
  const goTo = (item) => {
    if (item.pagePath !== pathname) navigate(item.pagePath);
    cancelDraft();
    setOpenId(item.id);
    setSeek(item.id);
  };
  useEffect(() => {
    if (seek === null) return undefined;
    const el = elements.current.get(seek);
    if (el && spots[seek]) {
      const r = el.getBoundingClientRect();
      if (r.top < 80 || r.bottom > window.innerHeight - 40) {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: r.height > window.innerHeight * 0.55 ? 'start' : 'center' });
      }
      setSeek(null);
      return undefined;
    }
    // The page may still be loading its data; give up quietly after a while.
    const timer = setTimeout(() => setSeek(null), 4000);
    return () => clearTimeout(timer);
  }, [seek, spots]);

  /* ── Render ─────────────────────────────────────────────────────── */

  const unresolved = items.filter((a) => a.status !== 'resolved').length;
  const scoped = scope === 'page' ? items.filter((a) => a.pagePath === pathname) : items;
  const listed = filter === 'all' ? scoped : scoped.filter((a) => a.status === filter);
  const countOf = (key) => (key === 'all' ? scoped.length : scoped.filter((a) => a.status === key).length);

  const openSpot = openItem && openItem.pagePath === pathname ? spots[openItem.id] : null;
  const openPlace = !openItem ? null
    : openItem.pagePath !== pathname ? 'elsewhere'
      : !openSpot ? 'missing'
        : openSpot.exact ? 'exact' : 'approx';
  const boxStyle = (box) => ({ left: box[0], top: box[1], width: box[2], height: box[3] });

  return createPortal(
    <div className="ann-root">
      {/* Outlines: the element under the pointer, the one being commented
          on, the one whose thread is open. */}
      {mode && hover && !draft && (
        <div className="ann-outline is-hover" style={boxStyle(hover.box)}>
          <span className="ann-outline-tag">{hover.label}</span>
        </div>
      )}
      {draft && draftSpot && <div className="ann-outline is-picked" style={boxStyle(draftSpot.box)} />}
      {openSpot && <div className={`ann-outline is-picked is-${openItem.status}`} style={boxStyle(openSpot.box)} />}

      {/* Pins. Resolved ones leave the page once done; the list still has
          them, and opening one from there shows its pin again. */}
      {pageItems.map((a) => {
        const spot = spots[a.id];
        const wanted = a.id === openId || (showPins && a.status !== 'resolved');
        if (!spot || !spot.seen || !wanted) return null;
        return (
          <button
            key={a.id}
            type="button"
            className={`ann-pin is-${a.status}${spot.exact ? '' : ' is-approx'}${a.id === openId ? ' is-open' : ''}`}
            style={{ left: spot.x, top: spot.y }}
            onClick={() => { cancelDraft(); setOpenId(a.id === openId ? null : a.id); }}
            title={`${a.createdByName || ''}: ${a.body.slice(0, 120)}`}
            aria-label={`Komentar ${numberOf.get(a.id)}, ${STATUS[a.status].label}`}
          >
            {numberOf.get(a.id)}
          </button>
        );
      })}
      {draft && draftSpot && <span className="ann-pin is-draft" style={{ left: draftSpot.x, top: draftSpot.y }} aria-hidden>+</span>}

      {draft && (
        <Floating at={draftSpot} className="ann-card ann-composer" role="dialog" aria-label="Komentar baru">
          <p className="ann-where"><MapPin size={13} aria-hidden /> <span>{draft.label}</span></p>
          <textarea
            autoFocus
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitDraft(); } }}
            placeholder="Tulis masukan untuk bagian ini…"
            rows={4}
            maxLength={4000}
            aria-label="Isi komentar"
          />
          {error && <p className="ann-error" role="alert">{error}</p>}
          <div className="ann-composer-foot">
            <small>Ctrl/⌘ + Enter untuk kirim</small>
            <button type="button" className="ann-btn" onClick={cancelDraft}>Batal</button>
            <button type="button" className="ann-btn is-primary" disabled={busy || !draftText.trim()} onClick={submitDraft}>
              <Send size={14} aria-hidden /> Kirim
            </button>
          </div>
        </Floating>
      )}

      {openItem && (
        <Floating at={openSpot} className="ann-card ann-thread-card" role="dialog" aria-label="Komentar">
          {openPlace === 'elsewhere' && <p className="ann-note">Komentar ini ada di halaman {pageName(openItem.pagePath)}.</p>}
          <Thread
            key={openItem.id}
            item={openItem}
            place={openPlace}
            busy={busy}
            canDelete={isAdmin || openItem.createdBy === user?.userId}
            onStatus={(status) => run(() => api.patch(`/annotations/${openItem.id}`, { status }))}
            onReply={(body) => run(() => api.post(`/annotations/${openItem.id}/replies`, { body }))}
            onDelete={() => remove(openItem)}
            onClose={() => setOpenId(null)}
          />
          {error && <p className="ann-error" role="alert">{error}</p>}
        </Floating>
      )}

      {panel && (
        <aside className="ann-panel" aria-label="Daftar feedback">
          <header className="ann-panel-head">
            <div>
              <h2>Feedback</h2>
              <p>{unresolved} belum selesai dari {items.length} komentar</p>
            </div>
            <button type="button" className="ann-icon-btn" onClick={() => setPanel(false)} aria-label="Tutup daftar"><X size={18} /></button>
          </header>
          <div className="ann-seg" role="tablist" aria-label="Cakupan">
            {[['page', 'Halaman ini'], ['all', 'Semua halaman']].map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={scope === key} className={scope === key ? 'is-on' : ''} onClick={() => setScope(key)}>{label}</button>
            ))}
          </div>
          <div className="ann-chips">
            {['all', ...STATUS_KEYS].map((key) => (
              <button key={key} type="button" className={`ann-chip${filter === key ? ' is-on' : ''}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>
                {key !== 'all' && <StatusDot status={key} />}
                {key === 'all' ? 'Semua' : STATUS[key].label} <b>{countOf(key)}</b>
              </button>
            ))}
          </div>
          {error && !draft && !openItem && <p className="ann-error" role="alert">{error}</p>}
          <ul className="ann-list">
            {listed.length === 0 && (
              <li className="ann-empty">
                {scoped.length === 0
                  ? 'Belum ada komentar. Aktifkan mode anotasi, lalu klik bagian halaman yang ingin diberi masukan.'
                  : 'Tidak ada komentar dengan status ini.'}
              </li>
            )}
            {listed.map((a) => {
              const here = a.pagePath === pathname;
              return (
                <li key={a.id}>
                  <button type="button" className={`ann-item${a.id === openId ? ' is-open' : ''}`} onClick={() => goTo(a)}>
                    <span className="ann-item-top">
                      <StatusDot status={a.status} />
                      <strong>{here && numberOf.has(a.id) ? `#${numberOf.get(a.id)} · ` : ''}{a.elementLabel || 'Elemen halaman'}</strong>
                    </span>
                    <span className="ann-item-body">{a.body}</span>
                    <span className="ann-item-meta">
                      {scope === 'all' && <em>{pageName(a.pagePath)}</em>}
                      <span>{a.createdByName || 'Akun dihapus'} · {fmtTime(a.createdAt)}</span>
                      {a.replies.length > 0 && <span>{a.replies.length} balasan</span>}
                      {here && !spots[a.id] && <span className="ann-item-flag">tidak terlihat di tampilan ini</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      )}

      {mode && (
        <div className="ann-hint" role="status">
          <strong>Mode anotasi aktif.</strong> Klik bagian halaman yang ingin dikomentari. <kbd>Esc</kbd> untuk keluar.
        </div>
      )}

      <div className={`ann-launcher${mode ? ' is-mode' : ''}`}>
        <button
          type="button"
          className="ann-launch-main"
          aria-pressed={mode}
          onClick={() => { if (mode) cancelDraft(); setMode((m) => !m); }}
          title={mode ? 'Matikan mode anotasi' : 'Aktifkan mode anotasi'}
        >
          {mode ? <X size={17} aria-hidden /> : <MessageSquarePlus size={17} aria-hidden />}
          <span>{mode ? 'Selesai' : 'Anotasi'}</span>
        </button>
        <button
          type="button"
          className="ann-launch-side"
          aria-pressed={panel}
          onClick={() => setPanel((p) => !p)}
          title="Daftar feedback"
          aria-label={`Daftar feedback, ${unresolved} belum selesai`}
        >
          <MessagesSquare size={17} aria-hidden />
          {unresolved > 0 && <b>{unresolved > 99 ? '99+' : unresolved}</b>}
        </button>
        <button
          type="button"
          className="ann-launch-side"
          aria-pressed={showPins}
          onClick={togglePins}
          title={showPins ? 'Sembunyikan pin komentar' : 'Tampilkan pin komentar'}
          aria-label={showPins ? 'Sembunyikan pin komentar' : 'Tampilkan pin komentar'}
        >
          {showPins ? <Eye size={17} aria-hidden /> : <EyeOff size={17} aria-hidden />}
        </button>
      </div>
    </div>,
    document.body,
  );
}
