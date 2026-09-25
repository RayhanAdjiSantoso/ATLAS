import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole } from 'lucide-react';
import api from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import AuthExperience from '../components/auth/AuthExperience.jsx';
import '../reportGenerator/index.css';
import '../reportGenerator/app/login.css';
import '../reportGenerator/app/atlas-fit.css';

// Replacing the password. Every account created from Pengaturan Akses starts
// with a password the system generated and showed once to the admin; the
// owner must set their own before anything else in ATLAS opens, so the admin
// never knows the password in use. Also reachable later by choice.

function passwordIssues(pw) {
  const issues = [];
  if (pw.length < 10) issues.push('minimal 10 karakter');
  if (!/[A-Za-z]/.test(pw)) issues.push('ada huruf');
  if (!/[0-9]/.test(pw)) issues.push('ada angka');
  return issues;
}

export default function ChangePasswordPage() {
  const { user, mustChangePassword, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const issues = passwordIssues(next);
  const mismatch = confirm.length > 0 && confirm !== next;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (issues.length) return setError(`Password baru harus ${issues.join(', ')}.`);
    if (next !== confirm) return setError('Konfirmasi password tidak sama.');
    setLoading(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Password gagal diganti.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthExperience mode="login">
      <div className="auth-heading">
        <span className="auth-heading-icon"><KeyRound size={18} aria-hidden /></span>
        <h1>{mustChangePassword ? 'Buat password Anda' : 'Ganti password'}</h1>
        <p>
          {mustChangePassword
            ? `Akun ${user?.email ?? ''} masih memakai password sementara dari admin. Ganti dengan password Anda sendiri untuk melanjutkan.`
            : 'Masukkan password saat ini, lalu password baru Anda.'}
        </p>
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        <label className="auth-field" htmlFor="current-password">
          <span>{mustChangePassword ? 'Password sementara' : 'Password saat ini'}</span>
          <span className="auth-input-shell">
            <LockKeyhole size={18} aria-hidden />
            <input id="current-password" type={show ? 'text' : 'password'} autoComplete="current-password" autoFocus required value={current} onChange={(e) => setCurrent(e.target.value)} />
            <button type="button" className="auth-password-toggle" aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'} onClick={() => setShow((v) => !v)}>
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
        </label>
        <label className="auth-field" htmlFor="new-password">
          <span>Password baru</span>
          <span className="auth-input-shell">
            <KeyRound size={18} aria-hidden />
            <input id="new-password" type={show ? 'text' : 'password'} autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
          </span>
          <small className="auth-hint">
            {next.length === 0 ? 'Minimal 10 karakter, berisi huruf dan angka.' : issues.length ? `Belum memenuhi: ${issues.join(', ')}.` : 'Password memenuhi syarat.'}
          </small>
        </label>
        <label className="auth-field" htmlFor="confirm-password">
          <span>Ulangi password baru</span>
          <span className="auth-input-shell">
            <KeyRound size={18} aria-hidden />
            <input id="confirm-password" type={show ? 'text' : 'password'} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </span>
          {mismatch && <small className="auth-hint is-bad">Belum sama dengan password baru.</small>}
        </label>

        {error && <div className="auth-error" role="alert">{error}</div>}

        <button type="submit" className="auth-submit" disabled={loading}>
          <span>{loading ? 'Menyimpan…' : 'Simpan password'}</span>
          {!loading && <ArrowRight size={18} aria-hidden />}
        </button>
      </form>

      <p className="auth-switch">
        {mustChangePassword ? (
          <button type="button" className="auth-link-button" onClick={async () => { await logout(); navigate('/login'); }}>
            Keluar dan masuk dengan akun lain
          </button>
        ) : (
          <button type="button" className="auth-link-button" onClick={() => navigate(-1)}>Batal</button>
        )}
      </p>
    </AuthExperience>
  );
}
