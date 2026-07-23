// Точка захвата на арене (режим "Захват точек") — точка + внешнее кольцо. Сервер
// авторитетен за owner/durability/attacker (см. server/arena.py ArenaMatch.points,
// main.py arena_point_claim) — этот класс только рисует состояние из
// arena_objective_sync. Нейтраль — серая; захвачена — цвет владельца; под атакой —
// дуга кольца тянется к цвету атакующего пропорционально снятой прочности (не
// заливка-пирог — в движке нет такого примитива, дуга строится из коротких
// lineTo-сегментов, как addRingArc у R-1-boss/пунктир маршрута бронепоезда на
// миникарте).
import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { ARENA_TEAM_COLOR } from '../constants.js';

const NEUTRAL_COLOR = 0x778899;
const MAX_DURABILITY = 100;
const R = 46;

export default class ArenaPoint {
  constructor(scene, id, x, y) {
    this.scene = scene;
    this.id = id;
    this.x = x;
    this.y = y;
    this.owner = 'neutral';
    this.durability = MAX_DURABILITY;
    this.attacker = null;

    this._gfx = scene.add.graphics().setDepth(2);
    this._dot = scene.add.circle(x, y, 10, NEUTRAL_COLOR, 0.9).setDepth(3);
    this._draw();
  }

  applyState(state) {
    this.owner = state.owner;
    this.durability = state.durability;
    this.attacker = state.attacker;
    this._draw();
  }

  _ownerColor() { return this.owner === 'neutral' ? NEUTRAL_COLOR : ARENA_TEAM_COLOR[this.owner]; }

  _draw() {
    const ownerColor = this._ownerColor();
    this._dot.setFillStyle(ownerColor, 0.9);

    this._gfx.clear();
    this._gfx.lineStyle(4, ownerColor, 0.55);
    this._gfx.strokeCircle(this.x, this.y, R);

    if (this.attacker) {
      const attackerColor = ARENA_TEAM_COLOR[this.attacker];
      const frac = Phaser.Math.Clamp(1 - this.durability / MAX_DURABILITY, 0, 1);
      const totalAngle = frac * Math.PI * 2;
      const steps = Math.max(2, Math.ceil((totalAngle / (Math.PI * 2)) * 48));
      this._gfx.lineStyle(6, attackerColor, 0.95);
      this._gfx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const a = -Math.PI / 2 + (totalAngle * i) / steps;
        const px = this.x + Math.cos(a) * R, py = this.y + Math.sin(a) * R;
        if (i === 0) this._gfx.moveTo(px, py); else this._gfx.lineTo(px, py);
      }
      this._gfx.strokePath();
    }
  }

  update(_now) { /* чисто server-driven — переотрисовка только на applyState() */ }

  destroy() {
    this._gfx?.destroy();
    this._dot?.destroy();
  }
}
