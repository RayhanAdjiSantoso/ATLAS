import { MilMark } from '../../reportGenerator/components/MilMark';

// The full-screen wait: the MIL mark's bars rise one by one and its dot
// lands on top. Its styles sit in index.html, beside the first copy of this
// markup inside #root, which shows while the app's own files are still
// loading — so the hand-over to this one must not be seen.
//
// No wait is ever added for it: it renders only while something is really
// loading, and stays invisible for its first 300ms after the page opened so
// a fast load never flashes it. Past that it shows at once, and its loop is
// set to the clock since the page opened, so it carries on in step with the
// boot copy it replaces instead of restarting.
const LOOP_MS = 1600;
const FADE_AFTER_MS = 300;

export default function MilLoader({ label = 'Menyiapkan ATLAS…' }) {
  const now = performance.now();
  return (
    <div
      className={now > FADE_AFTER_MS ? 'mil-loader is-shown' : 'mil-loader'}
      role="status"
      style={{ '--mil-t': `${-Math.round(now % LOOP_MS)}ms` }}
    >
      <span className="mil-loader-tile">
        <MilMark />
      </span>
      <p className="mil-loader-text">{label}</p>
    </div>
  );
}
