// Контейнер груза на арене (режим "Захват груза") — тонкий рендер-класс, как
// ArenaFlag.js: сервер авторитетен за спавном/подбором/доставкой (см. server/arena.py
// ArenaMatch.cargo, main.py arena_cargo_pickup/deliver), этот класс только рисует.
// Нет HP (см. правило "без общего HP, просто появляется") — только alive/carrier.
import { ARENA_TEAM_COLOR } from '../constants.js';
import { prerenderTex } from '../utils/prerenderTex.js';

const RING_PERIOD_MS = 1750;  // 1.5-2с полный цикл сжатия/расширения (см. диалог)
const RING_R_MIN = 60, RING_R_MAX = 82;  // достаточно, чтобы охватить корабль целиком
const DISPLAY_W = 56, DISPLAY_H = 52;

export default class ArenaCargoContainer {
  constructor(scene, x, y) {
    this.scene = scene;
    this.alive = true;
    this._carriedBy = null;
    this._carrierTeam = null;  // цвет подсветки по несущей команде, null = нейтраль
    this._x = x;
    this._y = y;
    this._baseY = y;
    // Позиция НЕСУЩЕГО корабля — отдельно от _x/_y (та смещена на -40 над кораблём,
    // см. ArenaController.update): кольцо должно охватывать сам корабль, а не
    // плавающую над ним иконку (см. диалог: "пульсирующее кольцо вокруг корабля").
    this._shipX = x;
    this._shipY = y;

    this.available = true;  // false — доставлен, ждёт ARENA_CARGO_RESPAWN_SEC на сервере

    // Мировая камера зумится на DPR (GameScene: setZoom(DPR), макс DPR=2 в проекте) —
    // спрайт с displaySize=DISPLAY_W/H реально занимает вдвое больше экранных
    // пикселей, так что текстуру нужно нести с таким же запасом, иначе Phaser
    // апскейлит исходник и получается мыло (тот же приём, что ships/турели —
    // BootScene.prepShipTex/MiningBase.js, см. диалог: "улучшить качество картинок
    // флагов и груза").
    const key = prerenderTex(scene, 'arena_cargo', DISPLAY_W * 2, DISPLAY_H * 2);
    this.sprite = scene.add.image(x, y, key).setDepth(52).setDisplaySize(DISPLAY_W, DISPLAY_H);
    this._ring = scene.add.graphics().setDepth(49);
  }

  get x() { return this._x; }
  get y() { return this._y; }

  setPosition(x, y) {
    this._x = x;
    this._y = y;
  }

  // Вызывается ТОЛЬКО пока несут (см. ArenaController.update) — реальная позиция
  // корабля-носителя, для кольца.
  setCarrierShipPos(x, y) {
    this._shipX = x;
    this._shipY = y;
  }

  applyState(state, carrierTeam = null) {
    this.available = state.available ?? true;
    this._carriedBy = state.carrier ?? null;
    this._carrierTeam = this._carriedBy ? carrierTeam : null;
    if (!this._carriedBy && state.x != null) { this._x = state.x; this._y = this._baseY = state.y; }
  }

  update(now) {
    if (!this.alive) return;
    this.sprite.setVisible(this.available);
    if (!this.available) { this._ring.clear(); return; }  // доставлен, ждёт респауна на сервере
    if (this._carriedBy) { this._draw(now); return; }  // позицию двигает ArenaController
    this._y = this._baseY + Math.sin(now * 0.0045) * 4;
    this._draw(now);
  }

  _draw(now) {
    this.sprite.setPosition(this._x, this._y);
    this._ring.clear();
    if (!this._carriedBy) return;  // кольцо — только у несущего корабля, не в покое
    const color = this._carrierTeam ? (ARENA_TEAM_COLOR[this._carrierTeam] ?? 0xffb300) : 0xffb300;
    const t = (now % RING_PERIOD_MS) / RING_PERIOD_MS;  // 0..1 — фаза сжатия/расширения
    const r = RING_R_MIN + (RING_R_MAX - RING_R_MIN) * (0.5 + 0.5 * Math.sin(t * Math.PI * 2));
    this._ring.lineStyle(3, color, 0.8);
    this._ring.strokeCircle(this._shipX, this._shipY, r);
    this._ring.lineStyle(1.5, 0xffffff, 0.5);
    this._ring.strokeCircle(this._shipX, this._shipY, r);
  }

  destroy() {
    this.alive = false;
    this.sprite?.destroy();
    this._ring?.destroy();
  }
}
