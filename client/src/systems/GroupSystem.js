/**
 * GroupSystem — client-side group management.
 * Communicates over the existing /ws/chat WebSocket.
 *
 * Usage (from GameScene):
 *   this.group = new GroupSystem(this, wsRef);
 *   this.group.onUpdate = (members) => { ... refresh HUD ... };
 *
 * The WS reference must already be open. GroupSystem does NOT own the socket.
 */
export class GroupSystem {
    constructor(scene, ws) {
        this.scene     = scene;
        this.ws        = ws;
        this.instanceId = null;
        this.members    = [];   // string[] — usernames
        this.isSolo     = false;

        // Callbacks — assign from HudScene._connectChatWS
        this.onUpdate       = null;   // (members: string[]) => void
        this.onGoldReward   = null;   // (gold: number, credits: number, xp: number) => void
        this.onBossHp       = null;   // (ratio: number) => void
        this.onInvite       = null;   // ({from, dungeon}) => void
        this.onError        = null;   // (text: string) => void
        this.onMemberDamage  = null;   // (amount: number) => void  — leader receives member damage
        this.onBossKilled    = null;   // () => void                — non-leader: main ghost boss died
        this.onMobDied       = null;   // (id: number) => void      — non-leader: ghost escort/miniboss died

        // Friend callbacks
        this.onFriendList    = null;   // (friends: Array<{name,status,dir,online,sector}>) => void
        this.onFriendUpdate  = null;   // ({name, online, sector?}) => void
        this.onFriendRequest = null;   // ({from: string}) => void
    }

    // ── Outgoing ─────────────────────────────────────────────────────────────

    /** Create solo instance or group instance (as leader). */
    create(dungeonKey, solo = false) {
        this.isSolo = solo;
        this._send({ type: 'group_create', dungeon: dungeonKey, solo });
    }

    invite(toName, dungeonKey) {
        this._send({ type: 'group_invite', to: toName, dungeon: dungeonKey });
    }

    join(leaderName) {
        this._send({ type: 'group_join', leader: leaderName });
    }

    leave() {
        this._send({ type: 'group_leave' });
        this._reset();
    }

    recordDamage(amount) {
        if (!this.instanceId) return;
        this._send({ type: 'group_damage', amount });
    }

    recordHeal(amount) {
        if (!this.instanceId) return;
        this._send({ type: 'group_heal', amount });
    }

    /** Called by leader (or any member — whoever's local ghost/real boss dies first)
     * when the boss dies. baseGold/baseCredits/baseXp = full solo-equivalent reward,
     * server splits all three by the SAME damage+heal ratio (GroupManager.boss_died). */
    bossKilled(baseGold, baseCredits = 0, baseXp = 0) {
        if (!this.instanceId) return;
        this._send({ type: 'group_boss_dead', baseGold, baseCredits, baseXp });
    }

    /** Called by leader when an escort/miniboss dies. id = _groupMobId. */
    sendMobDied(id) {
        if (!this.instanceId) return;
        this._send({ type: 'group_mob_died', id });
    }

    /** Broadcast current boss HP ratio to group members. */
    syncBossHp(ratio) {
        if (!this.instanceId || this.members.length <= 1) return;
        this._send({ type: 'group_boss_hp', ratio });
    }

    /** Inform server of current sector (for friends online status). */
    sectorUpdate(sector) {
        this._send({ type: 'sector_update', sector });
    }

    // ── Friends ───────────────────────────────────────────────────────────────

    friendAdd(name)     { this._send({ type: 'friend_add',     to:   name }); }
    friendAccept(name)  { this._send({ type: 'friend_accept',  from: name }); }
    friendDecline(name) { this._send({ type: 'friend_decline', from: name }); }
    friendRemove(name)  { this._send({ type: 'friend_remove',  name       }); }

    // ── Incoming (call from WS onmessage handler in GameScene) ───────────────

    handleMessage(msg) {
        switch (msg.type) {
            case 'group_created':
                this.instanceId = msg.instanceId;
                this.members    = msg.members ?? [];
                this.onUpdate?.(this.members);
                break;

            case 'group_joined':
                this.instanceId = msg.instanceId;
                this.members    = msg.members ?? [];
                this.onUpdate?.(this.members);
                break;

            case 'group_member_joined':
                if (!this.members.includes(msg.name)) this.members.push(msg.name);
                this.onUpdate?.(this.members);
                break;

            case 'group_member_left':
                this.members = this.members.filter(n => n !== msg.name);
                this.onUpdate?.(this.members);
                break;

            case 'group_left':
                this._reset();
                this.onUpdate?.([]);
                break;

            case 'group_gold_reward':
                this.onGoldReward?.(msg.gold, msg.credits ?? 0, msg.xp ?? 0);
                break;

            case 'group_boss_hp':
                this.onBossHp?.(msg.ratio);
                break;

            case 'group_member_damage':
                this.onMemberDamage?.(msg.amount);
                break;

            case 'group_boss_killed':
                this.onBossKilled?.();
                break;

            case 'group_mob_died':
                this.onMobDied?.(msg.id);
                break;

            case 'friend_list':
                this.onFriendList?.(msg.friends ?? []);
                break;

            case 'friend_online':
                this.onFriendUpdate?.({ name: msg.name, online: true, sector: msg.sector ?? '' });
                break;

            case 'friend_offline':
                this.onFriendUpdate?.({ name: msg.name, online: false });
                break;

            case 'friend_request_in':
                this.onFriendRequest?.({ from: msg.from });
                break;

            case 'group_invite':
                this.onInvite?.({ from: msg.from, dungeon: msg.dungeon });
                break;

            case 'group_error':
                this.onError?.(msg.text);
                break;
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    get inGroup()    { return !!this.instanceId; }
    get memberCount(){ return this.members.length; }
    get isLeader()   { return this.members[0] === this.scene.playerName; }

    /** Returns true if this player can add more members (group not solo-locked). */
    canAddMembers()  { return this.instanceId && !this.isSolo && this.memberCount < 8; }

    _send(obj) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
        }
    }

    _reset() {
        this.instanceId = null;
        this.members    = [];
        this.isSolo     = false;
    }
}
