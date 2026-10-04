import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/auth';
import { isNative } from './lib/api';
import './styles.css';

// באפליקציה הנייטיב הדף נטען מקובץ מקומי, ונתיב כמו /items לא קיים כקובץ -
// לכן hash routing. בווב הרגיל השרת מחזיר index.html לכל נתיב ו-BrowserRouter נשאר.
const Router = isNative() ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router>
      <AuthProvider>
        <App />
      </AuthProvider>
    </Router>
  </React.StrictMode>
);
