// Stellar Drift API client
// Token хранится в sessionStorage — живёт до закрытия вкладки.

// location.hostname, не жёсткий 'localhost' — иначе со второго ПК в локальной сети
// клиент лез бы на свой собственный localhost вместо машины с сервером.
export const API_BASE = `http://${location.hostname}:8000`;

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
  // Без токена всё, кроме /auth/* (login/register — им токен и не положен), всё равно
  // получит 403 от HTTPBearer на сервере — не шлём запрос вообще. Актуально для
  // DEV-профиля (TestProfileScene) без реального логина: иначе каждая смерть/убийство
  // моба/etc. шумит в консоли неудачным сетевым запросом.
  if (!token && !path.startsWith('/auth/')) {
    throw new Error('Нет токена авторизации');
  }
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
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return body;
}

export function apiPost(path, data)  { return apiFetch(path, { method: 'POST',  body: JSON.stringify(data) }); }
export function apiGet(path)         { return apiFetch(path, { method: 'GET' }); }
export function apiPut(path, data)   { return apiFetch(path, { method: 'PUT',   body: JSON.stringify(data) }); }
export function apiPatch(path, data) { return apiFetch(path, { method: 'PATCH', body: JSON.stringify(data) }); }
export function apiDelete(path)      { return apiFetch(path, { method: 'DELETE' }); }

// ── Данж-инстансы (жизни, прогресс) ─────────────────────────────────────
export function dungeonStatus(key, dayKey) {
  return apiGet(`/dungeon/status?key=${encodeURIComponent(key)}&dayKey=${encodeURIComponent(dayKey)}`);
}
export function dungeonEnter(body)              { return apiPost('/dungeon/enter', body); }
export function dungeonMobKilled(runId, mobId)  { return apiPost('/dungeon/mob_killed', { runId, mobId }); }
export function dungeonLootDrop(runId, loot)    { return apiPost('/dungeon/loot_drop', { runId, loot }); }
export function dungeonLootCollected(runId, lootId) { return apiPost('/dungeon/loot_collected', { runId, lootId }); }
export function dungeonCorridorState(runId, state)  { return apiPost('/dungeon/corridor_state', { runId, state }); }
export function dungeonDeath(key, dayKey)       { return apiPost('/dungeon/death', { key, dayKey }); }
export function dungeonComplete(runId, key, dayKey, memberUsernames) {
  return apiPost('/dungeon/complete', { runId, key, dayKey, memberUsernames });
}

// ── Добывающие базы (общие для всех игроков сектора, не user-scoped) ────────
export function miningBaseSector(sector) {
  return apiGet(`/mining_base/sector/${encodeURIComponent(sector)}`);
}
export function miningBaseSave(baseId, sector, state) {
  return apiPost('/mining_base/save', { baseId, sector, state });
}

// ── Профиль игрока (Milestone 2+) ───────────────────────────────────────
export function profileGetMine()        { return apiGet('/player/profile'); }
export function profileGet(username)    { return apiGet(`/player/profile/${encodeURIComponent(username)}`); }
export function profileUpdate(patch)    { return apiPatch('/player/profile', patch); }

// ── Личные сообщения (Milestone 5) ──────────────────────────────────────
export function mailInbox(withUser, opts = {}) {
  const params = new URLSearchParams({ with_user: withUser });
  if (opts.limit)    params.set('limit', opts.limit);
  if (opts.beforeId) params.set('before_id', opts.beforeId);
  return apiGet(`/player/pm/history?${params}`);
}
export function mailUnreadSummary()     { return apiGet('/player/pm/unread-summary'); }
export function mailMarkRead(messageIds) { return apiPost('/player/pm/mark-read', { message_ids: messageIds }); }
export function mailThreads()           { return apiGet('/player/pm/threads'); }

// ── Верификация email / смена пароля-почты ───────────────────────────────
export function verifyEmail(code)           { return apiPost('/auth/verify-email', { code }); }
export function resendVerification()        { return apiPost('/auth/resend-verification', {}); }
export function changePassword(currentPassword, newPassword) {
  return apiPost('/auth/change-password', { current_password: currentPassword, new_password: newPassword });
}
export function changeEmail(currentPassword, newEmail) {
  return apiPost('/auth/change-email', { current_password: currentPassword, new_email: newEmail });
}
export function changeUsername(newUsername) {
  return apiPost('/auth/change-username', { new_username: newUsername });
}

// ── Чёрный список (Milestone 3) ──────────────────────────────────────────
export function blacklistList()          { return apiGet('/player/blacklist'); }
export function blacklistAdd(username)   { return apiPost('/player/blacklist', { username }); }
export function blacklistRemove(username) { return apiDelete(`/player/blacklist/${encodeURIComponent(username)}`); }
