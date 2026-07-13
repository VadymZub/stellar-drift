import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { BASE_CONFIG, pvpTierMult } from '../bases.js';
import {
  MOBS, ARMORED_TRAIN_SECTORS, ARMORED_TRAIN_HEAD_MULT, ARMORED_TRAIN_WAGON_COUNT,
  ARMORED_TRAIN_WINDOW_MS, ARMORED_TRAIN_DRONE_WAVE_SIZE, ARMORED_TRAIN_HEAD_PHASES,
  ARMORED_TRAIN_WAGON_DAMAGED_AT,
} from '../constants.js';
import Mob from './Mob.js';

/**
 * ArmoredTrain — раз в сутки на PvP-секторе (детерминированное wall-clock время,
 * тот же паттерн, что "нашествие" — см. GameScene._worldEventHash), проезжает сектор
 * насквозь за ARMORED_TRAIN_WINDOW_MS. 5 вагонов + голова, бьются СТРОГО с хвоста
 * (сервер — ArmoredTrainManager в main.py — авторитетен для порядка, здесь только
 * визуал/локальный gate повторяет то же самое для консистентного UX). Награда КАЖДОГО
 * вагона выплачивается независимо по факту его уничтожения (не только за весь поезд) —
 * топ-5 по урону делят пропорционально (см. _split_reward_top5 на сервере).
 *
 * Вагон реализован как лёгкий боевой прокси (см. TurretTarget в MiningBase.js для
 * идентичного паттерна) — НЕ полноценный Mob: x/y/hull/maxHull/shield/maxShield/alive/
 * pvpMobId этого достаточно, чтобы GameScene._fireCannon/_fireLaser/_onPvpMobHitResult
 * автоматически заработали без отдельного боевого кода (см. `if (t.pvpMobId)` в
 * _fireCannon) — нужны только клик-таргетинг (GameScene.trainWagonAt) и killed-ветка.
 *
 * Арт: client/assets/train/ (train1_1/2 — вагон 2 состояния, train2_1/2/3 — голова
 * 3 состояния, cable.png — трос). Все текстуры — портретные PNG (носом вниз, как и
 * остальной арт в игре — см. ART_ANGLE_OFFSET конвенцию), fit по высоте (аналог
 * MiningBase._fitSize), ширина считается из РЕАЛЬНОГО aspect ratio, не растягивается.
 */

const WAGON_TURRET_COUNT = 4;
const WAGON_TARGET_LEN = 110; // fit-height цель для обычного вагона (train1_*.png)
const HEAD_TARGET_LEN = 140;  // голова визуально крупнее
// Между центрами соседних вагонов вдоль пути. 230 даёт видимый зазор ~110-120px
// (230 - половины длин корпусов) — под реальные пропорции троса (cable.png), иначе
// вспышки на концах троса слипались бы друг с другом на зазоре в 30-40px (WAGON_GAP=150,
// см. обсуждение).
const WAGON_GAP = 230;
const TETHER_COLOR = 0x4dd0e1;

// cable.png — портретный канвас 1024×1536, сам светящийся трос — горизонтальная
// полоса шириной ~952px внутри этого канваса (см. проверку alpha-порогом при
// интеграции ассета). CABLE_SCALE_TO_CONTENT переводит "сколько должен быть виден
// трос" в "какой displayWidth задать всему канвасу", CABLE_ASPECT сохраняет
// пропорции канваса при масштабировании.
const CABLE_CONTENT_W = 952, CABLE_FULL_W = 1024, CABLE_FULL_H = 1536;
const CABLE_SCALE_TO_CONTENT = CABLE_FULL_W / CABLE_CONTENT_W;
const CABLE_ASPECT = CABLE_FULL_H / CABLE_FULL_W;

// 2×2-сетка турельных сокетов, запечённых в арт (train1_*/train2_*.png) — доли от
// dispW/dispLen вагона, локальные (до поворота спрайта на heading+π/2).
const TURRET_LOCAL_OFFSETS = [
  { lx: -0.22, ly: -0.16 }, { lx: 0.22, ly: -0.16 },
  { lx: -0.22, ly:  0.16 }, { lx: 0.22, ly:  0.16 },
];

function fitSize(scene, textureKey, targetH) {
  const src = scene.textures.get(textureKey)?.getSourceImage();
  if (!src?.width) return { w: targetH, h: targetH };
  return { w: Math.round(targetH * src.width / src.height), h: targetH };
}

class ArmoredTrainWagon {
  constructor(train, idx, isHead) {
    this.train = train;
    this.idx = idx;                // 0..4 хвост→ближе к голове, ARMORED_TRAIN_WAGON_COUNT(5) = голова
    this.isHead = isHead;
    this.isArmoredTrainWagon = true;

    const mult = pvpTierMult(train.tier);
    const baseHull = BASE_CONFIG.hullMax * mult;
    const baseShield = BASE_CONFIG.shieldMax * mult;
    this.maxHull   = isHead ? baseHull * 2.5 : baseHull;
    this.maxShield = isHead ? baseShield * 2.5 : baseShield;
    this.hull = this.maxHull;
    this.shield = this.maxShield;
    this.alive = true;
    this.lastDamageAt = -1e9;
    this.x = 0; this.y = 0;
    this.hpState = 0; // 0=целый, 1=полуразрушен(обычн.)/частично(голова), 2=разрушен-70%(только голова)
    this._turretCooldowns = new Array(WAGON_TURRET_COUNT).fill(0);
    this.dispW = isHead ? HEAD_TARGET_LEN * 0.78 : WAGON_TARGET_LEN * 0.68; // уточнится в _buildWagonVisual
    this.dispLen = isHead ? HEAD_TARGET_LEN : WAGON_TARGET_LEN;

    this.sprite = null; this._turretGfx = null; this._hpBarBg = null; this._hpBarFill = null;
  }

  // pvpMobId детерминирован (sector:startAt:idx) — все клиенты, атакующие один и тот
  // же вагон, независимо приходят к одному mobId без отдельного протокола регистрации
  // (тот же трюк, что у мобов нашествия — см. GameScene._spawnWorldEventWave).
  get pvpMobId() { return `train:${this.train.sectorKey}:${this.train.startAt}:${this.idx}`; }
  get wagonReward() { return this.isHead ? this.train.headRewardPool : this.train.wagonRewardPool; }
  get canBeAttacked() { return this.alive; }

  _texForState() {
    if (this.isHead) return ['train_head_1', 'train_head_2', 'train_head_3'][this.hpState] ?? 'train_head_3';
    return ['train_wagon_1', 'train_wagon_2'][this.hpState] ?? 'train_wagon_2';
  }

  // DEV-фоллбэк без сервера (см. GameScene._localPvpFireResolve) — тот же контракт,
  // что TurretTarget.takeDamage в MiningBase.js: shield поглощает первым, возвращает
  // {hullHit, shieldHit, killed}. В обычной игре урон по вагону ВСЕГДА идёт через
  // сервер (mobFireClaim), это не вызывается.
  takeDamage(damage) {
    if (!this.canBeAttacked) return { hullHit: 0, shieldHit: 0, killed: false };
    this.lastDamageAt = Date.now();
    let dmg = Math.round(damage);
    let shieldHit = 0;
    if (this.shield > 0) {
      shieldHit = Math.min(dmg, this.shield);
      this.shield -= shieldHit;
      dmg -= shieldHit;
    }
    const hullHit = Math.min(dmg, this.hull);
    this.hull -= hullHit;
    const killed = this.hull <= 0;
    return { hullHit, shieldHit, killed };
  }

  _updateHpState() {
    const frac = this.maxHull > 0 ? (this.hull + this.shield) / (this.maxHull + this.maxShield) : 0;
    if (this.isHead) {
      const [p1, p2] = ARMORED_TRAIN_HEAD_PHASES;
      const next = frac <= p2 ? 2 : frac <= p1 ? 1 : 0;
      if (next > this.hpState) { this.hpState = next; this._refreshVisual(); this.train._onHeadPhase(next); }
    } else if (frac <= ARMORED_TRAIN_WAGON_DAMAGED_AT && this.hpState === 0) {
      this.hpState = 1;
      this._refreshVisual();
    }
  }

  _refreshVisual() {
    if (!this.sprite) return;
    const texKey = this._texForState();
    const targetLen = this.isHead ? HEAD_TARGET_LEN : WAGON_TARGET_LEN;
    const { w, h } = fitSize(this.train.scene, texKey, targetLen);
    this.sprite.setTexture(texKey).setDisplaySize(w, h);
    this.dispW = w; this.dispLen = h;
  }

  destroyVisuals() {
    this.sprite?.destroy(); this.sprite = null;
    this._turretGfx?.destroy(); this._turretGfx = null;
    this._hpBarBg?.destroy(); this._hpBarBg = null;
    this._hpBarFill?.destroy(); this._hpBarFill = null;
  }
}

export default class ArmoredTrain {
  constructor(scene, sectorKey, startAt) {
    this.scene = scene;
    this.sectorKey = sectorKey;
    this.startAt = startAt;
    this.tier = parseInt(sectorKey.split('_').pop(), 10) || 1;
    this.cfg = ARMORED_TRAIN_SECTORS[sectorKey];
    this.wagonRewardPool = { ...this.cfg.wagonReward, ...this.cfg.clanRes };
    this.headRewardPool = this._scaleHeadPool();
    this.destroyedCount = 0;
    this.finished = false;

    // Маршрут: прямая линия через мир сектора, вход/направление — детерминированы
    // ТЕМ ЖЕ хэшем, что и у нашествия (GameScene._worldEventHash), поэтому у всех
    // клиентов идентичный путь без отдельного протокола синхронизации позиции.
    const h = scene._worldEventHash(`train:${sectorKey}:${startAt}:path`);
    const cx = scene.worldWidth / 2, cy = scene.worldHeight / 2;
    this.heading = (h % 360) * Math.PI / 180;
    const R = Math.max(scene.worldWidth, scene.worldHeight) * 0.6;
    this.startPos = { x: cx - Math.cos(this.heading) * R, y: cy - Math.sin(this.heading) * R };
    this.endPos   = { x: cx + Math.cos(this.heading) * R, y: cy + Math.sin(this.heading) * R };
    this._dirX = Math.cos(this.heading); this._dirY = Math.sin(this.heading);

    this.wagons = [];
    for (let i = 0; i < ARMORED_TRAIN_WAGON_COUNT; i++) this.wagons.push(new ArmoredTrainWagon(this, i, false));
    this.head = new ArmoredTrainWagon(this, ARMORED_TRAIN_WAGON_COUNT, true);
    this.wagons.push(this.head);

    this._tetherPhase = 0;
    this._tetherSprites = [];
    for (const w of this.wagons) this._buildWagonVisual(w);
    this._positionAll(0);
  }

  _scaleHeadPool() {
    const out = {};
    for (const [k, v] of Object.entries(this.cfg.wagonReward)) out[k] = Math.round(v * ARMORED_TRAIN_HEAD_MULT);
    for (const [k, v] of Object.entries(this.cfg.clanRes)) out[k] = Math.round(v * ARMORED_TRAIN_HEAD_MULT);
    return out;
  }

  _buildWagonVisual(w) {
    const texKey = w._texForState();
    const targetLen = w.isHead ? HEAD_TARGET_LEN : WAGON_TARGET_LEN;
    const { w: dispW, h: dispH } = fitSize(this.scene, texKey, targetLen);
    w.sprite = this.scene.add.image(0, 0, texKey).setDisplaySize(dispW, dispH).setDepth(40);
    w.dispW = dispW; w.dispLen = dispH;
    w._turretGfx = this.scene.add.graphics().setDepth(41);
    w._hpBarBg = this.scene.add.rectangle(0, 0, dispW * 0.9, 4, 0x000000, 0.6).setDepth(42);
    w._hpBarFill = this.scene.add.rectangle(0, 0, dispW * 0.9, 4, 0x66bb6a, 1).setDepth(43).setOrigin(0, 0.5);
  }

  // idx считается от хвоста (0) к голове (ARMORED_TRAIN_WAGON_COUNT) — расстояние от
  // головы растёт с уменьшением idx, ровно как "бьют с хвоста" в дизайне.
  _positionAll(progress) {
    const p = Phaser.Math.Clamp(progress, 0, 1);
    const headX = Phaser.Math.Linear(this.startPos.x, this.endPos.x, p);
    const headY = Phaser.Math.Linear(this.startPos.y, this.endPos.y, p);
    for (const w of this.wagons) {
      if (!w.alive) continue;
      const behind = (ARMORED_TRAIN_WAGON_COUNT - w.idx) * WAGON_GAP;
      w.x = headX - this._dirX * behind;
      w.y = headY - this._dirY * behind;
      if (w.sprite) {
        w.sprite.setPosition(w.x, w.y);
        w.sprite.setRotation(this.heading + Math.PI / 2); // спрайты рисуются "носом вниз" — см. ART_ANGLE_OFFSET конвенцию
      }
      const barY = w.y - w.dispLen / 2 - 10;
      w._hpBarBg?.setPosition(w.x, barY);
      if (w._hpBarFill) {
        const frac = w.maxHull > 0 ? Math.max(0, w.hull / w.maxHull) : 0;
        w._hpBarFill.setPosition(w.x - w.dispW * 0.45, barY);
        w._hpBarFill.width = w.dispW * 0.9 * frac;
        w._hpBarFill.setFillStyle(frac > 0.5 ? 0x66bb6a : frac > 0.2 ? 0xffb74d : 0xef5350, 1);
      }
    }
    this._updateTetherSprites();
  }

  // Силовой трос — анимация через цвет/яркость (пульсация alpha), не длину/толщину:
  // физическое расстояние между вагонами и так фиксировано WAGON_GAP (строй едет
  // жёстко), тянуть нечего — стретчинг геометрии выглядел бы как баг, не эффект.
  // Трос рисуется РЕАЛЬНЫМ ассетом (cable.png) между СТЫКОВОЧНЫМИ КРАЯМИ вагонов
  // (не центрами) — см. dispLen/2 отступы, иначе вспышки на концах троса влезали бы
  // внутрь корпусов вагонов.
  _updateTetherSprites() {
    const alive = this.wagons.filter(w => w.alive).sort((a, b) => b.idx - a.idx); // голова первой
    const wantPairs = [];
    for (let i = 0; i < alive.length - 1; i++) wantPairs.push([alive[i], alive[i + 1]]);
    const stale = wantPairs.length !== this._tetherSprites.length
      || this._tetherSprites.some((t, i) => t.a !== wantPairs[i][0] || t.b !== wantPairs[i][1]);
    if (stale) this._rebuildTetherSprites(wantPairs);

    const dirX = this._dirX, dirY = this._dirY;
    this._tetherSprites.forEach((t, segIdx) => {
      const halfA = t.a.dispLen / 2, halfB = t.b.dispLen / 2;
      const edgeAx = t.a.x - dirX * halfA, edgeAy = t.a.y - dirY * halfA;
      const edgeBx = t.b.x + dirX * halfB, edgeBy = t.b.y + dirY * halfB;
      const span = Math.max(4, Math.hypot(edgeAx - edgeBx, edgeAy - edgeBy));
      const dispW = span * CABLE_SCALE_TO_CONTENT;
      const pulse = 0.55 + 0.45 * Math.sin(this._tetherPhase * Math.PI * 2 + segIdx * 1.1);
      t.img.setPosition((edgeAx + edgeBx) / 2, (edgeAy + edgeBy) / 2)
        .setRotation(this.heading)
        .setDisplaySize(dispW, dispW * CABLE_ASPECT)
        .setAlpha(pulse);
    });
  }

  _rebuildTetherSprites(wantPairs) {
    this._tetherSprites.forEach(t => t.img.destroy());
    this._tetherSprites = wantPairs.map(([a, b]) => ({ a, b, img: this.scene.add.image(0, 0, 'train_cable').setDepth(39) }));
  }

  // Одноразовая вспышка + затухание — трос "рвётся" именно на этом сегменте в
  // момент уничтожения вагона (обычная перерисовка троса уже просто перестанет
  // рисовать сегмент со следующего кадра, без этой вспышки разрыв был бы незаметен).
  _flashTetherSnap(x1, y1, x2, y2) {
    const g = this.scene.add.graphics().setDepth(44);
    g.lineStyle(4, 0xffffff, 1);
    g.lineBetween(x1, y1, x2, y2);
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 350, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
  }

  // Турели: тот же контракт, что MiningBase._updateTurrets (nearest player in range,
  // gs.fireMobWeapon — локально-авторитетный урон по игроку, без сервера). Стреляют
  // ВСЕ живые вагоны одновременно (не только текущий уязвимый "хвостовой") — очередь
  // уничтожения касается только КТО получает урон, не кто им отвечает. Позиции сокетов
  // — 2×2 сетка TURRET_LOCAL_OFFSETS, повёрнутая на тот же угол, что и корпус вагона.
  _updateTurrets(dt, player) {
    if (!player?.alive) return;
    const range = BASE_CONFIG.cannon1Range, damage = BASE_CONFIG.cannon1Damage * pvpTierMult(this.tier);
    const rateInv = 1 / BASE_CONFIG.cannon1Rate;
    const rot = this.heading + Math.PI / 2; // тот же угол, что и sprite.setRotation
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    for (const w of this.wagons) {
      if (!w.alive) continue;
      w._turretGfx.clear();
      TURRET_LOCAL_OFFSETS.forEach((off, i) => {
        const lx = off.lx * w.dispW, ly = off.ly * w.dispLen;
        const ox = w.x + lx * cosR - ly * sinR;
        const oy = w.y + lx * sinR + ly * cosR;
        w._turretCooldowns[i] -= dt;
        const d = Phaser.Math.Distance.Between(ox, oy, player.x, player.y);
        const ang = d < range ? Math.atan2(player.y - oy, player.x - ox) : rot;
        w._turretGfx.fillStyle(0x556677, 1).fillCircle(ox, oy, 6);
        w._turretGfx.lineStyle(2, TETHER_COLOR, 0.8).lineBetween(ox, oy, ox + Math.cos(ang) * 10, oy + Math.sin(ang) * 10);
        if (d >= range || w._turretCooldowns[i] > 0) return;
        w._turretCooldowns[i] = rateInv;
        this.scene.fireMobWeapon?.({ x: ox, y: oy, damage, isBoss: false, tpl: { projectileType: 'plasma' } }, player.x, player.y, player);
      });
    }
  }

  // Пороги HP головного вагона (2 фазы) — спавн волны дронов охраны (sec_drone,
  // уменьшенный вдвое — см. constants.js). pvpMobId шарит HP дрона между клиентами
  // тем же детерминированным паттерном, что и мобы нашествия.
  _onHeadPhase(phase) {
    const cfg = this.cfg;
    const cx = this.head.x, cy = this.head.y;
    for (let i = 0; i < ARMORED_TRAIN_DRONE_WAVE_SIZE; i++) {
      const h = this.scene._worldEventHash(`train:${this.sectorKey}:${this.startAt}:drones:${phase}:${i}`);
      const ang = (h % 360) * Math.PI / 180, dist = 150 + (h % 250);
      const x = cx + Math.cos(ang) * dist, y = cy + Math.sin(ang) * dist;
      const lvl = cfg.lvlMax;
      const m = new Mob(this.scene, MOBS.sec_drone, lvl, x, y, {});
      m.isArmoredTrainDrone = true;
      m.noRespawn = true;
      if (this.scene._realtimeRoomKey) m.pvpMobId = `train:${this.sectorKey}:${this.startAt}:drone:${phase}:${i}`;
      this.scene.mobs.push(m);
    }
    this.scene.log?.(`⚠ Бронепоезд: волна дронов охраны (фаза ${phase + 1})!`);
  }

  // Вызывается из GameScene._onPvpMobHitResult/_localPvpFireResolve на killed=true.
  onWagonDestroyed(wagon) {
    const neighbors = this.wagons.filter(w => w.alive && Math.abs(w.idx - wagon.idx) === 1);
    for (const n of neighbors) this._flashTetherSnap(wagon.x, wagon.y, n.x, n.y);
    wagon.alive = false;
    wagon.destroyVisuals();
    this.destroyedCount++;
    this._updateTetherSprites();
    this.scene.explosion?.(wagon.x, wagon.y, wagon.isHead ? 1.6 : 1.0);
    this.scene.log?.(wagon.isHead ? '💥 Бронепоезд: головной вагон уничтожен!' : '💥 Бронепоезд: вагон уничтожен!');
    if (this.wagons.every(w => !w.alive)) this.finished = true;
  }

  get progress() {
    return Phaser.Math.Clamp((Date.now() - this.startAt) / ARMORED_TRAIN_WINDOW_MS, 0, 1);
  }

  // "sector:startAt" — совпадает с ключом ArmoredTrainManager.destroyed на сервере
  // (mobId вагона = "train:" + trainKey + ":" + idx).
  get trainKey() { return `${this.sectorKey}:${this.startAt}`; }

  // Ответ на pvp_train_query (см. HudScene.onTrainSnapshot) — подхватывает реальное
  // состояние ОТ СЕРВЕРА для игрока, зашедшего в сектор ПОСЛЕ начала события: какие
  // вагоны уже уничтожены (destroyed — переживает remove_mob на сервере, в отличие от
  // hull/shield самих PvpMobState) и hull/shield ещё живых.
  applySnapshot(msg) {
    if (msg.trainKey !== this.trainKey) return; // ответ на устаревший/чужой запрос
    for (const idx of msg.destroyed ?? []) {
      const w = this.wagons.find(w => w.idx === idx && w.alive);
      if (w) { w.alive = false; w.destroyVisuals(); this.destroyedCount++; }
    }
    for (const [mobId, s] of Object.entries(msg.wagons ?? {})) {
      const w = this.wagons.find(w => w.pvpMobId === mobId && w.alive);
      if (w) { w.hull = s.hull; w.shield = s.shield; w._updateHpState(); }
    }
    this._updateTetherSprites();
    if (this.wagons.every(w => !w.alive)) this.finished = true;
  }

  update(dt) {
    if (this.finished) return;
    const now = Date.now();
    if (now >= this.startAt + ARMORED_TRAIN_WINDOW_MS) { this.finished = true; return; }
    this._tetherPhase = ((this._tetherPhase ?? 0) + dt * 0.4) % 1; // ~2.5с на полный цикл пульса
    this._positionAll(this.progress);
    for (const w of this.wagons) if (w.alive) w._updateHpState();
    this._updateTurrets(dt, this.scene.player);
  }

  destroy() {
    this._tetherSprites.forEach(t => t.img.destroy());
    this._tetherSprites = [];
    for (const w of this.wagons) w.destroyVisuals();
  }
}
