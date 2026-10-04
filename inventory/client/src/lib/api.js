/**
 * כל קריאה לשרת עוברת דרך המודול הזה.
 * מרכז את הטוקן, את טיפול השגיאות ואת פורמט הבקשות במקום אחד.
 */

const TOKEN_KEY = 'inventory.token';
const USER_KEY = 'inventory.user';

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
    response = await fetch(`/api${path}`, {
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
    if (!path.startsWith('/auth/login')) window.location.href = '/login';
    throw new ApiError(401, 'ההתחברות פגה');
  }

  if (!response.ok) {
    let payload = {};
    try { payload = await response.json(); } catch (_) { /* גוף לא JSON */ }
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

  listCategories: () => get('/categories'),
  createCategory: (body) => post('/categories', body),
  listLocations: () => get('/locations'),
  createLocation: (body) => post('/locations', body),

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
