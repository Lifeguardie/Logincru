/**
 * כל קריאה לשרת עוברת דרך המודול הזה.
 * מרכז את הטוקן, את טיפול השגיאות ואת פורמט הבקשות במקום אחד.
 */

const TOKEN_KEY = 'inventory.token';
const USER_KEY = 'inventory.user';
const SERVER_KEY = 'inventory.serverUrl';

/** האם רצים בתוך אפליקציית Android/iOS (Capacitor) ולא בדפדפן */
export function isNative() {
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

/**
 * כתובת השרת. בווב ריק = same-origin (השרת מגיש גם את הלקוח).
 * באפליקציה הנייטיב אין "same origin" - הכתובת נשמרת פעם אחת בהגדרה.
 */
export function getServerUrl() {
  try {
    return (localStorage.getItem(SERVER_KEY) || '').replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
}

export function setServerUrl(url) {
  try {
    localStorage.setItem(SERVER_KEY, String(url || '').trim().replace(/\/+$/, ''));
  } catch (_) { /* לא קריטי */ }
}

/** בודק שכתובת מובילה לשרת המלאי. לא שומר כלום */
export async function checkServer(url) {
  const base = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/.+/.test(base)) throw new Error('כתובת חייבת להתחיל ב-http:// או https://');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${base}/api/health`, { signal: controller.signal });
    if (!response.ok) throw new Error(`השרת ענה ${response.status}`);
    const data = await response.json();
    if (!data.ok) throw new Error('הכתובת לא מובילה לשרת המלאי');
    return base;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('אין תגובה מהשרת (8 שניות). בדוק כתובת ורשת');
    throw new Error(err.message === 'Failed to fetch' ? 'לא ניתן להתחבר. בדוק כתובת, פורט ורשת' : err.message);
  } finally {
    clearTimeout(timer);
  }
}

/** ניווט מלא. ב-WebView הנתיבים הם hash, בווב רגיל - path */
export function hardNavigate(path) {
  window.location.href = isNative() ? `#${path}` : path;
}

/** הנתיב הנוכחי, בלי תלות בסוג הראוטר */
export function currentPath() {
  return isNative() ? (window.location.hash.replace(/^#/, '') || '/') : window.location.pathname;
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (_) {
    return null;
  }
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

export function setSession(token, user) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch (_) {
    // גלישה פרטית או אחסון חסום - הסשן יחזיק רק עד רענון הדף
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch (_) { /* לא קריטי */ }
}

/** שגיאה שמגיעה מהשרת, עם קוד הסטטוס כדי שהמסכים יוכלו להבחין בין 401 ל-409 */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(method, path, { body, formData, raw } = {}) {
  const headers = {};
  const token = getToken();

  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${getServerUrl()}/api${path}`, {
      method,
      headers,
      body: formData || (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch (_) {
    // כשל רשת אמיתי - הקורא מבחין בזה לפי status 0 ויכול להכניס לתור
    throw new ApiError(0, 'אין חיבור לשרת');
  }

  if (response.status === 401) {
    clearSession();
    // רענון מלא מחזיר למסך ההתחברות בלי לנהל מצב גלובלי מסובך
    if (!path.startsWith('/auth/login')) hardNavigate('/login');
    throw new ApiError(401, 'ההתחברות פגה');
  }

  if (!response.ok) {
    let payload = {};
    try { payload = await response.json(); } catch (_) { /* גוף לא JSON */ }

    // השרת חוסם הכל עד להחלפת סיסמה - שולחים לשם
    if (response.status === 403 && payload.code === 'PASSWORD_CHANGE_REQUIRED'
        && currentPath() !== '/password') {
      hardNavigate('/password');
    }

    throw new ApiError(response.status, payload.error || `שגיאה ${response.status}`, payload.details);
  }

  if (raw) return response.blob();
  if (response.status === 204) return null;
  return response.json();
}

const get = (path) => request('GET', path);
const post = (path, body) => request('POST', path, { body });
const put = (path, body) => request('PUT', path, { body });
const del = (path) => request('DELETE', path);

/** בונה query string ומדלג על ערכים ריקים */
function qs(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** מוריד קובץ מנתיב מוגן. fetch ולא <a href> כי צריך את הטוקן בכותרת */
async function download(path, fallbackName) {
  const blob = await request('GET', path, { raw: true });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  login: (username, password) => post('/auth/login', { username, password }),
  me: () => get('/auth/me'),
  changePassword: (currentPassword, newPassword) => put('/auth/password', { currentPassword, newPassword }),

  listUsers: () => get('/users'),
  createUser: (body) => post('/users', body),
  updateUser: (id, body) => put(`/users/${id}`, body),
  resetUserPassword: (id, newPassword) => post(`/users/${id}/reset-password`, { newPassword }),

  listCategories: (params) => get(`/categories${qs(params)}`),
  createCategory: (body) => post('/categories', body),
  updateCategory: (id, body) => put(`/categories/${id}`, body),
  listLocations: (params) => get(`/locations${qs(params)}`),
  createLocation: (body) => post('/locations', body),
  updateLocation: (id, body) => put(`/locations/${id}`, body),
  getLocationItems: (id) => get(`/locations/${id}/items`),
  saveLocationOrder: (id, itemIds) => put(`/locations/${id}/order`, { itemIds }),

  listItems: (params) => get(`/items${qs(params)}`),
  getItem: (id) => get(`/items/${id}`),
  createItem: (body) => post('/items', body),
  updateItem: (id, body) => put(`/items/${id}`, body),
  addItemUnit: (itemId, body) => post(`/items/${itemId}/units`, body),
  updateItemUnit: (itemId, unitId, body) => put(`/items/${itemId}/units/${unitId}`, body),
  deleteItemUnit: (itemId, unitId) => del(`/items/${itemId}/units/${unitId}`),

  listCounts: () => get('/counts'),
  createCount: (body) => post('/counts', body),
  deleteCount: (countId) => del(`/counts/${countId}`),
  getSheet: (countId, locationId) => get(`/counts/${countId}/sheet?locationId=${locationId}`),
  getProgress: (countId) => get(`/counts/${countId}/progress`),
  saveLines: (countId, lines) => put(`/counts/${countId}/lines`, { lines }),
  closeCount: (countId) => post(`/counts/${countId}/close`),
  reopenCount: (countId) => post(`/counts/${countId}/reopen`),
  getSummary: (countId) => get(`/counts/${countId}/summary`),
  ocrStatus: () => get('/counts/ocr/status'),
  ocrSheet: (countId, locationId, imageBlob) => {
    const formData = new FormData();
    formData.append('locationId', String(locationId));
    formData.append('image', imageBlob, 'sheet.jpg');
    return request('POST', `/counts/${countId}/ocr`, { formData });
  },
  exportCount: (countId, name) => download(`/reports/counts/${countId}/export`, `${name}.xlsx`),

  listPurchases: (params) => get(`/purchases${qs(params)}`),
  createPurchase: (body) => post('/purchases', body),
  deletePurchase: (id) => del(`/purchases/${id}`),

  getConsumption: (openingCountId, closingCountId) =>
    get(`/reports/consumption${qs({ openingCountId, closingCountId })}`),
  exportConsumption: (openingCountId, closingCountId) =>
    download(`/reports/consumption/export${qs({ openingCountId, closingCountId })}`, 'דוח צריכה.xlsx'),

  previewItemsImport: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return request('POST', '/imports/items/preview', { formData });
  },
  commitItemsImport: (rows, updateExisting) =>
    post('/imports/items/commit', { rows, updateExisting }),
  previewPurchasesImport: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return request('POST', '/imports/purchases/preview', { formData });
  },
  commitPurchasesImport: (rows) => post('/imports/purchases/commit', { rows }),
};
