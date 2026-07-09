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
    }

    // ── Outgoing ─────────────────────────────────────────────────────────────

    enterSector(sector, x, y, loadout) {
        this.leaveSector();
        this.sector = sector;
        this._send({ type: 'pvp_enter', sector, x, y, loadout });
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
     * (движение моба клиент-локальное, сервер не знает его позицию иначе); dmg — см. fireClaim. */
    mobFireClaim(mobId, maxHull, maxShield, mobX, mobY, weaponType, dmg) {
        if (!this.sector) return;
        this._send({ type: 'pvp_mob_fire_claim', mobId, maxHull, maxShield, mobX, mobY, weaponType, dmg });
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

    leaveSector() {
        if (!this.sector) return;
        this._send({ type: 'pvp_leave' });
        this.sector = null;
        this._clearAll();
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

            case 'pvp_hit_result':
                this.onHitResult?.(msg);
                break;

            case 'pvp_mob_hit_result':
                this.onMobHitResult?.(msg);
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
        }
    }

    // ── Per-frame ─────────────────────────────────────────────────────────────

    update(dt) {
        for (const rp of this.players.values()) rp.update(dt);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _spawn(data) {
        // Красный (враждебный) только в реальном PvP-секторе — на остальных realtime-
        // картах (домашняя/PvE/групповой данж) другие игроки союзники, красить в
        // "враг" некорректно (и атаковать их нельзя, см. GameScene._isPvpSector).
        const isHostile = !!this.scene._isPvpSector;
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
