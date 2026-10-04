import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const ROLE_LABEL = { admin: 'מנהל מערכת', manager: 'מנהל', counter: 'סופר' };
const EMPTY = { username: '', password: '', fullName: '', role: 'counter' };

/** ניהול משתמשים - למנהל מערכת */
export default function Users() {
  const { user: me } = useAuth();

  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await api.listUsers());
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create(event) {
    event.preventDefault();
    setError(''); setMessage('');
    try {
      await api.createUser(form);
      setMessage(`המשתמש ${form.username} נוצר. בהתחברות הראשונה יידרש להחליף סיסמה.`);
      setForm(EMPTY);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function update(target, patch) {
    setError(''); setMessage('');
    try {
      await api.updateUser(target.id, {
        fullName: target.fullName, role: target.role, active: target.active, ...patch,
      });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function resetPassword(target) {
    const newPassword = window.prompt(`סיסמה זמנית חדשה עבור ${target.username} (לפחות 8 תווים):`);
    if (!newPassword) return;
    setError(''); setMessage('');
    try {
      await api.resetUserPassword(target.id, newPassword);
      setMessage(`הסיסמה של ${target.username} אופסה. יידרש להחליף אותה בהתחברות הבאה.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      <form className="card" onSubmit={create}>
        <h2>משתמש חדש</h2>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="field grow" style={{ minWidth: 140 }}>
            <label htmlFor="u-name">שם משתמש</label>
            <input id="u-name" required minLength={3} autoComplete="off" dir="ltr"
              value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </div>
          <div className="field grow" style={{ minWidth: 140 }}>
            <label htmlFor="u-full">שם מלא</label>
            <input id="u-full" required
              value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </div>
          <div className="field" style={{ minWidth: 140 }}>
            <label htmlFor="u-pass">סיסמה זמנית</label>
            <input id="u-pass" type="password" required minLength={8} autoComplete="new-password"
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="field" style={{ minWidth: 130 }}>
            <label htmlFor="u-role">תפקיד</label>
            <select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </div>
        <p className="muted">סופר: מזין ספירות בלבד. מנהל: גם קטלוג, מחירים, סגירה ודוחות. מנהל מערכת: גם משתמשים.</p>
        <button type="submit">יצירה</button>
      </form>

      <div className="card">
        <h2>משתמשים</h2>
        {loading ? <div className="spinner">טוען…</div> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>שם משתמש</th><th>שם מלא</th><th>תפקיד</th><th>פעיל</th><th /></tr>
              </thead>
              <tbody>
                {users.map((row) => {
                  const isMe = row.id === me.id;
                  return (
                    <tr key={row.id} style={{ opacity: row.active ? 1 : 0.55 }}>
                      <td dir="ltr" style={{ textAlign: 'right' }}>
                        {row.username}
                        {isMe && <span className="badge open" style={{ marginRight: 6 }}>אני</span>}
                        {row.mustChangePassword && <span className="badge warn" style={{ marginRight: 6 }}>סיסמה זמנית</span>}
                      </td>
                      <td>{row.fullName}</td>
                      <td>
                        <select value={row.role} disabled={isMe} style={{ width: 'auto' }}
                          onChange={(e) => update(row, { role: e.target.value })}>
                          {Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </td>
                      <td>
                        <input type="checkbox" style={{ width: 'auto' }} checked={row.active} disabled={isMe}
                          onChange={(e) => update(row, { active: e.target.checked })} />
                      </td>
                      <td>
                        <button className="ghost small" onClick={() => resetPassword(row)}>איפוס סיסמה</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
