// Security middleware for the API.
//
// Shopee Open Platform audits partner systems before granting API access
// (Data Protection Policy, clause 8 and 10.5): encrypted transport, no
// restricted data reachable without access control, and a system that holds
// up to a security inspection. TLS itself is handled by Vercel (1.2 and 1.3
// accepted, 1.0/1.1 refused). What lives here is what the application owns.

// Response headers every API answer carries. The static frontend gets the
// same set from vercel.json; this covers the API function, which Vercel
// headers config does not reach once a response comes from Express.
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // allow-popups: a future OAuth login (Shopee, Meta) may open in a popup.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  // API answers carry brand data; never let a shared cache keep them.
  res.setHeader('Cache-Control', 'no-store');
  next();
}

// Brute-force guard for the login endpoint: after too many FAILED attempts for
// one email from one address, further attempts are refused for a while.
// Successful logins do not count, so a user who types their password right
// is never slowed down.
//
// The counter lives in memory, so on Vercel it is per function instance, not
// global. That still stops a script hammering one instance — the common case —
// and needs no schema change; a shared store can replace the Map later without
// touching the callers.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map(); // key -> { count, first }

function keyOf(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  return `${ip}|${email}`;
}

export function loginRateLimit(req, res, next) {
  const key = keyOf(req);
  const now = Date.now();
  const entry = failures.get(key);
  if (entry && now - entry.first > WINDOW_MS) failures.delete(key);
  const current = failures.get(key);
  if (current && current.count >= MAX_FAILURES) {
    const retryAfter = Math.ceil((current.first + WINDOW_MS - now) / 1000);
    res.setHeader('Retry-After', String(Math.max(retryAfter, 1)));
    return res.status(429).json({ message: 'Terlalu banyak percobaan masuk yang gagal. Coba lagi dalam beberapa menit.' });
  }
  res.on('finish', () => {
    if (res.statusCode === 401) {
      const e = failures.get(key);
      if (e && Date.now() - e.first <= WINDOW_MS) e.count += 1;
      else failures.set(key, { count: 1, first: Date.now() });
      // Keep the map bounded if many distinct keys fail.
      if (failures.size > 5000) failures.delete(failures.keys().next().value);
    } else if (res.statusCode < 400) {
      failures.delete(key);
    }
  });
  next();
}
