import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';
import { BASE_CONFIG, TURRET_SLOTS, CORP_ASSETS } from '../bases.js';
import { COLORS, UI_RES } from '../constants.js';

// Persists base ownership/state across sector re-entries.
// Key = baseId string, value = plain data object (corp, state, owners, pointsBanked, goldBanked, hull, turrets).
const _registry = new Map();

export default class MiningBase {
  static get registry() { return _registry; }

  constructor(scene, x, y, { id, pvpTier = 1 } = {}) {
    this.scene   = scene;
    this.x       = x;
    this.y       = y;
    this.id      = id || `base_${Math.round(x)}_${Math.round(y)}`;
    this.pvpTier = pvpTier;

    // Restore persisted state or start fresh as neutral+destroyed
    const saved = _registry.get(this.id);
    if (saved) {
      this.corp       = saved.corp;
      this.state      = saved.state;
      this.hull       = saved.hull;
      this.owners     = saved.owners.slice();        // [{name, points, gold}]
      this.pointsBanked = saved.pointsBanked;
      this.goldBanked   = saved.goldBanked;
      this.turrets    = saved.turrets.slice();       // [null | 'cannon1' | 'cannon2']
      this._neutralPhase = saved.neutralPhase || 'open';
      this._neutralTimer = saved.neutralTimer || 0;
      this._buildTimer   = saved.buildTimer || 0;
    } else {
      this.corp       = 'neutral';
      this.state      = 'destroyed';
      this.hull       = 0;
      this.owners     = [];
      this.pointsBanked = 0;
      this.goldBanked   = 0;
      this.turrets    = Array(BASE_CONFIG.turretSlots).fill(null);
      this._neutralPhase = 'open';
      this._neutralTimer = 0;
      this._buildTimer   = 0;
    }

    this._earnTimer = 0;
    this._buildSprite   = null;
    this._baseSprite    = null;
    this._turretSprites = [];
    this._hpBar         = null;
    this._hpBarBg       = null;
    this._nameLabel     = null;
    this._stateLabel    = null;
    this._ownerLabel    = null;
    this._interactHint  = null;
    this._zone          = null;

    this._createVisuals();
    this._persist();
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  get alive() { return this.state === 'active'; }
  get canBeAttacked() { return this.alive && !(this.corp === 'neutral' && this._neutralPhase === 'immune'); }

  // Called by Projectile._hit() — must return {hullHit, shieldHit, killed}
  takeDamage(damage /*, penetration */) {
    if (!this.canBeAttacked) return { hullHit: 0, shieldHit: 0, killed: false };
    const actual = Math.min(Math.round(damage), this.hull);
    this.hull -= actual;
    this._refreshHpBar();
    if (this.hull <= 0) this._onDestroyed();
    return { hullHit: actual, shieldHit: 0, killed: false }; // destruction handled internally
  }

  // Called from GameScene when player presses F near a base — always opens menu
  interact(playerName) {
    const gs = this.scene;
    if (gs.scene.isActive('BaseMenuScene')) gs.scene.stop('BaseMenuScene');
    gs.scene.launch('BaseMenuScene', { base: this, playerName });
  }

  buyBase(playerName) {
    const gs = this.scene;
    if ((gs.credits || 0) < BASE_CONFIG.baseCostCredits) {
      gs.log(`Недостаточно кредитов (нужно ${BASE_CONFIG.baseCostCredits})`);
      return;
    }
    gs.credits -= BASE_CONFIG.baseCostCredits;
    this.corp  = _corpByPlayer(playerName);
    this.state = 'building';
    this.hull  = 0;
    this.owners = [{ name: playerName, points: 0, gold: 0 }];
    this.turrets = Array(BASE_CONFIG.turretSlots).fill(null);
    this._buildTimer = 0;
    this._refreshVisuals();
    this._persist();
    gs.log(`База куплена — строится (15 мин)`);
  }

  buyTurret(slotIdx, type, playerName) {
    if (this.state !== 'active') return;
    if (this.turrets[slotIdx] !== null) return;
    const gs = this.scene;
    if ((gs.credits || 0) < BASE_CONFIG.turretCostCredits) {
      gs.log(`Недостаточно кредитов (нужно ${BASE_CONFIG.turretCostCredits})`);
      return;
    }
    gs.credits -= BASE_CONFIG.turretCostCredits;
    this.turrets[slotIdx] = type;
    this._refreshTurrets();
    this._persist();
    gs.log(`Турель ${type} установлена на слот ${slotIdx + 1}`);
  }

  // Called each game tick from GameScene.update()
  update(dt) {
    if (this.state === 'building') {
      this._buildTimer += dt;
      const frac = Math.min(1, this._buildTimer / BASE_CONFIG.buildTimeSec);
      this.hull = Math.round(BASE_CONFIG.hullMax * frac);
      this._refreshHpBar();
      if (this._buildTimer >= BASE_CONFIG.buildTimeSec) {
        this.state = 'active';
        this.hull  = BASE_CONFIG.hullMax;
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

      // Earn points & gold for owners
      if (this.owners.length > 0) {
        this._earnTimer += dt;
        if (this._earnTimer >= 1) {
          this._earnTimer -= 1;
          const share = 1 / this.owners.length;
          for (const o of this.owners) {
            o.points += BASE_CONFIG.pointsPerSec * share;
            o.gold   += BASE_CONFIG.goldPerSec   * share;
          }
          this._persist();
          this._refreshOwnerLabel();
        }
      }
    }

    // Update interact hint visibility (show when player is close)
    if (this._interactHint) {
      const gs = this.scene;
      const d  = Phaser.Math.Distance.Between(gs.player.x, gs.player.y, this.x, this.y);
      const show = d < BASE_CONFIG.captureRadius * 2 && gs.player.alive;
      this._interactHint.setVisible(show);
    }
  }

  destroy() {
    [this._buildSprite, this._baseSprite, this._hpBar, this._hpBarBg,
     this._nameLabel, this._stateLabel, this._ownerLabel, this._interactHint, this._zone]
      .forEach(o => o?.destroy());
    this._turretSprites.forEach(t => t?.destroy());
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  _createVisuals() {
    const { x, y } = this;

    // Zone glow
    this._zone = this.scene.add.circle(x, y, BASE_CONFIG.captureRadius, 0x4dd0e1, 0.04).setDepth(-5);

    // Sprites — all created once, visibility/texture toggled on state change
    this._buildSprite = this.scene.add.image(x, y, 'base_building')
      .setDisplaySize(BASE_CONFIG.displaySize, BASE_CONFIG.displaySize).setDepth(5).setVisible(false);

    this._baseSprite = this.scene.add.image(x, y, 'base_destroyed')
      .setDisplaySize(BASE_CONFIG.displaySize, BASE_CONFIG.displaySize).setDepth(5).setVisible(false);

    // Turret sprites (hidden until slot has turret)
    this._turretSprites = TURRET_SLOTS.map((s, _i) => {
      const spr = this.scene.add.image(x + s.x, y + s.y, 'cannon1_neutral')
        .setDisplaySize(48, 48).setDepth(6).setVisible(false);
      return spr;
    });

    // HP bar
    this._hpBarBg = this.scene.add.rectangle(x, y - 180, 200, 8, 0x333344, 1).setDepth(7);
    this._hpBar   = this.scene.add.rectangle(x - 100, y - 180, 0, 8, 0x4dd0e1, 1).setOrigin(0, 0.5).setDepth(7);

    // Labels
    const tf = { fontFamily: 'Orbitron', fontSize: '16px', color: '#4dd0e1', resolution: UI_RES };
    this._nameLabel  = this.scene.add.text(x, y - 200, 'MINING STATION', { ...tf, fontSize: '18px' }).setOrigin(0.5).setDepth(7);
    this._stateLabel = this.scene.add.text(x, y + 170, '', { ...tf, fontSize: '13px', color: '#ffb74d' }).setOrigin(0.5).setDepth(7);
    this._ownerLabel = this.scene.add.text(x, y + 190, '', { ...tf, fontSize: '12px', color: '#aaaacc' }).setOrigin(0.5).setDepth(7);
    this._interactHint = this.scene.add.text(x, y + 210, '[F] Взаимодействие', { ...tf, fontSize: '12px', color: '#88cc88' }).setOrigin(0.5).setDepth(7).setVisible(false);

    this._refreshVisuals();
  }

  _refreshVisuals() {
    const s = this.state;
    const assets = CORP_ASSETS[this.corp] || CORP_ASSETS.neutral;

    this._buildSprite.setVisible(s === 'building');
    this._baseSprite.setVisible(s === 'active' || s === 'destroyed');

    if (s === 'destroyed') {
      this._baseSprite.setTexture('base_destroyed').setAlpha(0.55);
    } else if (s === 'active') {
      this._baseSprite.setTexture(assets.base).setAlpha(1);
    }

    this._refreshHpBar();
    this._refreshTurrets();
    this._refreshStateLabel();
    this._refreshOwnerLabel();
  }

  _refreshHpBar() {
    const frac = BASE_CONFIG.hullMax > 0 ? this.hull / BASE_CONFIG.hullMax : 0;
    const show  = this.state !== 'destroyed';
    this._hpBarBg.setVisible(show);
    this._hpBar.setVisible(show);
    this._hpBar.setDisplaySize(Math.round(200 * frac), 8);
    const color = frac > 0.5 ? 0x4dd0e1 : frac > 0.25 ? 0xffb74d : 0xef5350;
    this._hpBar.setFillStyle(color);
  }

  _refreshTurrets() {
    const assets = CORP_ASSETS[this.corp] || CORP_ASSETS.neutral;
    this.turrets.forEach((type, i) => {
      const spr = this._turretSprites[i];
      if (!spr) return;
      if (type && this.state === 'active') {
        const key = type === 'cannon2' ? assets.cannon2 : assets.cannon1;
        spr.setTexture(key).setVisible(true);
      } else {
        spr.setVisible(false);
      }
    });
  }

  _refreshStateLabel() {
    if (this.state === 'destroyed') {
      this._stateLabel.setText('[ РАЗРУШЕНА ]  (нажмите для покупки)');
    } else if (this.state === 'building') {
      const rem = Math.ceil(BASE_CONFIG.buildTimeSec - this._buildTimer);
      const m = Math.floor(rem / 60), s = rem % 60;
      this._stateLabel.setText(`СТРОИТСЯ — ${m}:${String(s).padStart(2, '0')}`);
    } else if (this.corp === 'neutral') {
      const label = this._neutralPhase === 'immune' ? 'НЕЙТРАЛЬНА (иммунитет)' : 'НЕЙТРАЛЬНА (открыта)';
      this._stateLabel.setText(label);
    } else {
      this._stateLabel.setText(`АКТИВНА · ${this.corp.toUpperCase()}`);
    }
  }

  _refreshOwnerLabel() {
    if (!this.owners.length) { this._ownerLabel.setText(''); return; }
    const top = this.owners.slice(0, 3).map(o => `${o.name}: ${Math.floor(o.points)} очк`).join('  ');
    this._ownerLabel.setText(top);
  }

  _onDestroyed() {
    this.state = 'destroyed';
    this.hull  = 0;
    // Bank all owner points/gold before reset
    for (const o of this.owners) {
      this.pointsBanked += o.points;
      this.goldBanked   += o.gold;
    }
    // Credit gold to the GameScene player if they are an owner
    const gs = this.scene;
    const myOwner = this.owners.find(o => o.name === gs.playerName);
    if (myOwner) {
      const goldEarned = Math.floor(myOwner.gold);
      if (goldEarned > 0) {
        gs.starGold = (gs.starGold || 0) + goldEarned;
        gs.log(`База разрушена! Получено ${goldEarned} ⭐`);
      }
    }
    // Explosion and state reset
    gs.explosion?.(this.x, this.y, 2.0);
    gs.log('Добывающая база разрушена!');
    this.corp   = 'neutral';
    this.owners = [];
    this.turrets = Array(BASE_CONFIG.turretSlots).fill(null);
    this._neutralPhase = 'open';
    this._neutralTimer = 0;
    this._refreshVisuals();
    this._persist();
    // Close base menu if open
    if (gs.scene.isActive('BaseMenuScene')) gs.scene.stop('BaseMenuScene');
  }

  _persist() {
    _registry.set(this.id, {
      corp:         this.corp,
      state:        this.state,
      hull:         this.hull,
      owners:       this.owners.map(o => ({ ...o })),
      pointsBanked: this.pointsBanked,
      goldBanked:   this.goldBanked,
      turrets:      this.turrets.slice(),
      neutralPhase: this._neutralPhase,
      neutralTimer: this._neutralTimer,
      buildTimer:   this._buildTimer,
    });
  }
}

// Determine corp affiliation from player name (uses GameScene corp membership, falls back to neutral)
function _corpByPlayer(_playerName) {
  // In the prototype the player's corp isn't tracked per-player on the server.
  // Return 'neutral' and let the base visuals default until corp system is wired.
  return 'neutral';
}
