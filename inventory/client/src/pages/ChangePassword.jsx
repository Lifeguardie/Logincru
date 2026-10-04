import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

/** החלפת סיסמה. מוצג בכפייה אחרי התחברות ראשונה או איפוס על ידי מנהל */
export default function ChangePassword() {
  const { user, applySession } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');

    if (form.next.length < 8) return setError('הסיסמה החדשה חייבת להכיל לפחות 8 תווים');
    if (form.next !== form.confirm) return setError('הסיסמאות לא זהות');
    if (form.next === form.current) return setError('הסיסמה החדשה חייבת להיות שונה מהנוכחית');

    setBusy(true);
    try {
      const data = await api.changePassword(form.current, form.next);
      applySession(data.token, data.user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" style={{ maxWidth: 420, margin: '0 auto' }} onSubmit={submit}>
      <h2>החלפת סיסמה</h2>

      {user.mustChangePassword && (
        <div className="alert warn">
          הסיסמה שלך זמנית. יש לבחור סיסמה חדשה לפני המשך העבודה.
        </div>
      )}
      {error && <div className="alert error">{error}</div>}

      <div className="field">
        <label htmlFor="current">סיסמה נוכחית</label>
        <input id="current" type="password" autoComplete="current-password" required autoFocus
          value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="next">סיסמה חדשה (לפחות 8 תווים)</label>
        <input id="next" type="password" autoComplete="new-password" required minLength={8}
          value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="confirm">אימות סיסמה חדשה</label>
        <input id="confirm" type="password" autoComplete="new-password" required
          value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
      </div>

      <div className="row">
        <button type="submit" disabled={busy}>{busy ? 'שומר…' : 'החלפה'}</button>
        {!user.mustChangePassword && (
          <button type="button" className="ghost" onClick={() => navigate(-1)}>ביטול</button>
        )}
      </div>
    </form>
  );
}
