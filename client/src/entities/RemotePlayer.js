import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { ART_ANGLE_OFFSET, COLORS, UI_RES } from '../constants.js';
import { SHIP_BY_KEY, SHIPS } from '../ships.js';
import { RANK_TINTS, rankTier } from './Player.js';

// Другой живой игрок в той же realtime-комнате (PvP-сектор, домашняя/PvE карта,
// групповой данж — см. GameScene._currentRealtimeRoomKey). В отличие от Player
// (локальный корабль) и Mob (клиент-локальный AI) — только рендер + интерполяция
// к позиции, которую авторитетно шлёт сервер (PvpRoomManager в server/main.py).
// Никакой физики, урона или боевой логики здесь нет — это чистый вид на другого игрока.
export default class RemotePlayer {
  constructor(scene, data, isHostile = true) {
    this.scene  = scene;
    this.userId = data.userId;
    this.name   = data.name || 'Пилот';
    this.corp   = data.corp || 'neutral'; // для ally-fire чека в GameScene._fireCannon/_fireLaser
    this.level  = data.level || 1;        // для тира чести (PVP_HIGHER/EQUAL/LOWER), см. _onPvpHitResult
    this.rankId = data.rankId ?? null;    // для иконки ранга нашивки, см. _refreshNameplate
    this.clanTag = data.clanTag || null;
    this.alive  = true;
    this.isRemotePlayer = true; // отличаем от Mob/Player в таргетинге/огне GameScene без instanceof

    this._shipKey = data.shipKey;
    const shipDef = SHIP_BY_KEY[data.shipKey] || SHIPS[0];
    this.sprite = scene.add.image(data.x, data.y, shipDef.key).setDepth(50);
    const src = scene.textures.get(shipDef.key).getSourceImage();
    const scale = shipDef.displaySize / Math.max(src.width, src.height);
    this.sprite.setDisplaySize(Math.round(src.width * scale), Math.round(src.height * scale));
    this._artAngleOffset = shipDef.artAngleOffset ?? ART_ANGLE_OFFSET;
    // Корабль показывается в СВОИХ цветах (без тинта) — враждебность/принадлежность
    // читается по нику под кораблём (см. this._baseColor/label ниже), не по перекраске
    // спрайта, которая раньше скрывала реальный вид/скин корабля игрока.

    this._baseColor = isHostile ? '#ff8a8a' : '#8ad8ff';
    // Нашивка над кораблём — та же структура (иконка ранга + клан-тег + ник + герб
    // корпуса), что и у собственного корабля (см. Player.js:setNameplate/update) —
    // раньше у других игроков был виден только голый ник под кораблём (баг из диалога:
    // "ранг, тег и герб корп - не видно у другого игрока"). label переиспользуется как
    // текст ника (тот же объект, что и раньше — на нём завязан _updateWantedMarker),
    // но теперь укладывается в общий ряд слева направо, над кораблём, не под ним.
    this.label = scene.add.text(data.x, data.y, this.name, {
      fontFamily: 'Inter, sans-serif', fontSize: '12px',
      color: this._baseColor, stroke: '#000000', strokeThickness: 3, resolution: UI_RES,
    }).setOrigin(0, 0.5).setDepth(51);
    this._npIcon = scene.add.image(0, 0, 'rank_tier1').setDisplaySize(22, 22).setDepth(51);
    this._npTag = scene.add.text(0, 0, '', {
      fontFamily: 'Inter, sans-serif', fontSize: '11px',
      color: '#4dd0e1', stroke: '#000000', strokeThickness: 3, resolution: UI_RES,
    }).setOrigin(0, 0.5).setDepth(51).setVisible(false);
    this._npEmblemBg = scene.add.graphics().setDepth(50).setVisible(false);
    this._npEmblem = scene.add.image(0, 0, 'rank_tier1').setDisplaySize(18, 18).setDepth(51).setVisible(false);
    this.bar = scene.add.graphics().setDepth(51);
    this._refreshNameplate();

    this.heading    = data.heading ?? 0;
    this.hull       = data.hull ?? 1;
    this.maxHull    = data.maxHull ?? 1;
    this.shield     = data.shield ?? 0;
    this.maxShield  = data.maxShield ?? 0;

    // Целевая (авторитетная) точка от сервера — визуально доезжаем до неё лерпом
    // между пакетами (~10Hz), а не телепортируемся на каждое обновление.
    this._targetX = data.x;
    this._targetY = data.y;
    this._targetHeading = this.heading;

    // Косметическое "квантовое" мерцание корпуса Аргуса (см. ArgusController — то же,
    // что видит владелец на своём Аргусе) — раньше был виден только владельцу, другие
    // игроки видели статичный корабль (баг из диалога: "не видно эффект фазового
    // сдвига... аргус у другого игрока"). Если уже заходит на Аргусе — включаем сразу.
    if (this._shipKey === 'argus') this.scene.argusCtrl?.attachToRemotePlayer(this);
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  // Тот же расчёт, что Player.js:setNameplate — иконка ранга (тир+тинт по rankId),
  // клан-тег в квадратных скобках, герб корпуса с цветным кольцом. Вызывается один раз
  // в конструкторе и повторно из applyPublicState при смене corp/rankId/clanTag.
  _refreshNameplate() {
    const id = this.rankId ?? 20;
    const tier = rankTier(id);
    const tint = RANK_TINTS[id] ?? 0x888888;
    this._npIconSz = id === 1 ? 30 : 22;
    this._npIcon.setTexture(`rank_tier${tier}`).setTint(tint).setDisplaySize(this._npIconSz, this._npIconSz);
    if (this.clanTag) this._npTag.setText(`[${this.clanTag}]`).setVisible(this.alive);
    else this._npTag.setText('').setVisible(false);
    const embKey = this.corp && this.corp !== 'neutral' ? `emblem_${this.corp}` : null;
    if (embKey && this.scene.textures.exists(embKey)) {
      const ring = { helios: 0xdd2200, karax: 0x00bb66, tides: 0x1188ff }[this.corp] ?? 0x888888;
      this._npEmblemBg.clear()
        .fillStyle(0x050810, 0.78).fillCircle(0, 0, 11)
        .lineStyle(1.5, ring, 0.95).strokeCircle(0, 0, 11);
      this._npEmblemBg.setVisible(this.alive);
      this._npEmblem.setTexture(embKey).setDisplaySize(18, 18).setVisible(this.alive);
    } else {
      this._npEmblemBg.setVisible(false);
      this._npEmblem.setVisible(false);
    }
  }

  applyPos(x, y, heading) {
    // Возобновление pvp_pos_update после смерти = респавн реально произошёл — сервер
    // получает эти пакеты, только пока GameScene.update() шлёт их (sendPos гейтится
    // this.player.alive), т.е. пока сам игрок жив. Значит первый пакет ПОСЛЕ die() —
    // надёжный сигнал "уже респавнулся", без отдельного pvp_player_respawned от сервера.
    const wasDead = !this.alive;
    if (wasDead) this.revive();
    this._targetX = x;
    this._targetY = y;
    if (heading !== undefined) this._targetHeading = heading;
    // Респавн обычно телепортирует далеко (домашняя база и т.п.) — плавный лерп через
    // всю карту выглядел бы как проскок сквозь сектор. Спавним сразу на месте.
    if (wasDead) {
      this.sprite.setPosition(x, y);
      if (heading !== undefined) this.heading = heading;
    }
  }

  // Визуально "мёртв" до фактического респавна (диалог ремонта на СТОРОНЕ жертвы) —
  // сервер уже восстановил hull/shield в своей бухгалтерии в момент килла (см. комментарий
  // в GameScene._onPvpHitResult), но для наблюдателей корабль должен выглядеть
  // уничтоженным, а не полностью здоровым и живым, до реального возвращения игрока.
  die() {
    this.alive = false;
    this.sprite.setVisible(false);
    this.label.setVisible(false);
    this.bar.setVisible(false);
    this._npIcon.setVisible(false);
    this._npTag.setVisible(false);
    this._npEmblemBg.setVisible(false);
    this._npEmblem.setVisible(false);
  }

  revive() {
    this.alive = true;
    this.sprite.setVisible(true);
    this.label.setVisible(true);
    this.bar.setVisible(true);
    this._npIcon.setVisible(true);
    if (this._npTag.text) this._npTag.setVisible(true);
    if (this._npEmblem.texture.key !== 'rank_tier1') {
      this._npEmblemBg.setVisible(true);
      this._npEmblem.setVisible(true);
    }
  }

  // Полное состояние (используется на pvp_room_snapshot/pvp_player_joined, а
  // позже — на pvp_hit_result, когда сервер шлёт новый hull/shield жертвы).
  applyState(data) {
    if (data.x !== undefined) this.applyPos(data.x, data.y, data.heading);
    if (data.hull !== undefined) this.hull = data.hull;
    if (data.maxHull !== undefined) this.maxHull = data.maxHull;
    if (data.shield !== undefined) this.shield = data.shield;
    if (data.maxShield !== undefined) this.maxShield = data.maxShield;
  }

  // pvp_player_updated (см. PvpClient.js) — другой игрок сменил корабль/корпус/
  // уровень/макс. HP ПОСЛЕ джойна комнаты (напр. DEV-хоткей 8: переключение на
  // Аргуса). Раньше это никуда не долетало — RemotePlayer строится один раз в
  // конструкторе и никогда не перечитывал shipKey, так что уже заспавненные
  // наблюдатели вечно видели старый корабль, даже после смерти/респавна жертвы.
  applyPublicState(data) {
    if (data.corp !== undefined) this.corp = data.corp;
    if (data.level !== undefined) this.level = data.level;
    if (data.maxHull !== undefined) this.maxHull = data.maxHull;
    if (data.maxShield !== undefined) this.maxShield = data.maxShield;
    if (data.shipKey && data.shipKey !== this._shipKey) this.applyShip(data.shipKey);
    let nameplateDirty = false;
    if (data.rankId !== undefined && data.rankId !== this.rankId) { this.rankId = data.rankId; nameplateDirty = true; }
    if (data.clanTag !== undefined && data.clanTag !== this.clanTag) { this.clanTag = data.clanTag; nameplateDirty = true; }
    if (data.corp !== undefined) nameplateDirty = true; // герб зависит от corp — уже применён выше
    if (nameplateDirty) this._refreshNameplate();
  }

  applyShip(shipKey) {
    const wasArgus = this._shipKey === 'argus';
    this._shipKey = shipKey;
    const shipDef = SHIP_BY_KEY[shipKey] || SHIPS[0];
    this.sprite.setTexture(shipDef.key);
    const src = this.scene.textures.get(shipDef.key).getSourceImage();
    const scale = shipDef.displaySize / Math.max(src.width, src.height);
    this.sprite.setDisplaySize(Math.round(src.width * scale), Math.round(src.height * scale));
    this._artAngleOffset = shipDef.artAngleOffset ?? ART_ANGLE_OFFSET;
    // Квантовое мерцание Аргуса (см. конструктор) — включаем/выключаем при смене корабля
    // ПОСЛЕ джойна комнаты (DEV-хоткей 8 на уже заспавненном RemotePlayer).
    if (shipKey === 'argus' && !wasArgus) this.scene.argusCtrl?.attachToRemotePlayer(this);
    else if (shipKey !== 'argus' && wasArgus) this.scene.argusCtrl?.detachFromRemotePlayer(this.userId);
  }

  update(dt) {
    // Та же идея, что camera lerp в Movement.js — плавное сближение с последней
    // авторитетной точкой, без собственного предсказания/физики.
    const t = Math.min(1, dt * 8);
    this.sprite.x += (this._targetX - this.sprite.x) * t;
    this.sprite.y += (this._targetY - this.sprite.y) * t;
    const dh = Phaser.Math.Angle.Wrap(this._targetHeading - this.heading);
    this.heading += dh * t;
    this.sprite.rotation = this.heading + this._artAngleOffset;
    this.drawBar();
    this._updateWantedMarker();
    this._layoutNameplate();
  }

  // Тот же приём укладки в ряд, что Player.js:update (иконка ранга → клан-тег → ник →
  // герб корпуса, центрировано над кораблём) — bar (HP-полоска) уже над кораблём чуть
  // ближе, нашивка ставится ещё выше, чтобы не перекрываться с ней.
  _layoutNameplate() {
    const npY     = this.y - this.sprite.displayHeight * 0.6 - 24;
    const hasTag  = this._npTag.visible;
    const hasEmbl = this._npEmblem.visible;
    const tagW    = hasTag ? this._npTag.width + 4 : 0;
    const iconSz  = this._npIconSz ?? 22;
    const totalW  = iconSz + 4 + tagW + this.label.width + (hasEmbl ? 4 + 18 : 0);
    const npX     = this.x - totalW / 2;
    this._npIcon.setPosition(npX + iconSz / 2, npY);
    let cursor = npX + iconSz + 4;
    if (hasTag) { this._npTag.setPosition(cursor, npY); cursor += this._npTag.width + 4; }
    this.label.setPosition(cursor, npY);
    if (hasEmbl) {
      const embX = cursor + this.label.width + 4 + 9;
      this._npEmblemBg.setPosition(embX, npY);
      this._npEmblem.setPosition(embX, npY);
    }
  }

  // Доска розыска: префикс + красный цвет ника, пока этот игрок в gs.wantedPlayers
  // (Map<userId,name> — см. HudScene onBountyPosted/Cleared/Snapshot).
  _updateWantedMarker() {
    const isWanted = this.scene.wantedPlayers?.has(this.userId) ?? false;
    if (isWanted === this._wasWanted) return;
    this._wasWanted = isWanted;
    this.label.setText(isWanted ? `💀 ${this.name}` : this.name);
    this.label.setColor(isWanted ? '#ff5252' : this._baseColor);
  }

  // Позиция (this.x/y) меняется почти каждый кадр — setPosition — дешёвая
  // трансформация; содержимое бара (заливка hull/shield) перерисовываем только
  // когда реально изменилось (см. тот же паттерн в Mob.js:drawBar).
  drawBar() {
    const w = 46, h = 4;
    this.bar.setPosition(this.x, this.y - this.sprite.displayHeight * 0.6 - 10);
    const hullFrac   = Math.max(0, this.hull / this.maxHull);
    const shieldFrac = this.maxShield > 0 ? Math.max(0, this.shield / this.maxShield) : 0;
    // Числа, не строка — см. тот же фикс в Mob.js:drawBar (шаблонная строка на
    // сравнение = аллокация каждый кадр = давление на GC).
    const hSig = Math.round(hullFrac * 1000), sSig = Math.round(shieldFrac * 1000);
    if (hSig === this._lastHullSig && sSig === this._lastShieldSig) return;
    this._lastHullSig = hSig; this._lastShieldSig = sSig;
    this.bar.clear();
    this.bar.fillStyle(0x000000, 0.5); this.bar.fillRect(-w / 2 - 1, -1, w + 2, h + 2);
    this.bar.fillStyle(COLORS.danger, 1);
    this.bar.fillRect(-w / 2, 0, w * hullFrac, h);
    if (this.maxShield > 0) {
      this.bar.fillStyle(COLORS.primary, 1);
      this.bar.fillRect(-w / 2, -3, w * shieldFrac, 2);
    }
  }

  destroy() {
    this.scene.argusCtrl?.detachFromRemotePlayer(this.userId);
    this.sprite.destroy();
    this.label.destroy();
    this.bar.destroy();
    this._npIcon.destroy();
    this._npTag.destroy();
    this._npEmblemBg.destroy();
    this._npEmblem.destroy();
  }
}
