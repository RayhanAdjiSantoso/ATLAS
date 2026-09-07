import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutDashboard, FileBarChart, Megaphone, Building2, History } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { MilMark } from '../reportGenerator/components/MilMark';
import '../reportGenerator/index.css';
import '../reportGenerator/app/login.css';
import '../reportGenerator/app/atlas-fit.css';

// The sign-in screen, rebuilt on the Monthly Report Generator's split layout:
// the form on the left, an honest description of what is behind it on the
// right. The previous version was a lone centred card, which said nothing
// about the product; the right panel is real content — the modules ATLAS
// actually has.
//
// Only the presentation changed. Authentication is untouched: the same
// useAuth().login(email, password), the same error message, and the same
// hand-off to PublicRoute, which is what redirects once `user` is set.

const MODULES = [
  { key: 'dashboard', label: 'Dashboard Business Overview', tagline: 'Analitik penjualan Shopee', accent: 'var(--acc)', Icon: LayoutDashboard },
  { key: 'reports', label: 'Performance Report Generator', tagline: 'Meta, Shopee & TikTok', accent: 'var(--shopee)', Icon: FileBarChart },
  { key: 'meta', label: 'Meta Ads Automation', tagline: 'Laporan harian & mingguan terjadwal', accent: 'var(--biz)', Icon: Megaphone },
  { key: 'internal', label: 'Internal Dashboard', tagline: 'Benchmark portofolio klien', accent: 'var(--sum)', Icon: Building2 },
  { key: 'history', label: 'History Upload', tagline: 'Jejak setiap file yang masuk', accent: 'var(--cyan)', Icon: History },
];

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.response?.data?.message || 'Login gagal');
    } finally {
      setLoading(false);
    }
  };

  return (
    // .mil-ui and .login-screen have to be two elements, not one. The
    // stylesheet is scoped by nesting every rule under .mil-ui, which makes
    // each of them a DESCENDANT selector — `.mil-ui .login-screen`. Put both
    // classes on the same node and that rule matches nothing, silently: the
    // page still renders, just unstyled and uncentred.
    <div className="mil-ui">
      <div className="login-screen">
        <MilMark className="login-mark" />

        <div className="login-split">
          <div className="login-panel">
            <span className="login-brand">
              <MilMark className="login-brand-logo" />
              <span className="login-brand-name">
                ATLAS <span className="login-brand-name-thin">MIL Digital</span>
              </span>
            </span>

            <h1 className="login-title">Masuk ke akun Anda</h1>
            <p className="login-sub">Gunakan email MIL Digital Anda.</p>

            <form className="login-form" onSubmit={handleSubmit}>
              <label className="login-field" htmlFor="email">
                <span>Email</span>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nama@mildigital.id"
                />
              </label>
              <label className="login-field" htmlFor="password">
                <span>Password</span>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </label>

              {error && (
                <div className="login-error" role="alert">
                  {error}
                </div>
              )}

              <button type="submit" className="btn btn-primary login-submit" disabled={loading}>
                {loading ? 'Memproses…' : 'Masuk'}
              </button>
            </form>

            <p className="login-foot">
              Belum punya akun? <Link to="/register">Daftar</Link>
            </p>
          </div>

          <aside className="login-aside" aria-label="Modul yang tersedia di ATLAS">
            <span className="login-aside-title">Yang ada di dalam</span>
            <ul className="login-aside-list">
              {MODULES.map(({ key, label, tagline, accent, Icon }) => (
                <li key={key} className="login-aside-row" style={{ '--row-accent': accent }}>
                  <span className="login-aside-ico" aria-hidden>
                    <Icon className="login-aside-ico-svg" />
                  </span>
                  <span className="login-aside-text">
                    <span className="login-aside-name">{label}</span>
                    <span className="login-aside-tag">{tagline}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="login-aside-foot">
              Data ekspor masuk, analitik dan laporan periodik keluar — tanpa berpindah aplikasi.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
