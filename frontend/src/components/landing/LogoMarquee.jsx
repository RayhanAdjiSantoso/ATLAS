// Client logos running in endless lines. Each track holds its list twice and
// slides by exactly half its width, so the seam is never seen; speed is per
// logo, so a longer list does not race. A long list splits into two rows that
// run against each other. Hover (on a pointer) pauses a row, and reduced
// motion turns rows into plain lines you can scroll.

// Logos come square, wide and very wide. Sizing by height alone makes a
// square mark loom and a wordmark vanish, so height falls with the square
// root of the aspect ratio — every logo gets roughly the same ink.
function opticalHeight(logo) {
  const aspect = logo.width && logo.height ? logo.width / logo.height : 2.5;
  return Math.round(Math.min(50, Math.max(19, 50 / Math.sqrt(aspect))));
}

function Row({ logos, reverse, labelled }) {
  // Short lists repeat until one copy is wider than a wide screen.
  const copies = Math.max(1, Math.ceil(12 / logos.length));
  const run = Array.from({ length: copies }, () => logos).flat();
  const seconds = Math.max(30, run.length * 3.4);
  return (
    <div className={`lp-marquee${reverse ? ' is-reverse' : ''}`} style={{ '--lp-marquee-s': `${seconds}s` }}>
      <ul className="lp-marquee-track">
        {[0, 1].map((half) =>
          run.map((l, i) => {
            const named = labelled && half === 0 && i < logos.length;
            return (
              <li key={`${half}-${i}-${l.id}`} className="lp-marquee-item" aria-hidden={named ? undefined : true}>
                <img
                  src={l.url}
                  alt={named ? l.title || 'Logo klien' : ''}
                  style={{ height: opticalHeight(l) }}
                  loading="lazy"
                  decoding="async"
                  draggable="false"
                />
              </li>
            );
          }),
        )}
      </ul>
    </div>
  );
}

// `rows` is 1 or 2: a short window keeps the band to one line so it still
// fits on the first screen.
export function LogoMarquee({ logos, rows = 2 }) {
  if (!logos.length) return null;
  if (rows === 1 || logos.length < 16) return <Row logos={logos} labelled />;
  const half = Math.ceil(logos.length / 2);
  return (
    <div className="lp-marquee-rows">
      <Row logos={logos.slice(0, half)} labelled />
      <Row logos={logos.slice(half)} reverse labelled />
    </div>
  );
}
