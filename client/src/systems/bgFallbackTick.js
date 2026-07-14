// Фаза 1 (план: ship travel & regen survive backgrounded tab). Phaser's rAF-driven
// game loop (движение через Arcade Physics body.velocity + шаг мира, реген щита/корпуса
// в Player.update()) полностью замирает, пока вкладка свёрнута/не в фокусе — requestAnimationFrame
// у бэкграунд-вкладок браузеры не вызывают. Этот модуль — дешёвый setInterval-фоллбек
// (~1 Гц, работает на таймерах, которые браузер всё-таки продолжает тикать в фоне),
// который проталкивает курс корабля и реген реальным Date.now()-дельта временем, пока
// вкладка скрыта. НЕ серверная симуляция — не помогает при полностью закрытой вкладке
// (см. Фазу 2) и не двигает мобов/бой, только собственный корабль игрока.

const TICK_MS = 1000;
const MAX_DT_SEC = 30; // safety cap — защита от аномально большого прыжка dt после троттлинга ОС

let started = false;
let sceneRef = null;
let lastRealTime = null;

// Idempotent — безопасно вызывать из GameScene.create() на каждом scene.restart()
// (смена сектора): слушатель/интервал ставятся один раз за вкладку, sceneRef каждый
// раз обновляется на актуальный (тот же объект сцены, GameScene переиспользуется).
export function startBgFallbackTick(scene) {
  sceneRef = scene;
  if (started) return;
  started = true;

  document.addEventListener('visibilitychange', () => {
    // Не считаем время скрытия ДО этого момента — отсчёт реального дельта-времени
    // начинается с момента ухода в фон, а не с последнего реального кадра.
    if (document.hidden) lastRealTime = Date.now();
  });

  setInterval(() => {
    if (!document.hidden) return;
    const gs = sceneRef;
    const p = gs?.player;
    const now = Date.now();
    if (lastRealTime == null) lastRealTime = now;
    if (!gs || !p || !p.alive || gs.jumping) { lastRealTime = now; return; }

    const dt = Math.min(MAX_DT_SEC, (now - lastRealTime) / 1000);
    lastRealTime = now;
    if (dt <= 0) return;

    // Двигаем внутренние часы сцены вперёд на реальное прошедшее время — Player.update()
    // считает задержку реген-щита (now - lastDamageAt) от this.scene.time.now, который
    // без этого не двигается вовсе, пока rAF не тикает. Безвредно: как только вкладка
    // снова активна, реальный rAF-кадр перезапишет this.time.now абсолютным значением.
    gs.time.now += dt * 1000;

    const inSafe = gs.inSafeZone(p.x, p.y);
    gs.movement.update(dt, inSafe);

    // Movement.update() лишь выставляет body.velocity — саму позицию интегрирует шаг
    // физического мира Arcade Physics, который (как и rAF) не выполняется в фоне.
    // Интегрируем позицию вручную тем же dt, иначе корабль оставит курс, но не полетит.
    const body = p.sprite.body;
    if (body) {
      p.sprite.x += body.velocity.x * dt;
      p.sprite.y += body.velocity.y * dt;
      gs.movement.clampToWorld();
    }

    // faceAngle=null — боевая наводка на цель не симулируется в фоне (только курс/реген).
    p.update(dt, inSafe, null);
  }, TICK_MS);
}
