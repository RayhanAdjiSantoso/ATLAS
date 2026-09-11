import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, UserRound, UserRoundPlus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import AuthExperience from '../components/auth/AuthExperience.jsx';
import '../reportGenerator/index.css';
import '../reportGenerator/app/login.css';
import '../reportGenerator/app/atlas-fit.css';

export default function RegisterPage() {
  const { register } = useAuth();
  const [fullName, setFullName] = useState('');
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
      await register(email, password, fullName);
    } catch (err) {
      setError(err.response?.data?.message || 'Registrasi gagal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthExperience mode="register">
      <div className="auth-heading">
        <span className="auth-heading-icon"><UserRoundPlus size={18} aria-hidden /></span>
        <h1>Buat akun ATLAS</h1>
        <p>Siapkan akses Anda ke seluruh workspace dalam satu langkah.</p>
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        <label className="auth-field" htmlFor="fullName">
          <span>Nama lengkap</span>
          <span className="auth-input-shell">
            <UserRound size={18} aria-hidden />
            <input id="fullName" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nama Anda" required />
          </span>
        </label>
        <label className="auth-field" htmlFor="email">
          <span>Email</span>
          <span className="auth-input-shell">
            <Mail size={18} aria-hidden />
            <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@mildigital.id" required />
          </span>
        </label>
        <label className="auth-field" htmlFor="password">
          <span>Password <small>minimal 8 karakter</small></span>
          <span className="auth-input-shell">
            <LockKeyhole size={18} aria-hidden />
            <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Buat password yang aman" minLength={8} required />
            <button type="button" className="auth-password-toggle" aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'} onClick={() => setShowPassword((visible) => !visible)}>
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
        </label>

        {error && <div className="auth-error" role="alert">{error}</div>}

        <button type="submit" className="auth-submit" disabled={loading}>
          <span>{loading ? 'Memproses…' : 'Buat akun'}</span>
          {!loading && <ArrowRight size={18} aria-hidden />}
        </button>
      </form>

      <p className="auth-switch">Sudah memiliki akun? <Link to="/login">Masuk di sini</Link></p>
    </AuthExperience>
  );
}
