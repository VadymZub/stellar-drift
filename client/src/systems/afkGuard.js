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
  // Вкладка в фоне (свёрнута/не в фокусе другой вкладкой) физически не может получать
  // input-события — это НЕ то же самое, что игрок бросил персонажа посреди игры (смысл
  // анти-AFK выше). Без этой проверки любая вкладка, оставленная в фоне на 5+ минут,
  // гарантированно ловила location.reload() ровно в момент возврата на неё (баг из
  // диалога: "если вкладка неактивна то постоянно зависает" — "зависание" и было этим
  // реалоадом). Не считаем время в фоне простоем, и засчитываем сам возврат видимости
  // как активность — даёт полные 5 мин с момента реального возврата, а не с последнего
  // ввода до сворачивания (который мог быть часы назад).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) markActivity();
  });
  setInterval(() => {
    if (document.hidden) return;
    if (Date.now() - lastActivity >= IDLE_LIMIT_MS) {
      clearSession();
      location.reload();
    }
  }, 5000);
}
