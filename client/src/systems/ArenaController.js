// Владелец состояния арена-матча на клиенте — создаётся в GameScene.create() при
// входе в arenaMode-сектор (см. ARENA_MODES/SECTORS), уничтожается на следующем
// restart(). Сервер авторитетен за командами/счётом/целями (см. server/arena.py,
// main.py arena_*) — этот класс строит визуал (базы/флаг/груз/точки) из
// ARENA_LAYOUTS + пришедшего arena_match_found, и применяет arena_objective_sync/
// arena_score/arena_respawn/arena_match_end как есть, без собственной логики захвата.
import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { ARENA_LAYOUTS } from '../data/arenaLayouts.js';
import { ARENA_TEAM_COLOR, ARENA_BASE_SAFE_R, ARENA_CAPTURE_R, ARENA_PICKUP_R, ARENA_POINT_R, ARENA_POINT_ROW_OFFSET, ARENA_CARGO_PICKUP_MS } from '../constants.js';
import ArenaFlag from '../entities/ArenaFlag.js';
import ArenaCargoContainer from '../entities/ArenaCargoContainer.js';
import ArenaPoint from '../entities/ArenaPoint.js';
import { arenaMatchComplete } from '../api.js';

export default class ArenaController {
  constructor(scene, match) {
    this.scene = scene;
    this.matchId   = match.matchId;
    this.roomKey   = match.roomKey;
    this.mode      = match.mode;                 // 'flag' | 'points' | 'cargo' | 'duel'
    this.sectorKey = match.sectorKey;
    this.myTeam    = match.team;                 // 'a' | 'b'
    this.teammateIds = new Set(match.teammateIds ?? []);
    this.enemyIds    = new Set(match.enemyIds ?? []);
    this.teamOfCache = new Map();
    for (const id of match.teammateIds ?? []) this.teamOfCache.set(id, this.myTeam);
    for (const id of match.enemyIds ?? []) this.teamOfCache.set(id, this.myTeam === 'a' ? 'b' : 'a');
    this.teamOfCache.set(scene.myUserId, this.myTeam);
    this.scores = { a: 0, b: 0 };
    this.outcome = null;
    this._rewardClaimed = false;

    const cx = scene.worldWidth / 2, cy = scene.worldHeight / 2;
    const layout = ARENA_LAYOUTS[this.sectorKey];
    this.bases = { a: { x: cx, y: cy }, b: { x: cx, y: cy } };
    if (layout?.bases) {
      this.bases.a = { x: cx + layout.bases.a[0], y: cy + layout.bases.a[1] };
      this.bases.b = { x: cx + layout.bases.b[0], y: cy + layout.bases.b[1] };
    }

    this.flags = null;
    this.cargo = null;
    this.points = null;

    if (this.mode === 'flag') {
      this.flags = {
        a: new ArenaFlag(scene, 'a', this.bases.a.x, this.bases.a.y),
        b: new ArenaFlag(scene, 'b', this.bases.b.x, this.bases.b.y),
      };
    } else if (this.mode === 'cargo') {
      const spawn = layout?.cargoSpawn ?? [0, 0];
      this.cargo = new ArenaCargoContainer(scene, cx + spawn[0], cy + spawn[1]);
      // Канал подбора груза (10с в радиусе, как обычный лут — см. GameScene.updateLoot/
      // PICKUP_TIME) — прогресс-кольцо тем же depth, что и у обычного сбора (58).
      this._cargoPickupGfx = scene.add.graphics().setDepth(58);
      this._cargoPickupStart = null;
    } else if (this.mode === 'points') {
      // Офсет A/C выбран сервером НА МАТЧ (см. диалог: "точки сделать случайный
      // разброс") и пришёл в match.pointOffset — статики под фиксированную позицию
      // здесь больше нет (см. arenaLayouts.js). Клиренс стен под реальный офсет
      // режется в рантайме в GameScene.createDungeonWalls (clipLine).
      const off = match.pointOffset ?? 1600;
      // A/C сдвинуты на соседние ряды сетки в ПРОТИВОПОЛОЖНЫЕ стороны (не просто
      // офсет по x на той же строке, что и базы) — иначе весь бой сводится к одной
      // горизонтальной линии (см. диалог: "3 точки на одной линии — нет смысла
      // летать кроме как по одной линии"). Должно зеркалить server
      // _arena_point_positions ровно координата-в-координату.
      this.points = [
        new ArenaPoint(scene, 'A', cx - off, cy - ARENA_POINT_ROW_OFFSET),
        new ArenaPoint(scene, 'B', cx, cy),
        new ArenaPoint(scene, 'C', cx + off, cy + ARENA_POINT_ROW_OFFSET),
      ];
    }

    // Дуэль 1на1 — без safe zone на базах (кольца/неатакуемость только у режимов
    // 3на3 с реальными объективами, см. isEnemyOnOwnBase).
    if (this.mode !== 'duel') this._drawBaseRings();

    // Обратный отсчёт 5с до начала боя — движение/стрельба заблокированы, см.
    // countdownActive (читается из Movement.update/GameScene.firePlayerWeapon).
    // Локально на каждом клиенте (не синхронизировано с сервером явным сообщением) —
    // оба клиента получают arena_match_found примерно в одно и то же серверное время,
    // расхождение в пределах пинга приемлемо для чисто визуального фриза старта.
    // Сервер тоже игнорирует урон первые 5с матча независимо (см. main.py pvp_fire_claim
    // arena-ветка) — так что даже при рассинхроне читерский ранний выстрел не пройдёт.
    this._startCountdown();
  }

  get countdownActive() { return this._countdownText != null; }

  // Вызывается конструктором (старт матча) и onRespawn для дуэли (новый раунд,
  // см. onRespawn — сервер шлёт arena_respawn ОБОИМ игрокам между раундами дуэли,
  // не только на настоящий финал матча).
  _startCountdown() {
    this._countdownEndAt = this.scene.time.now + 5000;
    if (!this._countdownText) {
      this._countdownText = this.scene.add.text(this.scene.scale.width / 2, this.scene.scale.height / 2, '5', {
        fontFamily: 'Orbitron, sans-serif', fontSize: '96px', color: '#4dd0e1',
        stroke: '#000', strokeThickness: 8,
      }).setOrigin(0.5).setDepth(500).setScrollFactor(0);
    }
  }

  _updateCountdown(now) {
    if (!this._countdownText) return;
    const remain = this._countdownEndAt - now;
    if (remain <= 0) {
      this._countdownText.setText('БОЙ!');
      this.scene.time.delayedCall(500, () => { this._countdownText?.destroy(); this._countdownText = null; });
      return;
    }
    this._countdownText.setText(String(Math.ceil(remain / 1000)));
  }

  // ── Команда/дружба ────────────────────────────────────────────────────────
  teamOf(userId) { return this.teamOfCache.get(userId) ?? null; }
  baseOf(team) { return this.bases[team]; }

  isOnOwnBase(entity) {
    const b = this.bases[this.myTeam];
    return Phaser.Math.Distance.Between(entity.x, entity.y, b.x, b.y) < ARENA_BASE_SAFE_R;
  }

  isEnemyOnOwnBase(entity, entityTeam) {
    if (this.mode === 'duel') return false;  // дуэль без safe zone
    const b = this.bases[entityTeam];
    return Phaser.Math.Distance.Between(entity.x, entity.y, b.x, b.y) < ARENA_BASE_SAFE_R;
  }

  _drawBaseRings() {
    this._baseGfx = this.scene.add.graphics().setDepth(-5);
    for (const team of ['a', 'b']) {
      const { x, y } = this.bases[team];
      const color = ARENA_TEAM_COLOR[team];
      this._baseGfx.fillStyle(color, 0.06);
      this._baseGfx.fillCircle(x, y, ARENA_BASE_SAFE_R);
      this._baseGfx.lineStyle(3, color, 0.55);
      this._baseGfx.strokeCircle(x, y, ARENA_BASE_SAFE_R);
      // Точка доставки — отдельный, втрое меньший кружок в центре (см. диалог: "именно
      // туда нужно долететь, чтобы поставить вражеский флаг") — раньше донести
      // засчитывалось по всему большому радиусу safe zone, без точности.
      this._baseGfx.fillStyle(color, 0.20);
      this._baseGfx.fillCircle(x, y, ARENA_CAPTURE_R);
      this._baseGfx.lineStyle(2, color, 0.85);
      this._baseGfx.strokeCircle(x, y, ARENA_CAPTURE_R);
    }
  }

  // ── Дебаф носителя (флаг/груз) — см. Player.recomputeStats ──────────────
  _refreshCarrierDebuff() {
    const p = this.scene.player;
    if (!p) return;
    let carrying = false;
    if (this.mode === 'flag' && this.flags) {
      carrying = Object.values(this.flags).some(f => f._carriedBy === this.scene.myUserId);
    } else if (this.mode === 'cargo' && this.cargo) {
      carrying = this.cargo._carriedBy === this.scene.myUserId;
    }
    if (p._arenaCarrier !== carrying) {
      p._arenaCarrier = carrying;
      p.recomputeStats?.();
    }
  }

  // ── Входящие с сервера ────────────────────────────────────────────────────
  onObjectiveSync(msg) {
    if (msg.flags && this.flags) {
      for (const team of ['a', 'b']) if (msg.flags[team]) this.flags[team].applyState(msg.flags[team]);
    }
    if (msg.cargo && this.cargo) {
      const carrierTeam = msg.cargo.carrier != null ? this.teamOf(msg.cargo.carrier) : null;
      this.cargo.applyState(msg.cargo, carrierTeam);
    }
    if (msg.points && this.points) {
      for (const p of this.points) if (msg.points[p.id]) p.applyState(msg.points[p.id]);
    }
    this._refreshCarrierDebuff();
  }

  onScore(msg) {
    this.scores.a = msg.a; this.scores.b = msg.b;
    // Дуэль — счёт не показываем (нет смысла в бегущем табло на 1 бой до 2 побед,
    // см. диалог: "так в дуэли не нужно показывать") — только баннер по arena_match_end
    // (showArenaMatchEnd уже сам решает, что показать).
    if (this.mode === 'duel') return;
    this.scene.scene.get('HudScene')?.setArenaScore?.(this.scores);
  }

  onRespawn(msg) {
    // Дуэль не респаунится в привычном смысле (3на3) — arena_respawn туда приходит
    // ТОЛЬКО между раундами best-of-3 (см. server _arena_on_kill), оба участника сразу.
    // Новый раунд = новый 5с обратный отсчёт, как в начале матча.
    if (this.mode === 'duel') this._startCountdown();
    if (msg.userId === this.scene.myUserId) {
      const p = this.scene.player;
      if (!p) return;
      p.respawn(msg.x, msg.y);
      this.scene.playerRespawning = false;  // онPlayerKilled() пропустил _showRepairDialog — сбросить самим
      return;
    }
    // Наблюдатель (соперник респаунится) — раньше этот метод молча игнорировал чужой
    // userId, полагаясь ТОЛЬКО на implicit-детект в RemotePlayer.applyPos (первый
    // pvp_pos_update после die() = "уже респавнулся"). Из-за задержки до ~100мс между
    // arena_respawn и следующим pvp_pos от респаунящегося клиента наблюдатель на миг
    // видел старый скрытый/замёрзший кадр рядом с уже актуальной позицией — "раздвоение"
    // из диалога со скриншотом. Явно оживляем/переставляем RemotePlayer сразу же, тем же
    // порядком (revive() → setPosition), что и applyPos.
    const rp = this.scene.pvpClient?.players?.get(msg.userId);
    if (rp) {
      rp.revive();
      rp.sprite.setPosition(msg.x, msg.y);
      rp._targetX = msg.x;
      rp._targetY = msg.y;
    }
  }

  async onMatchEnd(msg) {
    this.outcome = msg.outcome; // 'win' | 'lose' | 'draw' | 'void' — нормализовано сервером на игрока
    // (см. main.py _broadcast_arena_match_end — раньше слался сырой 'win_a'/'win_b'
    // всем одинаково, клиент показывал его как есть, см. диалог: "просто wins_a").
    this.scene.scene.get('HudScene')?.showArenaMatchEnd?.(msg.outcome, msg.winnerName);
    if (!this._rewardClaimed) {
      this._rewardClaimed = true;
      if (msg.outcome !== 'void' && msg.outcome !== 'lose') {
        try {
          const dayKey = this.scene._dungeonDayKey();
          const res = await arenaMatchComplete(dayKey, this.matchId, msg.outcome);
          if (res?.eligible) {
            this.scene.pilotHonor = (this.scene.pilotHonor || 0) + (res.honor || 0);
            this.scene.starGold   = (this.scene.starGold   || 0) + (res.gold  || 0);
            this.scene._saveState?.();
            this.scene.log?.(`🏆 Арена: +${res.honor} чести, +${res.gold} ⭐ (сегодня ${res.rewardedCount}/10)`);
          }
        } catch (_e) { /* сеть недоступна — награда просто не применится, матч уже сыгран */ }
      }
    }
    // Без этого игрок бесконечно висел в мёртвом арена-инстансе после конца матча —
    // выйти было решительно нечем (баг из диалога: "не выбрасывает с карты, непонятно
    // как выйти"). Задержка — дать увидеть баннер результата (см. showArenaMatchEnd,
    // 4с автоскрытие). Гвард на случай повторного onMatchEnd (не должно случаться, но
    // дважды планировать выброс безвредно проверить лишним не будет).
    if (!this._leaveScheduled) {
      this._leaveScheduled = true;
      this.scene.time.delayedCall(4000, () => this.scene._leaveArenaToPrevSector?.());
    }
  }

  // ── Локальная смерть — арена не идёт через платный _showRepairDialog ────
  onLocalDeath() {
    if (this.mode === 'duel') return; // ждём arena_respawn (новый раунд) либо arena_match_end (финал)
    // respawn придёт по таймеру с сервера (arena_respawn) — здесь просто ждём.
  }

  // Позиция несущего (я сам или RemotePlayer) — флаг/груз следуют за ним, пока
  // update() у самого объекта ранний-return'ит на _carriedBy (см. Loot.js _magnetPull).
  _posOf(uid) {
    if (uid === this.scene.myUserId) return this.scene.player;
    return this.scene.pvpClient?.players?.get(uid) ?? null;
  }

  update(now) {
    this._updateCountdown(now);
    if (this.countdownActive) return;  // движение/цели/взаимодействия — только после старта
    if (this.flags) {
      for (const f of Object.values(this.flags)) {
        if (f._carriedBy != null) { const c = this._posOf(f._carriedBy); if (c) f.setPosition(c.x, c.y - 40); }
        f.update(now);
      }
    }
    if (this.cargo) {
      if (this.cargo._carriedBy != null) {
        const c = this._posOf(this.cargo._carriedBy);
        if (c) { this.cargo.setPosition(c.x, c.y - 40); this.cargo.setCarrierShipPos(c.x, c.y); }
      }
      this.cargo.update(now);
      this._updateCargoPickupChannel(now);
    }
    if (this.points) for (const p of this.points) p.update(now);
    this._checkInteractions(now);
  }

  // Канал подбора груза — 10с в радиусе, как обычный лут (см. GameScene.updateLoot/
  // PICKUP_TIME), не мгновенно по дистанции (баг из диалога: "груз — сбор как обычный
  // лут"). НЕ троттлится 300мс, как _checkInteractions — таймингу нужна кадровая
  // точность, иначе прогресс-кольцо дёргается.
  _updateCargoPickupChannel(now) {
    const p = this.scene.player;
    const pc = this.scene.pvpClient;
    this._cargoPickupGfx.clear();
    if (!p?.alive || !pc || !this.cargo.available) { this._cargoPickupStart = null; return; }
    const myId = this.scene.myUserId;
    const carrying = this.cargo._carriedBy === myId;
    const inRange = !carrying && this.cargo._carriedBy == null &&
      Phaser.Math.Distance.Between(p.x, p.y, this.cargo.x, this.cargo.y) < ARENA_PICKUP_R;
    if (!inRange) { this._cargoPickupStart = null; return; }
    if (this._cargoPickupStart == null) this._cargoPickupStart = now;
    const elapsed = now - this._cargoPickupStart;
    const frac = Math.min(1, elapsed / ARENA_CARGO_PICKUP_MS);
    this._cargoPickupGfx.lineStyle(3, ARENA_TEAM_COLOR[this.myTeam] ?? 0xffffff, 0.8);
    this._cargoPickupGfx.strokeCircle(this.cargo.x, this.cargo.y, 45 * (1 - frac));
    if (frac >= 1) {
      pc.arenaCargoPickup();
      this._cargoPickupStart = null;
    }
  }

  // Проверка целей по дистанции (клиент только ПРЕДЛАГАЕТ действие — сервер финальный
  // судья по своей копии позиции, см. main.py arena_flag_pickup/capture/return,
  // arena_cargo_pickup/deliver, arena_point_claim). Throttle 3/сек — не спамить WS.
  _checkInteractions(now) {
    if ((this._lastInteractionCheck ?? 0) + 300 > now) return;
    this._lastInteractionCheck = now;
    const p = this.scene.player;
    const pc = this.scene.pvpClient;
    if (!p?.alive || !pc) return;
    const myId = this.scene.myUserId;

    if (this.mode === 'flag' && this.flags) {
      const enemyTeam = this.myTeam === 'a' ? 'b' : 'a';
      const enemyFlag = this.flags[enemyTeam];
      const myFlag = this.flags[this.myTeam];
      const carryingEnemy = enemyFlag._carriedBy === myId;
      if (!carryingEnemy && enemyFlag._carriedBy == null &&
          Phaser.Math.Distance.Between(p.x, p.y, enemyFlag.x, enemyFlag.y) < ARENA_PICKUP_R) {
        pc.arenaFlagPickup();
      } else if (carryingEnemy &&
          Phaser.Math.Distance.Between(p.x, p.y, this.bases[this.myTeam].x, this.bases[this.myTeam].y) < ARENA_CAPTURE_R) {
        pc.arenaFlagCapture();
      }
      if (!myFlag.atBase && myFlag._carriedBy == null &&
          Phaser.Math.Distance.Between(p.x, p.y, myFlag.x, myFlag.y) < ARENA_PICKUP_R) {
        pc.arenaFlagReturn();
      }
    } else if (this.mode === 'cargo' && this.cargo) {
      // Подбор — см. _updateCargoPickupChannel (10с канал, не мгновенно). Здесь только
      // доставка — мгновенная по дистанции до базы, как и раньше.
      const carrying = this.cargo._carriedBy === myId;
      if (carrying &&
          Phaser.Math.Distance.Between(p.x, p.y, this.bases[this.myTeam].x, this.bases[this.myTeam].y) < ARENA_CAPTURE_R) {
        pc.arenaCargoDeliver();
      }
    } else if (this.mode === 'points' && this.points) {
      for (const pt of this.points) {
        if (pt.owner === this.myTeam) continue;
        if (Phaser.Math.Distance.Between(p.x, p.y, pt.x, pt.y) < ARENA_POINT_R) pc.arenaPointClaim(pt.id);
      }
    }
  }

  destroy() {
    this._countdownText?.destroy();
    this._countdownText = null;
    this._baseGfx?.destroy();
    if (this.flags) for (const f of Object.values(this.flags)) f.destroy();
    this.cargo?.destroy();
    this._cargoPickupGfx?.destroy();
    if (this.points) for (const p of this.points) p.destroy();
  }
}
