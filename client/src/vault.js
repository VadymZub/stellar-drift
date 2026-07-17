// Stellar Drift — локальный зашифрованный вейлт для мульти-аккаунтов (десктоп-клиент,
// см. диалог: "сохранение данных для акаунта, возможность сохранять несколько, перед
// сохранением вызывать мастер пароль, потом перед загрузкой аккаунтов вызывать мастер
// пароль"). Ключ AES-GCM выводится из мастер-пароля через PBKDF2 (Web Crypto API, без
// внешних зависимостей — проект без сборщика). Один JSON-блоб в localStorage (см.
// VAULT_KEY) — salt/iterations фиксируются при первом createVault(), iv/ciphertext
// перезаписываются при каждом save/remove (свежий IV на каждый вызов — с одним ключом
// повторно IV использовать нельзя). Разблокированный ключ и расшифрованный список живут
// ТОЛЬКО в памяти модуля, не персистятся — сброс при перезапуске приложения/перезагрузке
// страницы (так и задумано — "запоминать на сессию", не дольше).
//
// Это удобство, не enterprise-грейд защита: у того, кто имеет доступ к устройству и
// знает/подберёт мастер-пароль, будут все сохранённые аккаунты — тот же компромисс,
// что и у любого менеджера паролей.

const VAULT_KEY = 'sd_vault';
const PBKDF2_ITERATIONS = 300_000;

let _key = null;      // CryptoKey (AES-GCM 256), кэш на сессию
let _accounts = null; // расшифрованный [{username, password}], синхронизирован с _key

export function isCryptoAvailable() {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

function _bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function _b64ToBuf(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}

async function _deriveKey(masterPassword, saltB64, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(masterPassword), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: _b64ToBuf(saltB64), iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function _encryptAccounts(key, accounts) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(accounts))
  );
  return { iv: _bufToB64(iv), ciphertext: _bufToB64(ciphertext) };
}

async function _decryptAccounts(key, ivB64, ciphertextB64) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: _b64ToBuf(ivB64) }, key, _b64ToBuf(ciphertextB64)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

function _readBlob() {
  try { return JSON.parse(localStorage.getItem(VAULT_KEY)); } catch (_e) { return null; }
}
function _writeBlob(blob) {
  localStorage.setItem(VAULT_KEY, JSON.stringify(blob));
}

function _requireUnlocked() {
  if (!_key || !_accounts) throw new Error('Хранилище заблокировано');
}

export function hasVault() {
  return !!localStorage.getItem(VAULT_KEY);
}

export function isUnlocked() {
  return _key !== null;
}

export function lockVault() {
  _key = null;
  _accounts = null;
}

export async function createVault(masterPassword) {
  if (hasVault()) throw new Error('Хранилище уже существует');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltB64 = _bufToB64(salt);
  const key = await _deriveKey(masterPassword, saltB64, PBKDF2_ITERATIONS);
  const { iv, ciphertext } = await _encryptAccounts(key, []);
  _writeBlob({ salt: saltB64, iterations: PBKDF2_ITERATIONS, iv, ciphertext });
  _key = key;
  _accounts = [];
}

export async function unlockVault(masterPassword) {
  const blob = _readBlob();
  if (!blob) throw new Error('Хранилище не найдено');
  const key = await _deriveKey(masterPassword, blob.salt, blob.iterations);
  let accounts;
  try {
    accounts = await _decryptAccounts(key, blob.iv, blob.ciphertext);
  } catch (_e) {
    throw new Error('Неверный мастер-пароль');
  }
  _key = key;
  _accounts = accounts;
}

export async function saveAccount(username, password) {
  _requireUnlocked();
  const idx = _accounts.findIndex((a) => a.username === username);
  if (idx >= 0) _accounts[idx] = { username, password };
  else _accounts.push({ username, password });
  const blob = _readBlob();
  const { iv, ciphertext } = await _encryptAccounts(_key, _accounts);
  _writeBlob({ ...blob, iv, ciphertext });
}

export function listAccounts() {
  _requireUnlocked();
  return _accounts.map((a) => ({ username: a.username }));
}

export function getAccountPassword(username) {
  _requireUnlocked();
  const acc = _accounts.find((a) => a.username === username);
  if (!acc) throw new Error('Аккаунт не найден в хранилище');
  return acc.password;
}

export async function removeAccount(username) {
  _requireUnlocked();
  _accounts = _accounts.filter((a) => a.username !== username);
  const blob = _readBlob();
  const { iv, ciphertext } = await _encryptAccounts(_key, _accounts);
  _writeBlob({ ...blob, iv, ciphertext });
}
