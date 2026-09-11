import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import AuthExperience from '../components/auth/AuthExperience.jsx';
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

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
    <AuthExperience mode="login">
      <div className="auth-heading">
        <span className="auth-heading-icon"><LockKeyhole size={18} aria-hidden /></span>
        <h1>Selamat datang kembali</h1>
        <p>Masuk untuk melanjutkan pekerjaan Anda di ATLAS.</p>
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        <label className="auth-field" htmlFor="email">
          <span>Email</span>
          <span className="auth-input-shell">
            <Mail size={18} aria-hidden />
            <input id="email" type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@mildigital.id" />
          </span>
        </label>
        <label className="auth-field" htmlFor="password">
          <span>Password</span>
          <span className="auth-input-shell">
            <LockKeyhole size={18} aria-hidden />
            <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            <button type="button" className="auth-password-toggle" aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'} onClick={() => setShowPassword((visible) => !visible)}>
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
        </label>

        {error && <div className="auth-error" role="alert">{error}</div>}

        <button type="submit" className="auth-submit" disabled={loading}>
          <span>{loading ? 'Memproses…' : 'Masuk ke workspace'}</span>
          {!loading && <ArrowRight size={18} aria-hidden />}
        </button>
      </form>

      <p className="auth-switch">Belum punya akun? <Link to="/register">Daftar sekarang</Link></p>
    </AuthExperience>
  );
}
