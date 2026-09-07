import { useCallback, useEffect, useReducer, useRef } from 'react';
import api from '../../api/client.js';
import { DOMAINS, DOMAIN_BY_KEY } from './domains.js';

// The console shows every domain at once, so it cannot keep the old page's
// "fetch whatever tab is open, throw the rest away" model — switching domains
// would blank the summaries you just read, and every trip back would re-query.
//
// So: one cache for the whole console, keyed by the filters the numbers were
// fetched under. The focused domain loads immediately; the rest fill in during
// idle time, one request at a time, so the summaries become real without
// firing seven queries (two of which are RFM and basket analysis) the instant
// someone opens the page. Changing brand or period invalidates everything,
// which is the point of keying on the filters rather than clearing by hand.

const PREFETCH_GAP_MS = 400;

function filterSignature(filters) {
  return [
    filters.brandId,
    filters.startDate,
    filters.endDate,
    filters.compare ? filters.compareStartDate : '',
    filters.compare ? filters.compareEndDate : '',
  ].join('|');
}

// Product Performance is the one domain with a parameter of its own, so its
// cached entry has to survive a level change as a separate entry rather than
// quietly serving category numbers under a variant heading.
function cacheKey(sig, domainKey, productLevel) {
  return domainKey === 'Product Performance'
    ? `${sig}::${domainKey}::${productLevel}`
    : `${sig}::${domainKey}`;
}

const EMPTY = { status: 'idle', data: null, error: '' };

export function useConsoleData({ filters, activeKey, productLevel }) {
  const cache = useRef(new Map());
  const controllers = useRef(new Map());
  const [, bump] = useReducer((n) => n + 1, 0);

  const sig = filterSignature(filters);

  // Drop everything fetched under different filters, and abort whatever is
  // still in flight for them — a late response from the previous brand must
  // never land in the new brand's cache.
  const lastSig = useRef(sig);
  if (lastSig.current !== sig) {
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    cache.current.clear();
    lastSig.current = sig;
  }

  const read = useCallback(
    (domainKey) => cache.current.get(cacheKey(sig, domainKey, productLevel)) || EMPTY,
    [sig, productLevel],
  );

  const load = useCallback((domainKey) => {
    const key = cacheKey(sig, domainKey, productLevel);
    const entry = cache.current.get(key);
    if (entry && entry.status !== 'error') return;         // ready or already loading
    if (!filters.brandId) return;

    const domain = DOMAIN_BY_KEY[domainKey];
    if (!domain) return;

    const controller = new AbortController();
    controllers.current.set(key, controller);
    cache.current.set(key, { status: 'loading', data: null, error: '' });
    bump();

    const params = {
      brandId: filters.brandId,
      startDate: filters.startDate,
      endDate: filters.endDate,
    };
    if (filters.compare && filters.compareStartDate && filters.compareEndDate) {
      params.compareStartDate = filters.compareStartDate;
      params.compareEndDate = filters.compareEndDate;
    }
    if (domainKey === 'Product Performance') params.level = productLevel;

    api.get(domain.endpoint, { params, signal: controller.signal })
      .then((res) => {
        cache.current.set(key, { status: 'ready', data: res.data, error: '' });
      })
      .catch((err) => {
        // An abort is this hook cancelling its own work, not a failure the
        // user should be told about.
        if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
        cache.current.set(key, {
          status: 'error',
          data: null,
          error: err.response?.data?.message || 'Gagal memuat data domain ini.',
        });
      })
      .finally(() => {
        controllers.current.delete(key);
        bump();
      });
  }, [sig, productLevel, filters.brandId, filters.startDate, filters.endDate,
      filters.compare, filters.compareStartDate, filters.compareEndDate]);

  // The focused domain, plus Executive Snapshot: the KPI strip is read off the
  // snapshot payload and stays on screen whichever domain is focused, so it is
  // never a domain the console is allowed to be without.
  useEffect(() => {
    if (!filters.brandId) return;
    load(activeKey);
    load('Executive Snapshot');
  }, [load, activeKey, filters.brandId]);

  // Everything else, during idle. Sequential and spaced, so the summaries fill
  // in without the page competing with itself for connections.
  useEffect(() => {
    if (!filters.brandId) return undefined;

    let cancelled = false;
    let timer;

    const pending = () => DOMAINS
      .map((d) => d.key)
      .filter((k) => read(k).status === 'idle');

    const step = () => {
      if (cancelled) return;
      // Never prefetch while the focused domain is still loading: its request
      // is the one the user is actually waiting on.
      if (read(activeKey).status === 'loading') {
        timer = setTimeout(step, PREFETCH_GAP_MS);
        return;
      }
      const next = pending()[0];
      if (!next) return;
      load(next);
      timer = setTimeout(step, PREFETCH_GAP_MS);
    };

    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(step, { timeout: 2000 })
      : setTimeout(step, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else clearTimeout(idle);
    };
  }, [load, read, activeKey, filters.brandId]);

  // Abort anything outstanding when the console unmounts.
  useEffect(() => {
    const live = controllers.current;
    return () => {
      for (const controller of live.values()) controller.abort();
      live.clear();
    };
  }, []);

  const retry = useCallback((domainKey) => {
    cache.current.delete(cacheKey(sig, domainKey, productLevel));
    load(domainKey);
  }, [load, sig, productLevel]);

  return { read, retry };
}
