import { useEffect, useState } from 'react';
import { subscribe } from '../lib/queue';

/**
 * חיווי קבוע על מצב השמירה.
 * הסופר חייב לראות במבט אחד אם ההזנות הגיעו לשרת או ממתינות בתור.
 */
export default function QueueStatus() {
  const [state, setState] = useState({ pending: 0, flushing: false });
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => subscribe(setState), []);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (state.pending === 0 && online) return null;

  if (state.pending === 0 && !online) {
    return <div className="queue-status pending">אין רשת — הכל נשמר</div>;
  }

  return (
    <div className="queue-status pending">
      {state.flushing ? 'שומר…' : `${state.pending} הזנות ממתינות לשמירה`}
    </div>
  );
}
