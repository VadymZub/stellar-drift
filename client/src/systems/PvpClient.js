import RemotePlayer from '../entities/RemotePlayer.js';

/**
 * PvpClient — client-side live-position sync + PvP presence.
 * Communicates over the existing /ws/chat WebSocket, same pattern as GroupSystem.
 *
 * Usage (from GameScene):
 *   this.pvpClient = new PvpClient(this, wsRef);
 *   ... on PvP-sector enter: this.pvpClient.enterSector(sector, x, y, loadoutSnapshot)
 *   ... every frame while in a PvP sector: this.pvpClient.sendPos(x, y, heading)
 *
 * The WS reference must already be open. PvpClient does NOT own the socket.
 * Server is authoritative for player-vs-player position/combat, AND for shared
 * mob HP/kill in PvP sectors (see PvpMobState in server/main.py) — mob movement/AI
 * itself stays client-local (each client simulates its own copy), only hull/shield/
 * kill are synced across everyone via pvp_mob_fire_claim/pvp_mob_hit_result.
 */
export class PvpClient {
    constructor(scene, ws) {
        this.scene   = scene;
        this.ws      = ws;
        this.sector  = null;
        this.players = new Map();   // userId -> RemotePlayer

        this._posAccum = 0;
        this._posIntervalMs = 100;  // ~10Hz — держим канал лёгким при частом update()

        // Callbacks — assigned from HudScene._connectChatWS, same pattern as GroupSystem's.
        this.onHitResult    = null; // (msg) => void — игрок-игрок
        this.onMobHitResult = null; // (msg) => void — игрок-моб (общий HP-леджер)
        this.onLootSpawned  = null; // (msg) => void — новый общий лут-бокс мне видим
        this.onLootResult   = null; // (msg) => void — ответ на мою claimLoot
        this.onLootRemoved  = null; // (lootId) => void — кто-то другой забрал раньше меня
        this.onEscortStarted = null; // (msg) => void — кто-то другой в комнате начал daily_escort
        this.onBountyPosted  = null; // (msg) => void — {userId,name} поставлен в розыск
        this.onBountyCleared = null; // (msg) => void — {userId} розыск снят (убит)
        this.onBountySnapshot = null; // (msg) => void — {bounties:[{userId,name}]} при подключении
        this.onWagonReward   = null; // (msg) => void — доля пропорциональной награды за вагон бронепоезда
        this.onTrainSnapshot = null; // (msg) => void — {trainKey, destroyed:[idx], wagons:{mobId:{hull,...}}}
    }

    // ── Outgoing ─────────────────────────────────────────────────────────────

    enterSector(sector, x, y, loadout) {
        this.leaveSector();
        this.sector = sector;
        this._send({ type: 'pvp_enter', sector, x, y, loadout });
    }

    /** Обновляет потолок лоадаута без выхода/входа в комнату (без этого смена корабля/
     * экипировки/уровня ПОСЛЕ входа оставляла бы сервер с протухшим потолком урона —
     * см. Player.recomputeStats). Позиции/членство в комнате не трогает. */
    updateLoadout(loadout) {
        if (!this.sector) return;
        this._send({ type: 'pvp_update_loadout', loadout });
    }

    /** Throttled internally — safe to call every frame from GameScene.update(). */
    sendPos(x, y, heading, dtMs) {
        if (!this.sector) return;
        this._posAccum += dtMs;
        if (this._posAccum < this._posIntervalMs) return;
        this._posAccum = 0;
        this._send({ type: 'pvp_pos', x, y, heading });
    }

    /** dmg — реально посчитанный урон ЭТОГО выстрела (скилл-баффы/перки/патроны уже
     * применены, крит — нет, крит решает сервер своим роллом по loadout.critChance/
     * critMult). Сервер трактует dmg как заявку, зажатую потолком от loadout при входе
     * в комнату — не слепое доверие, но и не плоское число на весь визит в комнату. */
    fireClaim(targetUserId, weaponType, dmg) {
        if (!this.sector) return;
        this._send({ type: 'pvp_fire_claim', targetUserId, weaponType, dmg });
    }

    /** maxHull/maxShield — сервер лениво создаёт HP-запись мобa по этим значениям при
     * первом попадании кого угодно; mobX/mobY — для мягкой проверки дальности на сервере
     * (движение моба клиент-локальное, сервер не знает его позицию иначе); dmg — см. fireClaim.
     * wagonReward — ТОЛЬКО для вагонов бронепоезда (mobId вида "train:..."): детерминированный
     * (по ARMORED_TRAIN_SECTORS, одинаковый у всех атакующих) пул {credits,xp,gold,...} —
     * сервер использует его, только если ИМЕННО этот выстрел добивает вагон (см. main.py). */
    mobFireClaim(mobId, maxHull, maxShield, mobX, mobY, weaponType, dmg, wagonReward) {
        if (!this.sector) return;
        const payload = { type: 'pvp_mob_fire_claim', mobId, maxHull, maxShield, mobX, mobY, weaponType, dmg };
        if (wagonReward) payload.wagonReward = wagonReward;
        this._send(payload);
    }

    /** Залп турели добывающей базы — НЕ личное оружие игрока (сервер валидирует
     * урон/дальность/КД по типу турели, не по loadout отправителя, и дедуплицирует
     * между клиентами, которые видят ту же турель — см. TURRET_WEAPONS в main.py).
     * turretId должен быть стабилен и уникален (base.id + слот), baseX/baseY —
     * позиция самой турели/базы, не отправляющего игрока. */
    turretFireClaim(turretId, mobId, maxHull, maxShield, mobX, mobY, baseX, baseY, weaponType, dmg, pvpTier) {
        if (!this.sector) return;
        this._send({ type: 'pvp_turret_fire_claim', turretId, mobId, maxHull, maxShield, mobX, mobY, baseX, baseY, weaponType, dmg, pvpTier });
    }

    /** Отправляется ЖЕРТВОЙ сразу после смерти — только у неё есть реальный инвентарь,
     * откуда считается дроп. Сервер сам решает, кому коробка будет видна (см. eligible
     * на сервере: победитель + все, кто наносил урон в эту жизнь). */
    spawnLoot(x, y, item) {
        if (!this.sector) return;
        this._send({ type: 'pvp_loot_spawn', x, y, item });
    }

    claimLoot(lootId) {
        if (!this.sector) return;
        this._send({ type: 'pvp_loot_claim', lootId });
    }

    /** Лутбокс с уничтоженного вагона бронепоезда (см. GameScene._spawnWagonLoot) —
     * отправляется ТОЛЬКО добившим клиентом. eligible — явный список uid, в отличие от
     * spawnLoot выше (там сервер сам берёт last_death_eligible жертвы — тут нет игрока-
     * жертвы, вагон, поэтому список контрибьюторов шлём прямо, взят из damageBy того же
     * pvp_mob_hit_result, что уже дал денежную долю за вагон). Пикап — тот же
     * pvp_loot_claim/claimLoot, что и обычный лут с игрока. */
    wagonLootSpawn(x, y, item, eligible) {
        if (!this.sector) return;
        this._send({ type: 'pvp_wagon_loot_spawn', x, y, item, eligible });
    }

    leaveSector() {
        if (!this.sector) return;
        this._send({ type: 'pvp_leave' });
        this.sector = null;
        this._clearAll();
    }

    /** Оповещает остальных в комнате, что этот игрок начал daily_escort — сервер лишь
     * ретранслирует (без состояния), см. server main.py pvp_escort_start. */
    escortStart() {
        if (!this.sector) return;
        this._send({ type: 'pvp_escort_start' });
    }

    /** Отправляется ЖЕРТВОЙ сразу после своей смерти в PvP, если убийца оказался выше
     * уровнем (см. GameScene._onPvpHitResult) — сервер не проверяет уровни повторно. */
    bountyPost(killerId, killerName, killerCorp) {
        this._send({ type: 'pvp_bounty_post', killerId, killerName, killerCorp });
    }

    /** Запрашивает свежий список розыска (online/sector считаются сервером на момент
     * запроса) — вызывается при открытии вкладки РОЗЫСК в CorpScene. */
    bountyQuery() {
        this._send({ type: 'pvp_bounty_query' });
    }

    /** Запрашивает текущее состояние бронепоезда (какие вагоны уже уничтожены, hull/
     * shield живых) — вызывается сразу после локального построения ArmoredTrain, чтобы
     * не показывать полное HP игроку, зашедшему в сектор после начала события. */
    trainQuery(trainKey) {
        if (!this.sector) return;
        this._send({ type: 'pvp_train_query', trainKey });
    }

    /** DEV-хоткей T (GameScene): бронепоезд запущен с произвольным startAt=Date.now(),
     * не детерминированным wall-clock расписанием — остальные клиенты сектора сами до
     * него не додумаются, без этого поезд был виден только тому, кто нажал T. Сервер
     * (pvp_train_force_spawn) ретранслирует startAt остальным в комнате. */
    trainForceSpawn(startAt) {
        if (!this.sector) return;
        this._send({ type: 'pvp_train_force_spawn', startAt });
    }

    // ── Incoming (call from WS onmessage handler, routed by HudScene) ────────

    handleMessage(msg) {
        switch (msg.type) {
            case 'pvp_room_snapshot':
                this._clearAll();
                for (const p of msg.players ?? []) this._spawn(p);
                // Реконсиляция уже заспавненных локально мобов с текущим сервером-леджером —
                // если кто-то бил этого моба до нашего входа, подхватываем актуальный hull.
                if (msg.mobs) this.scene._applyPvpMobSnapshot?.(msg.mobs);
                break;

            case 'pvp_player_joined':
                if (msg.player && !this.players.has(msg.player.userId)) this._spawn(msg.player);
                break;

            case 'pvp_player_left':
                this._despawn(msg.userId);
                break;

            case 'pvp_pos_update': {
                const rp = this.players.get(msg.userId);
                rp?.applyPos(msg.x, msg.y, msg.heading);
                break;
            }

            // Другой игрок сменил корабль/корпус/уровень/макс. HP (см. server
            // pvp_update_loadout) уже ПОСЛЕ джойна комнаты — раньше это никак не
            // долетало до уже созданных RemotePlayer (баг "враг на Аргусе, а вижу
            // старый корабль" — переживало даже респавн жертвы).
            case 'pvp_player_updated': {
                const rp = this.players.get(msg.userId);
                rp?.applyPublicState(msg);
                break;
            }

            case 'pvp_hit_result':
                this.onHitResult?.(msg);
                break;

            case 'pvp_mob_hit_result':
                this.onMobHitResult?.(msg);
                break;

            case 'pvp_wagon_reward':
                this.onWagonReward?.(msg);
                break;

            case 'pvp_loot_spawned':
                this.onLootSpawned?.(msg);
                break;

            case 'pvp_loot_result':
                this.onLootResult?.(msg);
                break;

            case 'pvp_loot_removed':
                this.onLootRemoved?.(msg.lootId);
                break;

            case 'pvp_escort_started':
                this.onEscortStarted?.(msg);
                break;

            case 'pvp_bounty_posted':
                this.onBountyPosted?.(msg);
                break;

            case 'pvp_bounty_cleared':
                this.onBountyCleared?.(msg);
                break;

            case 'pvp_bounty_snapshot':
                this.onBountySnapshot?.(msg);
                break;

            case 'pvp_train_snapshot':
                this.onTrainSnapshot?.(msg);
                break;

            case 'pvp_train_force_spawn':
                this.onTrainForceSpawn?.(msg);
                break;
        }
    }

    // ── Per-frame ─────────────────────────────────────────────────────────────

    update(dt) {
        for (const rp of this.players.values()) rp.update(dt);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _spawn(data) {
        // Красный (враждебный) только в реальном PvP-секторе И чужой корпус — на
        // остальных realtime-картах (домашняя/PvE/групповой данж) и игроков СВОЕГО
        // корпа даже в PvP другие игроки союзники, красить в "враг" некорректно (и
        // атаковать их нельзя, см. GameScene._fireCannon/_fireLaser ally-fire чек).
        const isHostile = !!this.scene._isPvpSector && data.corp !== (this.scene.playerCorp || 'neutral');
        this.players.set(data.userId, new RemotePlayer(this.scene, data, isHostile));
    }

    _despawn(userId) {
        this.players.get(userId)?.destroy();
        this.players.delete(userId);
    }

    _clearAll() {
        for (const rp of this.players.values()) rp.destroy();
        this.players.clear();
    }

    _send(obj) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
        }
    }
}
