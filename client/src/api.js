// Stellar Drift API client
// Token хранится в sessionStorage — живёт до закрытия вкладки.

export const API_BASE = 'http://localhost:8000';

const TOKEN_KEY   = 'sd_token';
const USERNAME_KEY = 'sd_username';

export function getToken()    { return sessionStorage.getItem(TOKEN_KEY); }
export function getUsername() { return sessionStorage.getItem(USERNAME_KEY) || 'Player'; }

export function setSession(token, username) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USERNAME_KEY, username);
}

export function clearSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USERNAME_KEY);
}

// Базовый fetch с Authorization-заголовком и JSON-парсингом.
// Бросает Error с .message из тела ответа при ошибке.
async function apiFetch(path, opts = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(API_BASE + path, { ...opts, headers });
  } catch (_) {
    throw new Error('Сервер недоступен');
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = body.detail;
    const msg = Array.isArray(d)
      ? d.map(e => e.msg?.replace(/^Value error, /, '') ?? e.message).join('; ')
      : (d || `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return body;
}

export function apiPost(path, data)  { return apiFetch(path, { method: 'POST',  body: JSON.stringify(data) }); }
export function apiGet(path)         { return apiFetch(path, { method: 'GET' }); }
export function apiPut(path, data)   { return apiFetch(path, { method: 'PUT',   body: JSON.stringify(data) }); }
