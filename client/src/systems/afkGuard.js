// Общий анти-AFK: 5 минут без ввода (мышь/клавиатура/тач) — дисконнект (полный релоад
// страницы, возврат на экран логина). НЕ привязан к функционалу добывающих баз —
// действует всегда, пока идёт игровая сессия, независимо от того, какая Phaser-сцена
// сейчас активна/сверху (слушаем на document, а не на конкретной сцене).
import { clearSession } from '../api.js';

const IDLE_LIMIT_MS = 5 * 60 * 1000;
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];

let lastActivity = Date.now();
let started = false;

function markActivity() { lastActivity = Date.now(); }

// Idempotent — безопасно вызывать из GameScene.create() при каждом scene.restart()
// (смена сектора), слушатели/интервал ставятся только один раз за вкладку.
export function startAfkGuard() {
  if (started) return;
  started = true;
  lastActivity = Date.now();
  ACTIVITY_EVENTS.forEach(ev => document.addEventListener(ev, markActivity, { passive: true }));
  setInterval(() => {
    if (Date.now() - lastActivity >= IDLE_LIMIT_MS) {
      clearSession();
      location.reload();
    }
  }, 5000);
}
