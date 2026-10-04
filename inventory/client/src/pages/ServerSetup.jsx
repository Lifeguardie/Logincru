import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkServer, getServerUrl, setServerUrl } from '../lib/api';

/**
 * הגדרת כתובת השרת - מסך ראשון באפליקציית Android.
 * האפליקציה היא מעטפת; הנתונים יושבים בשרת של המסעדה. הכתובת נשמרת
 * בטלפון פעם אחת, ואפשר לשנות אותה ממסך ההתחברות.
 */
export default function ServerSetup() {
  const navigate = useNavigate();
  const [url, setUrl] = useState(() => getServerUrl() || 'https://');
  const [status, setStatus] = useState(null); // {ok, message}
  const [busy, setBusy] = useState(false);

  async function test() {
    setBusy(true);
    setStatus(null);
    try {
      const base = await checkServer(url);
      setStatus({ ok: true, message: `השרת עונה: ${base}` });
      return base;
    } catch (err) {
      setStatus({ ok: false, message: err.message });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const base = await test();
    if (!base) return;
    setServerUrl(base);
    // ניווט מלא: App בודק את הכתובת בטעינה ומציג את המסך הזה בלעדיה
    window.location.href = '#/login';
    window.location.reload();
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>ספירת מלאי</h1>
        <p className="sub muted">כתובת השרת של המסעדה</p>

        <p className="muted" style={{ fontSize: 13 }}>
          הנתונים נשמרים בשרת שלכם, לא בטלפון. הכתובת מתקבלת ממי שהתקין את המערכת —
          למשל <span dir="ltr">https://inventory.example.com</span>.
        </p>

        <div className="field">
          <label htmlFor="server-url">כתובת</label>
          <input
            id="server-url"
            type="url"
            dir="ltr"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
          />
        </div>

        {status && (
          <div className={`alert ${status.ok ? 'success' : 'error'}`}>{status.message}</div>
        )}

        <div className="row">
          <button type="button" className="secondary" onClick={test} disabled={busy}>
            {busy ? 'בודק…' : 'בדיקה'}
          </button>
          <button type="button" className="grow" onClick={save} disabled={busy}>
            שמירה והמשך
          </button>
        </div>

        {getServerUrl() && (
          <p className="center" style={{ marginTop: 12, marginBottom: 0 }}>
            <button type="button" className="ghost small" onClick={() => navigate(-1)}>חזרה</button>
          </p>
        )}
      </div>
    </div>
  );
}
