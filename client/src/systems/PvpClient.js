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
        this.onResourceResult    = null; // (msg) => void — ответ на мою claimResource
        this.onResourceCollected = null; // (resourceId) => void — кто-то другой в комнате собрал этот депозит
        this.onResourceRespawned = null; // (msg) => void — общий депозит комнаты снова доступен
        this.onEscortStarted = null; // (msg) => void — кто-то другой в комнате начал daily_escort
        this.onBountyPosted  = null; // (msg) => void — {userId,name} поставлен в розыск
        this.onBountyCleared = null; // (msg) => void — {userId} розыск снят (убит)
        this.onBountySnapshot = null; // (msg) => void — {bounties:[{userId,name}]} при подключении
        this.onWagonReward   = null; // (msg) => void — доля пропорциональной награды за вагон бронепоезда
        this.onTrainSnapshot = null; // (msg) => void — {trainKey, destroyed:[idx], wagons:{mobId:{hull,...}}}
        this.onMobRoomUpdate = null; // (msg) => void — {roomKey, mobs:[{mobId,targetUserId}]} серверный таргетинг дронов/турелей
        this.onMobAttackVfx  = null; // (msg) => void — {mobId,weaponType,targetUserId} моб/турель бьёт другого игрока комнаты
        this.onMobAttackResult = null; // (msg) => void — {targetUserId,dodged,hullHit,shieldHit,hull,maxHull,shield,maxShield,killed,isCrit}
        this.onTrainWeaponFire = null; // (msg) => void — {trainKey,wagonIdx,weapon,hits:[{uid,hits,dmg,hull,shield,maxHull,maxShield,killed}]}
                                        // — сервер САМ решил и применил урон (ракетный залп/поворотная турель поезда),
                                        // без client-claim заявки; клиент только рисует визуал и синкает HP.
        this.onWorldEventReward = null; // (msg) => void — {weKey,credits,xp,gold} — моя доля пропорциональной
                                         // награды за расчистку волны нашествия (см. worldEventClearClaim)
    }

    // ── Outgoing ─────────────────────────────────────────────────────────────

    /** resources — предложенная раскладка депозитов ресурса ЭТОГО клиента (см.
     * GameScene._pendingResourceProposal), нужна только для комнат, где депозиты
     * должны быть общими (PvP-сектора, групповые данжи) — сервер использует её,
     * только если он первый в этой комнате (см. server get_or_create_resources),
     * иначе просто вернёт уже сохранённую раскладку в pvp_room_snapshot. */
    enterSector(sector, x, y, loadout, resources = []) {
        this.leaveSector();
        this.sector = sector;
        const payload = { type: 'pvp_enter', sector, x, y, loadout };
        if (resources.length) payload.resources = resources;
        this._send(payload);
    }

    /** Обновляет потолок лоадаута без выхода/входа в комнату (без этого смена корабля/
     * экипировки/уровня ПОСЛЕ входа оставляла бы сервер с протухшим потолком урона —
     * см. Player.recomputeStats). Позиции/членство в комнате не трогает. */
    updateLoadout(loadout) {
        if (!this.sector) return;
        this._send({ type: 'pvp_update_loadout', loadout });
    }

    /** Throttled internally — safe to call every frame from GameScene.update().
     * waypointX/waypointY/speed (План Фаза 3.1) — курс/скорость, а не только текущая
     * точка: сервер хранит их в PvpPlayerState, чтобы на дисконнект было от чего
     * продолжать полёт офлайн-корабля (см. server OfflineShipManager). null-waypoint
     * (не летим никуда) — валидное значение, отправляем как есть. */
    sendPos(x, y, heading, dtMs, waypointX = null, waypointY = null, speed = 0) {
        if (!this.sector) return;
        this._posAccum += dtMs;
        if (this._posAccum < this._posIntervalMs) return;
        this._posAccum = 0;
        this._send({ type: 'pvp_pos', x, y, heading, waypointX, waypointY, speed });
    }

    /** dmg — реально посчитанный урон ЭТОГО выстрела (скилл-баффы/перки/патроны уже
     * применены, крит — нет, крит решает сервер своим роллом по loadout.critChance/
     * critMult). Сервер трактует dmg как заявку, зажатую потолком от loadout при входе
     * в комнату — не слепое доверие, но и не плоское число на весь визит в комнату. */
    fireClaim(targetUserId, weaponType, dmg) {
        if (!this.sector) return;
        this._send({ type: 'pvp_fire_claim', targetUserId, weaponType, dmg });
    }

    /** Активная способность (Аргус: pulsar/missiles, DEV key 8) бьёт другого ИГРОКА —
     * отдельно от fireClaim (см. server main.py pvp_ability_fire_claim): свой потолок
     * урона и свой per-ability кулдаун-флор, не общий гейт обычного оружия, который
     * душил бы почти все попадания (способность на порядок мощнее и тикает намного
     * чаще одиночного выстрела). ability — 'argus_pulsar' | 'argus_missile'. */
    abilityFireClaim(targetUserId, ability, dmg) {
        if (!this.sector) return;
        this._send({ type: 'pvp_ability_fire_claim', targetUserId, ability, dmg });
    }

    /** maxHull/maxShield — сервер лениво создаёт HP-запись мобa по этим значениям при
     * первом попадании кого угодно; mobX/mobY — для мягкой проверки дальности на сервере
     * (движение моба клиент-локальное, сервер не знает его позицию иначе); dmg — см. fireClaim.
     * wagonReward — ТОЛЬКО для вагонов бронепоезда (mobId вида "train:..."): детерминированный
     * (по ARMORED_TRAIN_SECTORS, одинаковый у всех атакующих) пул {credits,xp,gold,...} —
     * сервер использует его, только если ИМЕННО этот выстрел добивает вагон (см. main.py).
     * isDungeonBoss — ТОЛЬКО для данж-босса в группе (mobId вида "group:..."): сервер снимает
     * "фото" mob_state.damage_by в GroupManager ИМЕННО на килле этого флага (см. main.py
     * pvp_mob_fire_claim) — без него сплит награды деградирует до "только хил" (см. память
     * server_authoritative_mobs_status). */
    mobFireClaim(mobId, maxHull, maxShield, mobX, mobY, weaponType, dmg, wagonReward, isDungeonBoss) {
        if (!this.sector) return;
        const payload = { type: 'pvp_mob_fire_claim', mobId, maxHull, maxShield, mobX, mobY, weaponType, dmg };
        if (wagonReward) payload.wagonReward = wagonReward;
        if (isDungeonBoss) payload.isDungeonBoss = true;
        this._send(payload);
    }

    /** Активная способность (Аргус: pulsar/missiles) бьёт общего моба комнаты — турель/
     * вагон бронепоезда или обычный pvpMobId-моб (см. ArgusController._dealAbilityDamage).
     * Тот же протокол pvp_mob_fire_claim, что и обычное оружие по мобам, но с ability
     * вместо weaponType/mobX/mobY — сервер применяет ABILITY_DAMAGE_CEILING/COOLDOWN_FLOOR
     * вместо личного лоадаута атакующего (см. main.py). wagonReward — см. mobFireClaim. */
    abilityMobFireClaim(mobId, maxHull, maxShield, ability, dmg, wagonReward) {
        if (!this.sector) return;
        const payload = { type: 'pvp_mob_fire_claim', mobId, maxHull, maxShield, ability, dmg };
        if (wagonReward) payload.wagonReward = wagonReward;
        this._send(payload);
    }

    /** Урон мобу/турели → игроку целиком локально-авторитетен на клиенте ЖЕРТВЫ
     * (см. GameScene.fireMobWeapon — takeDamage прямо там, сервер не участвует), так что
     * без этого вызова остальные в комнате вообще не подозревали, что что-то произошло
     * (баг из диалога: "турель 1 бьёт игрока 1, игрок 2 не видит"). Чисто relay для VFX —
     * сервер подставит targetUserId сам (из сессии, не из тела), урон здесь не решается. */
    mobAttackVfx(mobId, weaponType) {
        if (!this.sector || !mobId) return;
        this._send({ type: 'pvp_mob_attack_vfx', mobId, weaponType });
    }

    /** Отправляется ЖЕРТВОЙ сразу после того, как её takeDamage реально применился (см.
     * GameScene.onProjectileHit) — отдельно от mobAttackVfx выше, потому что для не-хитскан
     * оружия (болт) момент попадания наступает ПОЗЖЕ момента выстрела (снаряд летит).
     * Несёт реальные цифры — сервер только ретранслирует. */
    mobAttackResult({ dodged = false, hullHit = 0, shieldHit = 0, hull, maxHull, shield, maxShield, killed = false, isCrit = false }) {
        if (!this.sector) return;
        this._send({ type: 'pvp_mob_attack_result', dodged, hullHit, shieldHit, hull, maxHull, shield, maxShield, killed, isCrit });
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

    /** Заявка на сбор общего депозита ресурса комнаты (см. server pvp_resource_claim) —
     * тот же паттерн, что claimLoot: не гранится локально сразу, ждём granted:true/false. */
    claimResource(resourceId) {
        if (!this.sector) return;
        this._send({ type: 'pvp_resource_claim', resourceId });
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

    /** Локальный ArmoredTrain закончился (все вагоны уничтожены ИЛИ истёк маршрутный
     * таймаут — см. ArmoredTrain._markFinished) — сервер чистит ArmoredTrainManager
     * (turret_kills/missile_ready_at/core_turret), иначе ракетный залп/поворотная турель
     * уже несуществующего поезда продолжали бы стрелять по игрокам сектора бесконечно
     * (баг из диалога: "урон после уничтожения поезда продолжает убивать игрока").
     * Идемпотентно на сервере — можно звать с любого клиента комнаты, независимо. */
    trainFinished(trainKey) {
        if (!this.sector) return;
        this._send({ type: 'pvp_train_finished', trainKey });
    }

    /** Нашествие расчищено (все мобы волны мертвы) — просим сервер разослать
     * пропорциональную награду по накопленному вкладу (server world_event_damage,
     * см. GameScene._updateWorldEvent). rewards — тот же детерминированный (по
     * WORLD_EVENT_SECTORS) объект у всех клиентов комнаты, кто бы первым ни заметил
     * расчистку — идемпотентно на сервере (pop), лишние заявки — молча no-op. */
    worldEventClearClaim(weKey, rewards) {
        if (!this.sector) return;
        this._send({ type: 'pvp_world_event_clear_claim', weKey, rewards });
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

    /** Регистрирует дрона/турель как ServerMob для сервер-авторитетного таргетинга
     * (см. server _tick_room, План Фаза 2+) — идемпотентно на сервере, можно звать с
     * любого клиента, кто первым увидел детерминированный спавн этого mobId.
     * ownerCorp — ТОЛЬКО для турелей добывающих баз (см. MiningBase._updateTurrets):
     * сервер фильтрует кандидатов на таргетинг, исключая игроков ЭТОГО корпуса (база не
     * атакует своих). Без ownerCorp (дроны/турели поезда — нейтральная угроза) — любой
     * игрок комнаты валиден. Можно звать повторно с новым ownerCorp при смене владельца
     * базы — сервер обновит фильтр на месте (см. ServerMobManager.spawn). */
    registerMob(mobId, ownerCorp) {
        if (!this.sector) return;
        const payload = { type: 'pvp_mob_register', mobId };
        if (ownerCorp) payload.ownerCorp = ownerCorp;
        this._send(payload);
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
                // Общая раскладка депозитов ресурса комнаты (см. GameScene._pendingResourceProposal
                // выше и server get_or_create_resources) — приходит и первому клиенту комнаты
                // (его же раскладка, эхом), и всем последующим (уже сохранённая раскладка).
                if (msg.resources) this.scene._applyPvpResourcesSnapshot?.(msg.resources);
                break;

            case 'pvp_player_joined':
                // План Фаза 3.1: дисконнект больше не шлёт pvp_player_left (см. server
                // OfflineShipManager) — RemotePlayer у остальных клиентов НЕ деспавнится,
                // так что при реконнекте userId уже известен здесь. Раньше это молча
                // игнорировало сообщение — свежий hull/shield/maxHull/maxShield реконнекта
                // (уже пересчитанные клиентом через Фазу 2 catch-up) терялись, у остальных
                // полоска HP реконнектнувшегося игрока замирала на значении ДО дисконнекта
                // до следующего pvp_hit_result. Теперь обновляем существующего, а не молчим.
                if (msg.player) {
                    const existing = this.players.get(msg.player.userId);
                    if (existing) {
                        existing.applyState(msg.player);
                        existing.applyPublicState(msg.player); // corp/level/shipKey тоже могли смениться, пока был офлайн
                    } else {
                        this._spawn(msg.player);
                    }
                }
                break;

            case 'pvp_player_left':
                this._despawn(msg.userId);
                break;

            case 'pvp_pos_update': {
                const rp = this.players.get(msg.userId);
                rp?.applyPos(msg.x, msg.y, msg.heading);
                break;
            }

            // План Фаза 3.1: позиция офлайн-корабля (владелец отключён, сервер продолжает
            // тикать его курс, см. server _offline_ship_tick_loop) — тот же RemotePlayer,
            // тот же applyPos, просто источник координат сменился с pvp_pos_update на
            // это; клиенту не нужно знать/различать, что владелец сейчас не в сети.
            case 'pvp_offline_ship_update':
                for (const s of msg.ships ?? []) {
                    this.players.get(s.userId)?.applyPos(s.x, s.y, s.heading);
                }
                break;

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

            case 'pvp_train_weapon_fire':
                this.onTrainWeaponFire?.(msg);
                break;

            case 'pvp_world_event_reward':
                this.onWorldEventReward?.(msg);
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

            case 'pvp_resource_result':
                this.onResourceResult?.(msg);
                break;

            case 'pvp_resource_collected':
                this.onResourceCollected?.(msg.resourceId);
                break;

            case 'pvp_resource_respawned':
                this.onResourceRespawned?.(msg);
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

            case 'pvp_mob_room_update':
                this.onMobRoomUpdate?.(msg);
                break;

            case 'pvp_mob_attack_vfx':
                this.onMobAttackVfx?.(msg);
                break;

            case 'pvp_mob_attack_result':
                this.onMobAttackResult?.(msg);
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
