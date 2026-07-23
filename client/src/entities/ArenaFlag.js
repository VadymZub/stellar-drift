// Флаг команды на арене (режим "Захват флага") — тонкий рендер-класс: вся логика
// подбора/захвата/возврата авторитетна на сервере (см. server/arena.py ArenaMatch.flags,
// main.py arena_flag_pickup/capture/return), этот класс только рисует состояние,
// пришедшее в arena_objective_sync. Смоделирован по образцу Loot.js: alive-флаг,
// update(now) для лёгкой idle-анимации, _carriedBy — как _magnetPull у Loot: когда
// задан, update() ранний return, позицию каждый кадр двигает ArenaController (следует
// за нужным Player/RemotePlayer).
import { ARENA_TEAM_COLOR } from '../constants.js';
import { prerenderTex } from '../utils/prerenderTex.js';

const DISPLAY_W = 46, DISPLAY_H = 65;

export default class ArenaFlag {
  constructor(scene, team, x, y) {
    this.scene = scene;
    this.team = team;         // 'a' | 'b' — чей это флаг (не носитель)
    this.alive = true;
    this.atBase = true;
    this._carriedBy = null;   // userId несущего, либо null — лежит/стоит на базе
    this.baseX = x;
    this.baseY = y;
    this._x = x;
    this._y = y;
    this.color = ARENA_TEAM_COLOR[team] ?? 0xffffff;

    // Спрайт мачты+вымпела (origin — низ по центру: "точка стыковки" у арта — светящееся
    // кольцо-основание в самом низу картинки, см. arena_flag_blue/red.png) — позиция,
    // которую двигает ArenaController, это ТОЧКА ОСНОВАНИЯ флага, не его центр.
    // Depth 52 — ВЫШЕ игрока (50) и его нашивки (51): раньше флаг рисовался Graphics на
    // depth 41 (ниже игрока) — при переносе над кораблём частично прятался ЗА его
    // спрайтом вместо того, чтобы быть виден "над" ним (баг из диалога).
    // Исходники — реальные PNG 573×811/584×823 (см. RESOURCE_ART_PROMPTS.md), но
    // отображаются на порядок мельче (46×65) — Phaser даунскейлит их в один проход
    // на GPU и получается мыло, особенно с учётом того, что мировая камера ещё и
    // зумится на DPR (setZoom(DPR), макс=2 в проекте) поверх этого. prerenderTex
    // (тот же приём, что у ships/турелей/иконок предметов) режет исходник
    // пошаговым halving на Canvas2D до 2×displaySize — резкость сохраняется даже
    // на HiDPI (см. диалог: "улучшить качество картинок флагов и груза").
    const texKey = team === 'a' ? 'arena_flag_a' : 'arena_flag_b';
    const key = prerenderTex(scene, texKey, DISPLAY_W * 2, DISPLAY_H * 2);
    this.sprite = scene.add.image(x, y, key).setOrigin(0.5, 1).setDepth(52).setDisplaySize(DISPLAY_W, DISPLAY_H);
  }

  get x() { return this._x; }
  get y() { return this._y; }

  setPosition(x, y) {
    this._x = x;
    this._y = y;
  }

  applyState(state) {
    this.atBase = !!state.at_base;
    this._carriedBy = state.carrier ?? null;
    if (!this._carriedBy) { this._x = state.x; this._y = state.y; }
  }

  update(now) {
    if (!this.alive) return;
    if (this._carriedBy) { this._draw(); return; }  // позицию двигает ArenaController
    this._y = this.baseY + (this.atBase ? 0 : Math.sin(now * 0.004) * 4);
    this._draw();
  }

  _draw() {
    this.sprite.setPosition(this._x, this._y);
  }

  destroy() {
    this.alive = false;
    this.sprite?.destroy();
  }
}
