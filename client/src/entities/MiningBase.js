import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { BASE_CONFIG, TURRET_SLOTS, CORP_ASSETS, cannon2GoldCost, goldPerSecByTier, pvpTierMult } from '../bases.js';
import { UI_RES } from '../constants.js';

// Persists base ownership/state across sector re-entries.
const _registry = new Map();

// Реген щита/прочности — 30с без урона → щит +5%/сек, 3мин без урона → корпус +0.5%/сек
// (одни и те же ставки для базы и для турелей).
const SHIELD_REGEN_DELAY_MS = 30000;
const SHIELD_REGEN_PCT_SEC  = 0.05;
const HULL_REGEN_DELAY_MS   = 180000;
const HULL_REGEN_PCT_SEC    = 0.005;

// Боевая проекция ОДНОЙ турели — независимая от базы цель (как моб): свой hull/shield/
// pvpMobId, свой реген, killable без уничтожения самой базы. Визуал (спрайт/поворот/
// стрельба по мобам) остаётся у MiningBase — этот класс несёт только боевое состояние +
// форму, которую ждёт общий PvP-код GameScene (_onPvpMobHitResult, _fireCannon/_fireLaser,
// mobFireClaim): x/y/hull/maxHull/shield/maxShield/alive/canBeAttacked/pvpMobId/corp.
class TurretTarget {
  constructor(base, slotIdx, type) {
    this.base    = base;
    this.slotIdx = slotIdx;
    this.type    = type;
    this.isTurretTarget = true;

    const mult = pvpTierMult(base.pvpTier);
    this.maxHull   = (type === 'cannon2' ? BASE_CONFIG.turretHullMax.cannon2   : BASE_CONFIG.turretHullMax.cannon1)   * mult;
    this.maxShield = (type === 'cannon2' ? BASE_CONFIG.turretShieldMax.cannon2 : BASE_CONFIG.turretShieldMax.cannon1) * mult;
    this.hull         = this.maxHull;
    this.shield       = this.maxShield;
    this.lastDamageAt = -1e9;
    this.alive        = true;
  }

  get x() { return this.base.x + TURRET_SLOTS[this.slotIdx].x; }
  get y() { return this.base.y + TURRET_SLOTS[this.slotIdx].y; }
  get corp() { return this.base.corp; }
  get canBeAttacked() { return this.alive && this.base.canBeAttacked; }

  // pvpMobId базы навешивается GameScene ПОСЛЕ конструктора MiningBase (нужен ещё не
  // готовый на тот момент this._realtimeRoomKey) — турели же создаются и раньше
  // (restore из registry в конструкторе базы), и позже (buyTurret в течение игры),
  // так что читаем текущее значение базы лениво, а не кэшируем на момент создания.
  get pvpMobId() {
    return this.base.pvpMobId ? `${this.base.pvpMobId}:turret:${this.slotIdx}` : null;
  }

  applyState(saved) {
    if (!saved) return;
    this.hull         = saved.hull ?? this.hull;
    this.shield       = saved.shield ?? this.shield;
    this.lastDamageAt = saved.lastDamageAt ?? this.lastDamageAt;
  }

  update(dt, now) {
    if (!this.alive) return;
    const sinceDmg = now - this.lastDamageAt;
    if (this.maxShield > 0 && sinceDmg > SHIELD_REGEN_DELAY_MS && this.shield < this.maxShield) {
      this.shield = Math.min(this.maxShield, this.shield + this.maxShield * SHIELD_REGEN_PCT_SEC * dt);
    }
    if (sinceDmg > HULL_REGEN_DELAY_MS && this.hull < this.maxHull) {
      this.hull = Math.min(this.maxHull, this.hull + this.maxHull * HULL_REGEN_PCT_SEC * dt);
    }
  }
}

export default class MiningBase {
  static get registry() { return _registry; }

  constructor(scene, x, y, { id, pvpTier = 1 } = {}) {
    this.scene   = scene;
    this.x       = x;
    this.y       = y;
    this.id      = id || `base_${Math.round(x)}_${Math.round(y)}`;
    this.pvpTier = pvpTier;
    // Отличаем от Mob/RemotePlayer в общем PvP-коде (_onPvpMobHitResult и т.п.) без
    // instanceof; pvpMobId навешивает GameScene.spawnMobs() после конструктора (нужен
    // this._realtimeRoomKey, которого MiningBase не знает).
    this.isMiningBase = true;

    const saved = _registry.get(this.id);
    if (saved) {
      this.corp          = saved.corp;
      this.state         = saved.state;
      this.hull          = saved.hull;
      this.shield        = saved.shield ?? 0;
      this.lastDamageAt  = saved.lastDamageAt ?? -1e9;
      this.owners        = saved.owners.slice();
      this.pointsBanked  = saved.pointsBanked;
      this.goldBanked    = saved.goldBanked;
      this.turrets       = saved.turrets.slice();
      this._turretState  = (saved.turretState || Array(BASE_CONFIG.turretSlots).fill(null)).slice();
      this._neutralPhase = saved.neutralPhase || 'open';
      this._neutralTimer = saved.neutralTimer || 0;
      this._buildTimer   = saved.buildTimer || 0;
    } else {
      this.corp          = 'neutral';
      this.state         = 'destroyed';
      this.hull          = 0;
      this.shield        = 0;
      this.lastDamageAt  = -1e9;
      this.owners        = [];
      this.pointsBanked  = 0;
      this.goldBanked    = 0;
      this.turrets       = Array(BASE_CONFIG.turretSlots).fill(null);
      this._turretState  = Array(BASE_CONFIG.turretSlots).fill(null);
      this._neutralPhase = 'open';
      this._neutralTimer = 0;
      this._buildTimer   = 0;
    }

    // Боевые прокси турелей — отдельно от this.turrets (голые строки типа, которые
    // читает BaseMenuScene без изменений). Восстанавливаем hp/shield из _turretState.
    this.turretTargets = this.turrets.map((type, i) => {
      if (!type) return null;
      const tt = new TurretTarget(this, i, type);
      tt.applyState(this._turretState[i]);
      return tt;
    });

    this._earnTimer       = 0;
    this._labelTick       = 0;
    this._turretCooldowns = Array(BASE_CONFIG.turretSlots).fill(0);

    this._buildSprite   = null;
    this._baseSprite    = null;
    this._turretSprites = [];
    this._hpBar         = null;
    this._hpBarBg       = null;
    this._shieldBar     = null;
    this._turretHpBars     = [];
    this._turretHpBarsBg   = [];
    this._turretShieldBars = [];
    this._nameLabel     = null;
    this._stateLabel    = null;
    this._ownerLabel    = null;
    this._menuBtnBg     = null;
    this._menuBtnLbl    = null;
    this._zone          = null;

    this._createVisuals();
    this._persist();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  get alive() { return this.state === 'active'; }
  get canBeAttacked() {
    return this.alive && !(this.corp === 'neutral' && this._neutralPhase === 'immune');
  }

  // Прочность/щит масштабируются по pvp-тиру арены (см. pvpTierMult в bases.js) —
  // базовые значения в BASE_CONFIG заданы для pvp4/pvp5.
  get maxHull()   { return BASE_CONFIG.hullMax   * pvpTierMult(this.pvpTier); }
  get maxShield() { return BASE_CONFIG.shieldMax * pvpTierMult(this.pvpTier); }

  // Called by Projectile._hit() — must return {hullHit, shieldHit, killed}. На практике
  // мёртвый код для игроков (у базы всегда есть pvpMobId в реальном PvP-секторе, так что
  // урон идёт через mobFireClaim/сервер, не через takeDamage) — но держим корректным на
  // случай локального/оффлайн пути.
  takeDamage(damage) {
    if (!this.canBeAttacked) return { hullHit: 0, shieldHit: 0, killed: false };
    this.lastDamageAt = this.scene.time.now;
    let dmg = Math.round(damage);
    let shieldHit = 0;
    if (this.shield > 0) {
      shieldHit = Math.min(dmg, this.shield);
      this.shield -= shieldHit;
      dmg -= shieldHit;
    }
    const hullHit = Math.min(dmg, this.hull);
    this.hull -= hullHit;
    this._refreshHpBar();
    const killed = this.hull <= 0;
    if (killed) this._onDestroyed();
    return { hullHit, shieldHit, killed };
  }

  // Opens BaseMenuScene; called by menu button click or F key
  interact(playerName) {
    const gs = this.scene;
    // Fully stop the ship: clear waypoint, zero physics velocity, end boost/steer
    const p = gs.player;
    p.waypoint  = null;
    p.speed     = 0;
    p.boosting  = false;
    p.sprite?.body?.setVelocity(0, 0);
    gs.steering = false;
    gs.cancelCollect?.();
    if (gs.movement) {
      gs.movement.showArrow = false;
      gs.movement.courseArrow?.setVisible(false);
    }
    if (gs.scene.isActive('BaseMenuScene')) gs.scene.stop('BaseMenuScene');
    gs.scene.launch('BaseMenuScene', { base: this, playerName });
  }

  get speedUpCost() { return this.pvpTier >= 4 ? 20 : 10; }

  speedUpBuild(playerName) {
    const gs   = this.scene;
    const cost = this.speedUpCost;
    if (!this.owners.some(o => o.name === playerName)) {
      gs.log('Только владелец может ускорить строительство');
      return false;
    }
    if ((gs.starGold || 0) < cost) {
      gs.log(`Недостаточно ⭐ (нужно ${cost})`);
      return false;
    }
    gs.starGold -= cost;
    this.state = 'active';
    this.hull   = this.maxHull;
    this.shield = this.maxShield;
    this._buildTimer = BASE_CONFIG.buildTimeSec;
    this._labelTick  = 0;
    this._refreshVisuals();
    this._persist();
    gs.log(`Строительство завершено за ${cost} ⭐!`);
    return true;
  }

  buyBase(playerName) {
    const gs = this.scene;
    if ((gs.credits || 0) < BASE_CONFIG.baseCostCredits) {
      gs.log(`Недостаточно кредитов (нужно ${BASE_CONFIG.baseCostCredits})`);
      return;
    }
    gs.credits -= BASE_CONFIG.baseCostCredits;
    // Corp from GameScene.playerCorp (set at scene init from prestige ship ownership).
    this.corp   = gs.playerCorp || 'neutral';
    this.state  = 'building';
    this.hull   = 0;
    this.shield = 0;
    this.owners = [{ name: playerName, points: 0, gold: 0 }];
    this.turrets = Array(BASE_CONFIG.turretSlots).fill(null);
    this.turretTargets = Array(BASE_CONFIG.turretSlots).fill(null);
    this._buildTimer = 0;
    this._refreshVisuals();
    this._persist();
    gs.gainCorpRep?.(0.05);
    gs.log(`База куплена (${this.corp}) — строится 15 мин`);
  }

  buyTurret(slotIdx, type, playerName) {
    if (this.state !== 'active') return;
    if (this.turrets[slotIdx] !== null) return;
    const gs = this.scene;
    if (type === 'cannon2') {
      const cost = cannon2GoldCost(this.pvpTier);
      if ((gs.starGold || 0) < cost) { gs.log(`Недостаточно ⭐ (нужно ${cost})`); return; }
      gs.starGold -= cost;
    } else {
      if ((gs.credits || 0) < BASE_CONFIG.turretCostCredits) {
        gs.log(`Недостаточно кредитов (нужно ${BASE_CONFIG.turretCostCredits})`);
        return;
      }
      gs.credits -= BASE_CONFIG.turretCostCredits;
    }
    this.turrets[slotIdx] = type;
    this.turretTargets[slotIdx] = new TurretTarget(this, slotIdx, type);
    this._refreshTurrets();
    this._persist();
    gs.log(`Турель ${type} установлена на слот ${slotIdx + 1}`);
  }

  // Турель уничтожена индивидуально (killed:true пришёл на её pvpMobId) — освобождаем
  // слот, саму базу это не трогает (в отличие от _onDestroyed, который сносит всё).
  _onTurretDestroyed(slotIdx) {
    this.turrets[slotIdx] = null;
    this.turretTargets[slotIdx] = null;
    this._refreshTurrets();
    this._refreshTurretHpBars();
    this._persist();
    this.scene.log?.(`Турель уничтожена (слот ${slotIdx + 1})`);
  }

  update(dt) {
    const gs  = this.scene;
    const now = gs.time.now;

    if (this.state === 'building') {
      this._buildTimer += dt;
      const frac = Math.min(1, this._buildTimer / BASE_CONFIG.buildTimeSec);
      this.hull = Math.round(this.maxHull * frac);
      this._refreshHpBar();
      this._labelTick += dt;
      if (this._labelTick >= 1) { this._labelTick = 0; this._refreshStateLabel(); }
      if (this._buildTimer >= BASE_CONFIG.buildTimeSec) {
        this.state  = 'active';
        this.hull   = this.maxHull;
        this.shield = this.maxShield;
        this._refreshVisuals();
        this._persist();
        this.scene.log('База построена и активна!');
      }
    }

    if (this.state === 'active') {
      // Neutral immunity cycle
      if (this.corp === 'neutral') {
        this._neutralTimer += dt;
        const limit = this._neutralPhase === 'open'
          ? BASE_CONFIG.neutralOpenSec
          : BASE_CONFIG.neutralImmuneSec;
        if (this._neutralTimer >= limit) {
          this._neutralTimer = 0;
          this._neutralPhase = this._neutralPhase === 'open' ? 'immune' : 'open';
          this._refreshStateLabel();
          this._persist();
        }
      }

      // Earn points & gold for all owners each real-time second
      if (this.owners.length > 0) {
        this._earnTimer += dt;
        if (this._earnTimer >= 1) {
          this._earnTimer -= 1;
          const share   = 1 / this.owners.length;
          const goldSec = goldPerSecByTier(this.pvpTier);
          const myOwner = this.owners.find(o => o.name === gs.playerName);
          for (const o of this.owners) {
            o.points += BASE_CONFIG.pointsPerSec * share;
            o.gold   += goldSec * share;
          }
          if (myOwner) gs.gainCorpRep?.(0.0002);
          this._persist();
          this._refreshOwnerLabel();
        }
      }

      // Реген щита/прочности базы (см. константы вверху файла — те же ставки для
      // базы и турелей, запрошены пользователем отдельно от урона).
      const sinceDmg = now - this.lastDamageAt;
      if (this.maxShield > 0 && sinceDmg > SHIELD_REGEN_DELAY_MS && this.shield < this.maxShield) {
        this.shield = Math.min(this.maxShield, this.shield + this.maxShield * SHIELD_REGEN_PCT_SEC * dt);
      }
      if (sinceDmg > HULL_REGEN_DELAY_MS && this.hull < this.maxHull) {
        this.hull = Math.min(this.maxHull, this.hull + this.maxHull * HULL_REGEN_PCT_SEC * dt);
      }

      for (const tt of this.turretTargets) tt?.update(dt, now);

      this._updateTurrets(dt);
      // Как Mob._updateVisuals — перерисовываем бары каждый кадр, а не только по
      // событиям (иначе PvP-попадания по pvpMobId, меняющие hull/shield ИЗВНЕ через
      // GameScene._onPvpMobHitResult, визуально не отражались бы вовсе).
      this._refreshHpBar();
      this._refreshTurretHpBars();
    }
  }

  destroy() {
    [this._buildSprite, this._baseSprite,
     this._hpBar, this._hpBarBg, this._shieldBar,
     this._nameLabel, this._stateLabel, this._ownerLabel,
     this._menuBtnBg, this._menuBtnLbl, this._zone]
      .forEach(o => o?.destroy());
    this._turretSprites.forEach(t => t?.destroy());
    this._turretHpBars.forEach(t => t?.destroy());
    this._turretHpBarsBg.forEach(t => t?.destroy());
    this._turretShieldBars.forEach(t => t?.destroy());
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _createVisuals() {
    const { x, y } = this;
    const sz  = BASE_CONFIG.displaySize;       // 460 — active / building
    const szD = BASE_CONFIG.displayDestroyed;  // 340 — destroyed (smaller, dimmed)
    const tsz = BASE_CONFIG.turretSize;

    // Faint capture-zone circle
    this._zone = this.scene.add.circle(x, y, BASE_CONFIG.captureRadius, 0x4dd0e1, 0.04)
      .setDepth(-5);

    // Building-state sprite
    this._buildSprite = this.scene.add.image(x, y, 'base_building')
      .setDisplaySize(sz, sz).setDepth(5).setVisible(false);

    // Active / destroyed sprite (texture + size swapped on state change)
    this._baseSprite = this.scene.add.image(x, y, 'base_destroyed')
      .setDisplaySize(szD, szD).setDepth(5).setVisible(false);

    // Turret sprites — positioned at slot offsets, hidden until slot is built
    this._turretSprites = TURRET_SLOTS.map(s =>
      this.scene.add.image(x + s.x, y + s.y, 'cannon1_neutral')
        .setDisplaySize(tsz, tsz).setDepth(6).setVisible(false)
    );

    // Per-turret hp/shield bars — small strips just below each turret sprite
    const tbw = 46, tbh = 4;
    this._turretHpBarsBg   = [];
    this._turretHpBars     = [];
    this._turretShieldBars = [];
    TURRET_SLOTS.forEach(s => {
      const bx = x + s.x, by = y + s.y + tsz / 2 + 8;
      this._turretHpBarsBg.push(
        this.scene.add.rectangle(bx, by, tbw, tbh, 0x000000, 0.5).setDepth(7).setVisible(false));
      this._turretHpBars.push(
        this.scene.add.rectangle(bx - tbw / 2, by, 0, tbh, 0xef5350, 1).setOrigin(0, 0.5).setDepth(7).setVisible(false));
      this._turretShieldBars.push(
        this.scene.add.rectangle(bx - tbw / 2, by - tbh, 0, 2, 0x4dd0e1, 1).setOrigin(0, 0.5).setDepth(7).setVisible(false));
    });

    // HP bar — floats above the top edge of the active/building sprite
    const barY = y - sz / 2 - 22;
    this._hpBarBg = this.scene.add.rectangle(x, barY, 200, 8, 0x333344, 1).setDepth(7);
    this._hpBar   = this.scene.add.rectangle(x - 100, barY, 0, 8, 0x4dd0e1, 1)
      .setOrigin(0, 0.5).setDepth(7);
    this._shieldBar = this.scene.add.rectangle(x - 100, barY - 6, 0, 4, 0x80deea, 1)
      .setOrigin(0, 0.5).setDepth(7);

    const tf = { fontFamily: 'Orbitron', fontSize: '16px', color: '#4dd0e1', resolution: UI_RES };

    // Station name — above HP bar
    const namY = y - sz / 2 - 42;
    this._nameLabel = this.scene.add.text(x, namY, 'MINING STATION',
      { ...tf, fontSize: '18px' }).setOrigin(0.5).setDepth(7);

    // State label — below base sprite
    const stY = y + sz / 2 + 20;
    this._stateLabel = this.scene.add.text(x, stY, '',
      { ...tf, fontSize: '13px', color: '#ffb74d' }).setOrigin(0.5).setDepth(7);

    // Top-3 owner strip
    const owY = y + sz / 2 + 40;
    this._ownerLabel = this.scene.add.text(x, owY, '',
      { ...tf, fontSize: '12px', color: '#aaaacc' }).setOrigin(0.5).setDepth(7);

    // In-world menu button — always visible, opens BaseMenuScene on click
    const btnY = y + sz / 2 + 68;
    this._menuBtnBg = this.scene.add.rectangle(x, btnY, 182, 30, 0x0d1a26, 0.92)
      .setDepth(8).setStrokeStyle(1, 0x4dd0e1, 0.9).setInteractive({ useHandCursor: true });
    this._menuBtnLbl = this.scene.add.text(x, btnY, '[ МЕНЮ БАЗЫ ]',
      { ...tf, fontSize: '13px', color: '#80deea' }).setOrigin(0.5).setDepth(9);

    this._menuBtnBg.on('pointerdown', () => {
      this.interact(this.scene.playerName);
    });

    this._refreshVisuals();
  }

  _refreshVisuals() {
    const s      = this.state;
    const assets = CORP_ASSETS[this.corp] || CORP_ASSETS.neutral;
    const sz     = BASE_CONFIG.displaySize;
    const szD    = BASE_CONFIG.displayDestroyed;

    this._buildSprite.setVisible(s === 'building');
    this._baseSprite.setVisible(s === 'active' || s === 'destroyed');

    if (s === 'destroyed') {
      this._baseSprite.setTexture('base_destroyed').setDisplaySize(szD, szD).setAlpha(0.55);
    } else if (s === 'active') {
      this._baseSprite.setTexture(assets.base).setDisplaySize(sz, sz).setAlpha(1);
    } else { // building
      this._buildSprite.setDisplaySize(sz, sz);
    }

    this._refreshHpBar();
    this._refreshTurrets();
    this._refreshTurretHpBars();
    this._refreshStateLabel();
    this._refreshOwnerLabel();
  }

  _refreshHpBar() {
    const show  = this.state !== 'destroyed';
    const hullFrac   = this.maxHull   > 0 ? this.hull   / this.maxHull   : 0;
    const shieldFrac = this.maxShield > 0 ? this.shield / this.maxShield : 0;
    this._hpBarBg.setVisible(show);
    this._hpBar.setVisible(show);
    this._shieldBar.setVisible(show && this.maxShield > 0);
    this._hpBar.setDisplaySize(Math.round(200 * hullFrac), 8);
    this._shieldBar.setDisplaySize(Math.round(200 * shieldFrac), 4);
    const color = hullFrac > 0.5 ? 0x4dd0e1 : hullFrac > 0.25 ? 0xffb74d : 0xef5350;
    this._hpBar.setFillStyle(color);
  }

  _refreshTurretHpBars() {
    this.turrets.forEach((type, i) => {
      const tt = this.turretTargets[i];
      const bg = this._turretHpBarsBg[i], bar = this._turretHpBars[i], sbar = this._turretShieldBars[i];
      if (!bg || !bar || !sbar) return;
      const show = !!(type && this.state === 'active' && tt?.alive);
      bg.setVisible(show); bar.setVisible(show); sbar.setVisible(show && tt?.maxShield > 0);
      if (!show || !tt) return;
      const hullFrac   = tt.maxHull   > 0 ? tt.hull   / tt.maxHull   : 0;
      const shieldFrac = tt.maxShield > 0 ? tt.shield / tt.maxShield : 0;
      bar.setDisplaySize(Math.round(46 * hullFrac), 4);
      sbar.setDisplaySize(Math.round(46 * shieldFrac), 2);
    });
  }

  _refreshTurrets() {
    const assets = CORP_ASSETS[this.corp] || CORP_ASSETS.neutral;
    const tsz = BASE_CONFIG.turretSize;
    this.turrets.forEach((type, i) => {
      const spr = this._turretSprites[i];
      if (!spr) return;
      if (type && this.state === 'active') {
        // setTexture() ТОЛЬКО меняет кадр, scaleX/scaleY остаются от предыдущей
        // текстуры — cannon1/cannon2 у разных корпов различаются нативным пикс.
        // размером (268-389 × 305-463), без переприменения setDisplaySize турель
        // при смене типа/корпа рисовалась бы то мельче, то на треть крупнее tsz.
        spr.setTexture(type === 'cannon2' ? assets.cannon2 : assets.cannon1)
          .setDisplaySize(tsz, tsz).setVisible(true);
      } else {
        spr.setVisible(false);
      }
    });
  }

  _refreshStateLabel() {
    if (this.state === 'destroyed') {
      this._stateLabel.setText('[ РАЗРУШЕНА ]');
    } else if (this.state === 'building') {
      const rem = Math.ceil(BASE_CONFIG.buildTimeSec - this._buildTimer);
      const m = Math.floor(rem / 60), s = rem % 60;
      this._stateLabel.setText(`СТРОИТСЯ — ${m}:${String(s).padStart(2, '0')}`);
    } else if (this.corp === 'neutral') {
      this._stateLabel.setText(
        this._neutralPhase === 'immune' ? 'НЕЙТРАЛЬНА (иммунитет)' : 'НЕЙТРАЛЬНА (открыта)'
      );
    } else {
      this._stateLabel.setText(`АКТИВНА · ${this.corp.toUpperCase()}`);
    }
  }

  _refreshOwnerLabel() {
    if (!this.owners.length) { this._ownerLabel.setText(''); return; }
    const top = this.owners.slice(0, 3)
      .map(o => `${o.name}: ${Math.floor(o.points)} очк`).join('  ');
    this._ownerLabel.setText(top);
  }

  _updateTurrets(dt) {
    const gs   = this.scene;
    const mobs = gs.mobs || [];

    TURRET_SLOTS.forEach((slot, i) => {
      const type = this.turrets[i];
      if (!type || !this.turretTargets[i]?.alive) return;

      const range   = type === 'cannon2' ? BASE_CONFIG.cannon2Range  : BASE_CONFIG.cannon1Range;
      const damage  = (type === 'cannon2' ? BASE_CONFIG.cannon2Damage : BASE_CONFIG.cannon1Damage)
        * pvpTierMult(this.pvpTier);
      const rateInv = type === 'cannon2'
        ? 1 / BASE_CONFIG.cannon2Rate
        : 1 / BASE_CONFIG.cannon1Rate;
      const boltCount = type === 'cannon2' ? 2 : 1;

      this._turretCooldowns[i] -= dt;

      const tx = this.x + slot.x;
      const ty = this.y + slot.y;

      // Find nearest alive mob in range — every frame, not just on the fire tick,
      // so rotation below can track it smoothly between shots.
      let nearest = null, nearestDist = range;
      for (const mob of mobs) {
        if (!mob.alive) continue;
        const d = Phaser.Math.Distance.Between(tx, ty, mob.x, mob.y);
        if (d < nearestDist) { nearest = mob; nearestDist = d; }
      }

      // Turn turret art toward target gradually (sprites drawn nose-up → +π/2
      // offset) — setRotation() only on the fire tick made the barrel visibly
      // snap once per cooldown (1s) instead of tracking smoothly every frame.
      const spr = this._turretSprites[i];
      if (spr?.visible && nearest) {
        const targetAngle = Math.atan2(nearest.y - ty, nearest.x - tx) + Math.PI / 2;
        const diff = Phaser.Math.Angle.Wrap(targetAngle - spr.rotation);
        const maxStep = 6 * dt; // rad/sec turn rate
        spr.rotation += Phaser.Math.Clamp(diff, -maxStep, maxStep);
      }

      if (!nearest || this._turretCooldowns[i] > 0) return;
      this._turretCooldowns[i] = rateInv;

      // Скоростной болт (см. GameScene._fireVisualBolt — тот же спрайт/скорость,
      // что и у выстрелов игрока) — раньше был только muzzleFlash в точке турели,
      // сам летящий снаряд к цели не рисовался. cannon2 стреляет двумя болтами
      // (визуальный стиль "спаренной" пушки), cannon1 — одним.
      const angle = Math.atan2(nearest.y - ty, nearest.x - tx);
      const perpX = -Math.sin(angle), perpY = Math.cos(angle);
      const boltColor = type === 'cannon2' ? 0xff6a00 : 0xffaa44;
      for (let bIdx = 0; bIdx < boltCount; bIdx++) {
        const off = boltCount === 1 ? 0 : (bIdx === 0 ? -7 : 7);
        gs._fireVisualBolt?.(tx + perpX * off, ty + perpY * off, nearest.x + perpX * off, nearest.y + perpY * off, boltColor);
      }
      gs.muzzleFlash?.(tx, ty, 0xffaa44);

      if (nearest.pvpMobId) {
        // Общий моб реалтайм-комнаты — залп идёт через turretFireClaim, НЕ через
        // локальный takeDamage (иначе урон турели видел бы только этот клиент,
        // и мог бы "ожить" мобу, которого уже убили другие — см. Mob-баг выше).
        // turretId = id базы + слот — стабилен, сервер дедуплицирует по нему
        // независимые заявки всех клиентов, видящих эту же турель.
        gs.pvpClient?.turretFireClaim(
          `${this.id}:${i}`, nearest.pvpMobId, nearest.maxHull, nearest.maxShield,
          nearest.x, nearest.y, tx, ty, type, damage, this.pvpTier,
        );
      } else {
        const res = nearest.takeDamage(damage, 0);
        if (res.killed) gs.onMobKilled?.(nearest);
      }
    });
  }

  _onDestroyed() {
    this.state = 'destroyed';
    this.hull  = 0;
    this.shield = 0;
    for (const o of this.owners) {
      this.pointsBanked += o.points;
      this.goldBanked   += o.gold;
    }
    const gs = this.scene;
    const myOwner = this.owners.find(o => o.name === gs.playerName);
    if (myOwner) {
      const goldEarned = Math.floor(myOwner.gold);
      if (goldEarned > 0) {
        gs.starGold = (gs.starGold || 0) + goldEarned;
        gs.log(`База разрушена! Получено ${goldEarned} ⭐`);
      }
    }
    gs.explosion?.(this.x, this.y, 2.0);
    gs.log('Добывающая база разрушена!');
    this.corp   = 'neutral';
    this.owners = [];
    this.turrets = Array(BASE_CONFIG.turretSlots).fill(null);
    this.turretTargets = Array(BASE_CONFIG.turretSlots).fill(null);
    this._neutralPhase = 'open';
    this._neutralTimer = 0;
    this._refreshVisuals();
    this._persist();
    if (gs.scene.isActive('BaseMenuScene')) gs.scene.stop('BaseMenuScene');
  }

  // Сбрасывает базу в нейтральное активное состояние (еженедельный респаун).
  resetToNeutral() {
    this.corp          = 'neutral';
    this.state         = 'active';
    this.hull          = this.maxHull;
    this.shield        = this.maxShield;
    this.owners        = [];
    this.pointsBanked  = 0;
    this.goldBanked    = 0;
    this.turrets       = Array(BASE_CONFIG.turretSlots).fill(null);
    this.turretTargets = Array(BASE_CONFIG.turretSlots).fill(null);
    this._neutralPhase = 'open';
    this._neutralTimer = 0;
    this._buildTimer   = 0;
    this._refreshVisuals();
    this._persist();
  }

  _persist() {
    _registry.set(this.id, {
      corp:         this.corp,
      state:        this.state,
      hull:         this.hull,
      shield:       this.shield,
      lastDamageAt: this.lastDamageAt,
      owners:       this.owners.map(o => ({ ...o })),
      pointsBanked: this.pointsBanked,
      goldBanked:   this.goldBanked,
      turrets:      this.turrets.slice(),
      turretState:  this.turretTargets.map(tt => tt
        ? { hull: tt.hull, shield: tt.shield, lastDamageAt: tt.lastDamageAt }
        : null),
      neutralPhase: this._neutralPhase,
      neutralTimer: this._neutralTimer,
      buildTimer:   this._buildTimer,
    });
  }
}
