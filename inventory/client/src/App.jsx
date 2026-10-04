import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import QueueStatus from './components/QueueStatus';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import CountSheet from './pages/CountSheet';
import CountSummary from './pages/CountSummary';
import Items from './pages/Items';
import ItemEditor from './pages/ItemEditor';
import ImportItems from './pages/ImportItems';
import Purchases from './pages/Purchases';
import Reports from './pages/Reports';
import ChangePassword from './pages/ChangePassword';
import Users from './pages/Users';
import Settings from './pages/Settings';
import SheetOrder from './pages/SheetOrder';
import ImportPurchases from './pages/ImportPurchases';

/** חוסם מסכים למי שלא מחובר, ומסכי ניהול למי שאין לו תפקיד מתאים */
function Protected({ children, minimumRole }) {
  const { user, checking, can } = useAuth();
  const location = useLocation();

  if (checking) return <div className="spinner">טוען…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (user.mustChangePassword && location.pathname !== '/password') {
    return <Navigate to="/password" replace />;
  }
  if (minimumRole && !can(minimumRole)) {
    return <div className="alert error">אין לך הרשאה לצפות במסך הזה</div>;
  }

  return children;
}

function Shell({ children }) {
  const { user, logout, can } = useAuth();

  return (
    <div className="app">
      <header className="topbar">
        <h1>ספירת מלאי</h1>
        <div className="spacer" />
        <NavLink to="/password" className="user" style={{ color: '#fff', textDecoration: 'none' }} title="החלפת סיסמה">
          {user.fullName}
        </NavLink>
        <button className="ghost small" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.5)' }} onClick={logout}>
          יציאה
        </button>
      </header>

      <nav className="nav">
        <NavLink to="/" end>ספירה</NavLink>
        <NavLink to="/items">פריטים</NavLink>
        {can('manager') && <NavLink to="/purchases">רכש</NavLink>}
        {can('manager') && <NavLink to="/reports">דוחות</NavLink>}
        {can('manager') && <NavLink to="/settings">הגדרות</NavLink>}
        {can('admin') && <NavLink to="/users">משתמשים</NavLink>}
      </nav>

      <main className="content">{children}</main>
      <QueueStatus />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route path="/*" element={
        <Protected>
          <Shell>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/counts/:countId/sheet/:locationId" element={<CountSheet />} />
              <Route path="/counts/:countId/summary" element={<CountSummary />} />
              <Route path="/items" element={<Items />} />
              <Route path="/items/new" element={<Protected minimumRole="manager"><ItemEditor /></Protected>} />
              <Route path="/items/:itemId" element={<Protected minimumRole="manager"><ItemEditor /></Protected>} />
              <Route path="/items/import" element={<Protected minimumRole="manager"><ImportItems /></Protected>} />
              <Route path="/purchases" element={<Protected minimumRole="manager"><Purchases /></Protected>} />
              <Route path="/purchases/import" element={<Protected minimumRole="manager"><ImportPurchases /></Protected>} />
              <Route path="/reports" element={<Protected minimumRole="manager"><Reports /></Protected>} />
              <Route path="/password" element={<ChangePassword />} />
              <Route path="/settings" element={<Protected minimumRole="manager"><Settings /></Protected>} />
              <Route path="/settings/locations/:locationId/order" element={<Protected minimumRole="manager"><SheetOrder /></Protected>} />
              <Route path="/users" element={<Protected minimumRole="admin"><Users /></Protected>} />
              <Route path="*" element={<div className="empty">הדף לא נמצא</div>} />
            </Routes>
          </Shell>
        </Protected>
      } />
    </Routes>
  );
}
