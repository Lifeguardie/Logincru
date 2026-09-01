import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, getStoredUser, getToken, setSession, clearSession } from './api';
import { clearQueue, flush } from './queue';

const AuthContext = createContext(null);

const ROLE_RANK = { counter: 1, manager: 2, admin: 3 };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());
  const [checking, setChecking] = useState(() => Boolean(getToken()));

  // מאמת מול השרת שהטוקן השמור עדיין תקף, כדי לא להציג מסכים למי שפג תוקפו
  useEffect(() => {
    if (!getToken()) {
      setChecking(false);
      return;
    }

    let cancelled = false;

    api.me()
      .then((data) => { if (!cancelled) setUser(data.user); })
      .catch(() => { if (!cancelled) setUser(null); })
      .finally(() => { if (!cancelled) setChecking(false); });

    return () => { cancelled = true; };
  }, []);

  const value = useMemo(() => ({
    user,
    checking,
    async login(username, password) {
      const data = await api.login(username, password);
      setSession(data.token, data.user);
      setUser(data.user);
      // אם נשארו הזנות מסשן קודם שפג תוקפו - שולחים אותן עכשיו, כשיש שוב טוקן
      flush();
      return data.user;
    },
    logout() {
      clearSession();
      clearQueue();
      setUser(null);
    },
    /** האם למשתמש יש לפחות את התפקיד הנתון */
    can(minimumRole) {
      return (ROLE_RANK[user?.role] || 0) >= (ROLE_RANK[minimumRole] || 99);
    },
  }), [user, checking]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth חייב לרוץ בתוך AuthProvider');
  return context;
}
