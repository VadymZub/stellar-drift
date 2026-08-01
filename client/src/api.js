// Stellar Drift API client
// Token хранится в sessionStorage — живёт до закрытия вкладки.

// location.hostname, не жёсткий 'localhost' — иначе со второго ПК в локальной сети
// клиент лез бы на свой собственный localhost вместо машины с сервером.
//
// Исключение — Tauri prod-сборка: там страница отдаётся с tauri.localhost (встроенный
// фронтенд, не наш http.server), так что location.hostname не укажет ни на что реальное.
// В dev-режиме (браузер ИЛИ `cargo tauri dev`, у которого devUrl = localhost:8080)
// hostname остаётся 'localhost' как раньше — эта ветка вообще не участвует.
export const isTauriProd = location.hostname === 'tauri.localhost';
// Webdock VPS (193.180.215.8), не Render — см. память deployment_hosting_plan.
// nginx проксирует /api/ -> 127.0.0.1:8000/ (префикс срезается), backend-роуты
// сами по себе БЕЗ /api (main.py: /auth/login, /player/state, /ws/chat, ...).
const PROD_HOST = 'stellar-drift-mmo.duckdns.org';
// Развилка НЕ ТОЛЬКО по isTauriProd — у неё второй, отдельный сценарий: admin.html
// "Test Mode" открывает index.html обычным браузером ПРЯМО на проде
// (https://stellar-drift-mmo.duckdns.org), там location.hostname — реальный
// домен, не tauri.localhost, но и не dev-сервер — бывший код всё равно уходил
// в dev-ветку (http://<домен>:8000), а 8000 наружу не торчит + https-страница
// блокирует http-запрос как mixed content (диалог: "создание тестового профиля
// из админ панели - не работает на проде"). И dev (браузер/cargo tauri dev), и
// LAN-доступ со второго ПК всегда голый http — только по нему и различаем.
//
// !isTauriProd ОБЯЗАТЕЛЕН здесь тоже — не только у DEV_MODE ниже. Реальный
// перехваченный запрос из devtools собранного приложения (диалог: "curl
// 'http://tauri.localhost:8000/auth/login'") доказал: location.protocol внутри
// Tauri-рантайма — 'http:', не 'https:' (предположение про secure context для
// Web Crypto было ошибочным). Без этого guard'а isDevHttp был true и в самом
// приложении — оно билось в http://tauri.localhost:8000, который никуда не ведёт
// ("Failed to fetch"), вместо настоящего https://stellar-drift-mmo.duckdns.org/api.
const isDevHttp = !isTauriProd && location.protocol === 'http:';
export const API_BASE = isDevHttp ? `http://${location.hostname}:8000` : `https://${PROD_HOST}/api`;
export const WS_BASE  = isDevHttp ? `ws://${location.hostname}:8000`  : `wss://${PROD_HOST}/api`;

// DEV_MODE (dev-хоткеи, dev-кредиты/честь, TestProfileScene skip-auth) раньше было
// `!isTauriProd` — это ЛОМАЛОСЬ ровно там же, где чинили API_BASE выше: обычный
// браузер на ПРОД-домене (не только admin.html Test Mode — ЛЮБОЙ visit, включая
// нормальную регистрацию через confirm-диалог теста дубликата почты) тоже получал
// isTauriProd=false и потому DEV_MODE=true — реальный игрок, зашедший в браузер
// напрямую, получал уровень 41/dev-кредиты/переключатель премиума (диалог: "акаунт
// в дев режиме, 41 уровень, кастомное переключение премиума" — Вадим_04, созданный
// как раз таким браузерным тестом).
const isExplicitDevMode = new URLSearchParams(location.search).get('devMode') === '1';
// Первая попытка (isDevHttp || isExplicitDevMode, без учёта isTauriProd) СНОВА не
// сработала — та же DEV-ссылка вылезла уже в СОБРАННОМ Tauri-приложении (диалог:
// "это приложение" в ответ на прямой вопрос, подтверждено: "с браузера нормально").
// Похоже, location.protocol внутри Tauri-рантайма тоже 'http:' (см. isDevHttp выше),
// а не 'https:', как предполагалось раньше (комментарий про Web Crypto/secure context
// был ошибочным выводом, не проверенным фактом) — isDevHttp ложно засчитывал сам
// пакованный апп как локальную разработку. isTauriProd (по hostname==='tauri.localhost',
// НЕ по protocol) уже доказанно надёжен — на нём же строится рабочий API_BASE выше —
// поэтому теперь жёстко исключаем его из DEV_MODE независимо от protocol/isDevHttp.
export const DEV_MODE = !isTauriProd && (isDevHttp || isExplicitDevMode);

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
  } catch (err) {
    // Реальная причина сетевого сбоя раньше терялась целиком (диалог: "принципи не
    // создает акаунт, даже с новой почтой" в собранном приложении, где нет devtools,
    // чтобы увидеть исходную ошибку fetch()) — теперь она видна прямо в UI-сообщении,
    // а не только в консоли, которой в prod-сборке Tauri попросту нет.
    throw new Error(`Сервер недоступен (${err?.name || 'Error'}: ${err?.message || 'unknown'})`);
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

// ── Арена (дневной лимит награждённых матчей — см. server ArenaDaily) ───────
export function arenaStatus(dayKey) {
  return apiGet(`/arena/status?dayKey=${encodeURIComponent(dayKey)}`);
}
export function arenaMatchComplete(dayKey, matchId, outcome) {
  return apiPost('/arena/match-complete', { dayKey, matchId, outcome });
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
export function changeEmail(currentPassword, newEmail, confirmDuplicateEmail = false) {
  return apiPost('/auth/change-email', {
    current_password: currentPassword, new_email: newEmail,
    confirm_duplicate_email: confirmDuplicateEmail,
  });
}
export function changeUsername(newUsername) {
  return apiPost('/auth/change-username', { new_username: newUsername });
}

// ── Чёрный список (Milestone 3) ──────────────────────────────────────────
export function blacklistList()          { return apiGet('/player/blacklist'); }
export function blacklistAdd(username)   { return apiPost('/player/blacklist', { username }); }
export function blacklistRemove(username) { return apiDelete(`/player/blacklist/${encodeURIComponent(username)}`); }
