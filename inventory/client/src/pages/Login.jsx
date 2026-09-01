import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { user, checking, login } = useAuth();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (checking) return <div className="spinner">טוען…</div>;
  if (user) return <Navigate to={location.state?.from?.pathname || '/'} replace />;

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);

    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.message || 'ההתחברות נכשלה');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <h1>ספירת מלאי</h1>
        <p className="sub muted">התחברות למערכת</p>

        {error && <div className="alert error">{error}</div>}

        <div className="field">
          <label htmlFor="username">שם משתמש</label>
          <input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">סיסמה</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        <button type="submit" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'מתחבר…' : 'כניסה'}
        </button>
      </form>
    </div>
  );
}
