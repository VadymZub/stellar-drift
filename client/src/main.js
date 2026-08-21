import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { COLORS, DPR } from './constants.js';
import BootScene from './scenes/BootScene.js';
import LoginScene from './scenes/LoginScene.js';
import CorpSelectScene from './scenes/CorpSelectScene.js';
import BackgroundScene from './scenes/BackgroundScene.js';
import GameScene from './scenes/GameScene.js';
import HudScene from './scenes/HudScene.js';
import InventoryScene from './scenes/InventoryScene.js';
import CargoScene from './scenes/CargoScene.js';
import ClanScene from './scenes/ClanScene.js';
import GarageScene from './scenes/GarageScene.js';
import MapScene from './scenes/MapScene.js';
import MissionsScene from './scenes/MissionsScene.js';
import ShopScene from './scenes/ShopScene.js';
import DonateScene from './scenes/DonateScene.js';
import CorpScene from './scenes/CorpScene.js';
import BaseMenuScene from './scenes/BaseMenuScene.js';
import SkillScene from './scenes/SkillScene.js';
import TestProfileScene from './scenes/TestProfileScene.js';
import ShadowBattleScene from './scenes/ShadowBattleScene.js';
import SettingsScene from './scenes/SettingsScene.js';
import ProfileScene from './scenes/ProfileScene.js';
import ProfileViewScene from './scenes/ProfileViewScene.js';
import MailScene from './scenes/MailScene.js';
import ArenaLobbyScene from './scenes/ArenaLobbyScene.js';
import StatsScene from './scenes/StatsScene.js';
import HistoryScene from './scenes/HistoryScene.js';
import { loadSettings } from './settings.js';
import { checkForUpdates } from './updater.js';
import { domConfirm } from './domConfirm.js';

// Canvas at physical pixel resolution. CSS canvas element uses image-rendering:pixelated
// for nearest-neighbour CSS scaling — eliminates bilinear blur at non-integer DPR
// (e.g. Windows 125% = 0.8× CSS downscale, NN has no blur artifact).
const W = () => Math.floor(window.innerWidth  * DPR);
const H = () => Math.floor(window.innerHeight * DPR);

// antialiasGL умножает fill-rate стоимость каждого draw call'а — одна из самых
// дорогих настроек рендера на слабых встроенных GPU (Intel Iris Xe и т.п.), поэтому
// вынесено в настройки (SettingsScene → "Графика"). Читается ОДИН раз при загрузке
// страницы — Phaser не умеет менять antialias/antialiasGL у уже созданного WebGL-
// контекста на лету, так что смена настройки требует перезагрузки (см. SettingsScene._save()).
const _aa = loadSettings().antialiasing;

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: COLORS.bg,
  scale: {
    // NONE: Phaser не трогает CSS — мы сами выставляем размер канваса в пикселях окна.
    // Это устраняет искажения FIT при нецелых DPR (Windows 125%, 150% и т.д.).
    mode: Phaser.Scale.NONE,
    width: W(),
    height: H(),
  },
  render: {
    antialias: _aa,
    antialiasGL: _aa,
    // false — раньше true вызывало дёрганье движения корабля: скорость игрока часто
    // дробная (напр. ~3.33px/кадр), roundPixels снапил КАЖДЫЙ кадр отрисовки к целому
    // пикселю, из-за чего вместо равномерного шага получалась пила "0px, затем 2×шаг"
    // (подтверждено замером per-frame дельт позиции + визуально пользователем — "корабль
    // дёргался, я видел"). Крепости изображения это не касается — она уже держится на
    // pixelArt:false + физическом разрешении канваса + NN CSS-скейле (см. IMPL_NOTES
    // "Чёткость спрайтов"), не на снэппинге позиции; сравнение скриншотов до/после не
    // показало никакой потери резкости текста/спрайтов.
    roundPixels: false,
    powerPreference: 'high-performance',
    pixelArt: false,
    mipmapFilter: 'LINEAR',
  },
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  // Без этого зависшая XHR-загрузка ассета (напр. после сна вкладки/флапающего Wi-Fi при
  // разворачивании после сворачивания) никогда не завершается ни успехом, ни ошибкой —
  // очередь Loader'а не добирает 'complete', BootScene._finishCreate() не срабатывает,
  // сплэш-заставка "STELLAR DRIFT…" (index.html) висит вечно без единого сообщения об
  // ошибке (см. диалог "должно быть окно — потеряно соединение").
  loader: { timeout: 20000 },
  scene: [
    BootScene, LoginScene, CorpSelectScene, BackgroundScene, TestProfileScene, GameScene, HudScene,
    InventoryScene, CargoScene, ClanScene, GarageScene, MapScene, MissionsScene, ShopScene, DonateScene, CorpScene, BaseMenuScene, SkillScene, ShadowBattleScene, SettingsScene, ProfileScene, ProfileViewScene, MailScene, ArenaLobbyScene, StatsScene, HistoryScene,
  ],
};

// Watchdog: сплэш "STELLAR DRIFT…" (index.html) всё ещё в DOM через 30с после старта
// страницы — оба таймаута ниже (4с шрифты + 20с Loader, см. config.loader.timeout выше)
// уже должны были истечь и пропустить дальше, значит что-то совсем не задалось (например
// необработанное исключение до первого Phaser.Game). Раньше в этом случае пользователь
// видел зависший сплэш без единого сообщения об ошибке и без способа выйти из этого
// состояния (см. диалог "должно быть окно — потеряно соединение").
setTimeout(() => {
  const el = document.getElementById('loading');
  if (!el) return; // уже убран BootScene._finishCreate() — загрузка прошла нормально
  el.style.pointerEvents = 'auto';
  el.style.cursor = 'pointer';
  el.innerHTML = '<span>Загрузка зависла</span>'
    + '<span style="font-size:12px;margin-top:14px;color:#88bbaa;letter-spacing:1px;">Нажмите, чтобы перезагрузить страницу</span>';
  el.addEventListener('click', () => location.reload());
}, 30000);

// document.fonts.ready ждёт и внешний Google Fonts CSS (index.html) — если этот запрос
// подвиснет (тот же сценарий: разворачивание вкладки после сна/флапающая сеть), игра
// НИКОГДА даже не создаётся (Phaser.Game ни разу не вызывается), сплэш "STELLAR DRIFT…"
// висит вечно. Гонка с таймаутом — шрифты не критичны для старта, максимум чуть кривой
// первый кадр текста до их фактической подгрузки.
Promise.race([
  document.fonts.ready,
  new Promise(resolve => setTimeout(resolve, 4000)),
]).catch(() => {}).then(() => {
  const game = new Phaser.Game(config);
  checkForUpdates(); // no-op outside a real Tauri window (see updater.js)
  _bindCloseConfirm(game); // no-op outside a real Tauri window — see below

  function fitCanvas() {
    const c = game.canvas;
    if (!c) return;
    c.style.width  = Math.floor(window.innerWidth)  + 'px';
    c.style.height = Math.floor(window.innerHeight) + 'px';
    c.style.display = 'block';
  }

  fitCanvas();

  let _resizeRaf = null;
  let _lastW = window.innerWidth, _lastH = window.innerHeight;
  function scheduleResize() {
    // Debounce via rAF: let the browser commit the new layout before Phaser
    // re-reads getBoundingClientRect() for input coordinate transforms.
    if (_resizeRaf) cancelAnimationFrame(_resizeRaf);
    _resizeRaf = requestAnimationFrame(() => {
      _lastW = window.innerWidth; _lastH = window.innerHeight;
      const gw = W(), gh = H();
      game.scale.resize(gw, gh);
      // game.scale.resize() выше меняет только canvas.width/height (атрибут) и
      // ScaleManager.width/height — САМ WebGL-рендерер (его внутренний viewport/
      // drawing buffer size) в Scale.NONE НЕ подхватывает это автоматически (это делает
      // ScaleManager только в FIT/RESIZE режимах). Без явного renderer.resize() рендерер
      // продолжал рисовать в границах СТАРОГО размера — новая, увеличившаяся область
      // холста оставалась просто ПУСТОЙ/чёрной (её GL-буфер отрисовки никогда не
      // получал новых пикселей), хотя canvas.width/camera.width уже отчитывались
      // "правильным" новым числом (баг из диалога: "снова чёрная область при ресайзе" —
      // подтверждено диагностикой: game.renderer.width оставался старым).
      game.renderer.resize(gw, gh);
      fitCanvas();
      game.scale.refresh?.();   // recalculate canvas bounds for input hit-testing
      // Scale.NONE (см. config выше) — Phaser сам НЕ трогает камеры сцен на resize (это
      // поведение только у FIT/RESIZE-режимов), game.scale.resize() выше обновляет
      // ТОЛЬКО width/height самого ScaleManager (то, что читает GameScene.createBackground
      // resize-хендлер и HUD-позиционирование через this.scale.width/height). Камера же
      // каждой сцены остаётся зафиксирована на размере окна МОМЕНТА СОЗДАНИЯ сцены —
      // холст растягивался, а игровой мир/HUD (camera-bound, scrollFactor(0) не спасает,
      // это позиция ВНУТРИ вьюпорта, не сам вьюпорт) обрывались по старой границе, за
      // которой канвас просто чист/чёрный (баг из диалога: "смена разрешения окна —
      // чёрная область вместо игровых элементов"). Ресайзим камеру КАЖДОЙ активной сцены
      // явно — общее место для всех сцен разом, не нужно чинить в каждом файле отдельно.
      //
      // game.scene.getScenes(true) — ТОЛЬКО активные НА МОМЕНТ ЭТОГО resize сцены. Оверлеи
      // (BaseMenuScene/GarageScene/ClanScene/CorpScene/ShopScene/SkillScene/CargoScene/
      // ShadowBattleScene/ArenaScene — всё, что открывается через нав-бар на базе) в момент
      // ресайза почти всегда НЕАКТИВНЫ (игрок либо летает, либо ещё не докнулся) — их
      // камера просто никогда не попадала в этот цикл и застревала на размере МОМЕНТА
      // СОЗДАНИЯ (обычно размер окна при старте игры) навечно, до следующего resize, в
      // который они случайно окажутся активны. При первом же открытии такой сцены после
      // ресайза её вьюпорт — то самое старое узкое окно, а всё, что за его правым краем,
      // это уже GameScene (он-то в active-списке был и получил новый размер) — экран
      // раскалывается пополам по старой границе окна (баг из диалога, скрин: разворачиваем
      // окно, заходим в меню базы → левая половина старого размера, правая — новый мир).
      // Чаще воспроизводится через нав-бар (каждая кнопка — ДРУГАЯ сцена, у каждой свой
      // независимый "невезучий" момент создания), чем через хоткеи (часто повторно
      // открывают ОДНУ уже когда-то попавшую в активный список сцену). Фикс — резайзим
      // камеру ВСЕХ зарегистрированных сцен без разбора активности (game.scene.scenes —
      // полный сырой список, а не отфильтрованный getScenes(true)).
      for (const scene of game.scene.scenes) {
        scene.cameras?.main?.setSize(gw, gh);
      }
      _resizeRaf = null;
    });
  }
  window.addEventListener('resize', scheduleResize);
  // window.resize не всегда надёжно ловит смену РАЗРЕШЕНИЯ ЭКРАНА (в отличие от смены
  // размера самого окна браузера) — на части связок браузер/ОС событие не приходит вовсе
  // или приходит со старыми (ещё не осевшими) innerWidth/innerHeight, оставляя канвас
  // застрявшим на старом размере посреди уже большего окна — часть игрового поля/HUD
  // оказывается недоступна за пределами старой области (баг из диалога: "при смене
  // разрешения экрана часть элементов игрового поля закрыта/недоступна"). ResizeObserver
  // на <html> — более надёжный сигнал именно "реальный CSS-размер вьюпорта изменился",
  // независимо от того, какое событие браузер решил (не) прислать. Опрос раз в 500мс —
  // дешёвый бэкстоп на случай, если ни один из двух сигналов выше не сработал.
  new ResizeObserver(() => {
    if (window.innerWidth !== _lastW || window.innerHeight !== _lastH) scheduleResize();
  }).observe(document.documentElement);
  setInterval(() => {
    if (window.innerWidth !== _lastW || window.innerHeight !== _lastH) scheduleResize();
  }, 500);
});

// Подтверждение на крестик окна (диалог: "можно выйти из игры некорректно" + "предупредить
// что нужно выходить по кнопке выхода") — раньше крестик закрывал приложение мгновенно,
// без шанса передумать и без напоминания про штатный logout (HudScene ⏻, 5с отсчёт,
// корректно шлёт clearSession()/останавливает сцены). Автосейв на visibilitychange→hidden
// (см. GameScene.js) технически должен успевать сработать и на крестик, так что риск тут
// в основном UX-ный (случайный клик по крестику посреди боя), а не гарантированная потеря
// сохранения — но предупреждение не помешает в любом случае.
// Диагностика прямо на экране (не консоль — диалог: "я не умею" искать её/фильтры
async function _bindCloseConfirm(game) {
  // НЕ isTauriProd — тот означает конкретно упакованное прод-приложение (хост
  // tauri.localhost). cargo tauri dev грузится с обычного http://localhost:8080
  // (см. tauri.conf.json devUrl) — тот же самый настоящий Tauri-рантайм/API, просто
  // isTauriProd там всегда false (диалог: "выключилось без диалога" — код выходил
  // на этой строке, ничего даже не пробовав; DEV_MODE=true в cargo tauri dev — та же
  // причина, см. CLAUDE.md). Правильная проверка — есть ли Tauri-мост вообще, а не
  // прод ли это конкретно. Подтверждено рабочим на реальном крестике (диалог "есть").
  if (!window.__TAURI__) return; // обычная браузерная вкладка — крестика такого нет
  const appWindow = window.__TAURI__.window?.getCurrentWindow?.();
  if (!appWindow?.onCloseRequested) return;

  await appWindow.onCloseRequested(async (event) => {
    event.preventDefault();
    // domConfirm рисует message через textContent без white-space:pre-line — перенос
    // строки \n не отрисуется как реальный разрыв, поэтому одним предложением, а не
    // двумя абзацами.
    const inGame = game.scene.isActive('GameScene');
    const msg = inGame
      ? 'Рекомендуется выходить через кнопку ⏻ в игре — это гарантирует сохранение. Всё равно закрыть приложение?'
      : 'Закрыть приложение?';
    const ok = await domConfirm(msg, { okText: 'Закрыть', cancelText: 'Остаться' });
    if (ok) appWindow.destroy();
  });
}
