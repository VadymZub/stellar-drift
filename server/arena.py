import random
import time

# ── Арена: очередь + стейт матча ────────────────────────────────────────
# In-memory, как GroupManager/PvpRoomManager в main.py — то же принятое в
# проекте допущение "один воркер, не переживает перезапуск". Отдельный модуль
# (а не классы внутри main.py, как GroupManager/PvpRoomManager) — потому что
# это ощутимый по объёму, самодостаточный кусок стейта без пересечений с
# чатом/друзьями/почтой; тот же принцип, что уже даёт отдельные auth.py/
# mailer.py/database.py в этом проекте.
#
# Арена принципиально НЕ по корпорациям (см. main.py pvp_fire_claim — арена
# единственное место, где дружественный огонь разрешён между игроками одной
# корпорации). Команда матча — 'a'/'b', назначается здесь, никак не связана с
# PvpPlayerState.corp.

ARENA_MATCH_MS         = 600_000    # 10 мин — общий дедлайн матча
ARENA_POINTS_HOLD_MS   = 300_000    # захват+удержание всех 3 точек 5 мин = победа
ARENA_FLAG_SCORE       = 5
ARENA_CARGO_SCORE      = 3
ARENA_CARGO_RESPAWN_SEC = 5.0  # пауза после доставки, прежде чем груз снова появится в центре
# Упавший (не у врага) флаг — авто-возврат на базу. Свой игрок коснулся — 3с до
# "прыжка" домой; никто не тронул — общий failsafe-таймаут 15с (см. диалог: "враг
# подбирает — несёт дальше, свой подбирает — 3 сек и флаг перескакивает на базу,
# никто не подбирает — 15 сек и тоже возвращается").
ARENA_FLAG_TOUCH_RETURN_SEC = 3.0
ARENA_FLAG_DROP_TIMEOUT_SEC = 15.0
ARENA_DUEL_ROUNDS_TO_WIN = 2  # до 2 побед из 3 раундов (см. диалог: "должно быть 3 боя")
# Только 3на3 (не дуэль, см. диалог: "ещё добавь условие для 3на3") — если команда
# вышла в первые 3 минуты матча, победа не присуждается никому, даже при перевесе в
# счёте — слишком рано, чтобы перевес был показательным (одна ранняя доставка/точка
# на 10-минутный матч не должна решать исход добровольного выхода соперника).
ARENA_EARLY_LEAVE_VOID_SEC = 180.0
ARENA_RESPAWN_MS       = 5_000
ARENA_POINT_DECAY_MS   = 30_000     # точка без атаки 30с — откат к цвету защитника
ARENA_OFFLINE_ABORT_MS = 120_000    # >2 мин офлайн — матч void
ARENA_LEVEL_SPREAD     = 5          # max(level) - min(level) по всем участникам матча
ARENA_BASE_SAFE_R      = 650.0 / 3.0  # px — уменьшено втрое (см. диалог: "круг базы и
# круг для флага - уменьшить каждый в 3 раза по радиусу"); ARENA_CAPTURE_R ниже
# считается ОТ этого значения (тоже /3), так что каскадом уменьшается и он — оба
# круга нужного размера одним изменением, без рассинхрона формул.
ARENA_TEAM_SIZE = {'flag': 3, 'points': 3, 'cargo': 3, 'duel': 1}
ARENA_POINT_IDS = ('A', 'B', 'C')
ARENA_POINT_MAX_DURABILITY = 100.0
ARENA_POINT_DURABILITY_PER_CLAIM = 20.0   # ~5 заявок/сек макс (см. ARENA_POINT_CLAIM_COOLDOWN) на полный захват
ARENA_PICKUP_R = 180.0     # px — дальность поднятия флага/груза с земли
# Раньше донести = попасть в тот же (большой) радиус, что safe zone — фактически
# "залетел куда-то в район базы" засчитывалось как захват, без точности. Теперь —
# отдельная, втрое меньшая точка-мишень в центре базы (см. диалог: "радиус базы
# уменьшить втрое, в центре небольшой кружок — именно туда нужно долететь, чтобы
# поставить вражеский флаг"); safe zone (ARENA_BASE_SAFE_R, неатакуемость) не трогаем.
ARENA_CAPTURE_R = ARENA_BASE_SAFE_R / 3.0
ARENA_POINT_R = 220.0      # px — дальность "заявки" на точку (arena_point_claim)
ARENA_POINT_CLAIM_COOLDOWN = 0.4  # сек — сервер не доверяет клиентской частоте заявок
# Лабиринт арены — несколько вариантов геометрии на 3на3-режим (см. client
# arenaLayouts.js), случайный выбор НА МАТЧ (см. диалог: "все берём, выбор — рандом"),
# не по дню, как у данжей (арену переигрывают куда чаще одного данжа в день). Сервер
# просто кидает кубик и рассылает индекс в arena_match_found — сам не знает геометрию
# стен (та целиком клиентские данные), обеим сторонам матча достаётся ОДИН и тот же
# индекс, иначе столкновения разъехались бы у двух игроков одной комнаты.
ARENA_MAZE_VARIANTS = 3


class ArenaMatch:
    """Один живой матч арены. Objective-состояние зависит от mode (flag/points/cargo/duel)."""

    def __init__(self, match_id: str, mode: str, sector_key: str,
                 team_a: list[int], team_b: list[int],
                 spawn_a: tuple[float, float], spawn_b: tuple[float, float]):
        self.match_id   = match_id
        self.room_key   = f"arena:{match_id}"
        self.mode       = mode
        self.sector_key = sector_key
        self.teams: dict[str, list[int]] = {'a': list(team_a), 'b': list(team_b)}
        self.team_of: dict[int, str] = {}
        for uid in team_a:
            self.team_of[uid] = 'a'
        for uid in team_b:
            self.team_of[uid] = 'b'
        self.spawns: dict[str, tuple[float, float]] = {'a': spawn_a, 'b': spawn_b}
        # Один бросок на весь матч (см. ARENA_MAZE_VARIANTS выше) — не используется в
        # duel (arenaMaze:false, нет стен вовсе), но безобидно посчитать и для неё.
        self.maze_variant = random.randint(0, ARENA_MAZE_VARIANTS - 1)
        self.scores: dict[str, int] = {'a': 0, 'b': 0}
        self.start_at = time.time()
        self.deadline = self.start_at + ARENA_MATCH_MS / 1000.0
        self.connected: dict[int, bool] = {uid: True for uid in (*team_a, *team_b)}
        self.disconnected_at: dict[int, float] = {}
        self.respawn_at: dict[int, float] = {}
        self.last_point_claim: dict[int, float] = {}  # uid → time.time(), anti-spam для arena_point_claim
        self.outcome: str | None = None       # 'win_a' | 'win_b' | 'draw' | 'void'
        self.claimed: set[int] = set()         # кто уже вызвал /arena/match-complete — дедуп

        # ── objective-состояние по режиму ──────────────────────────────
        self.flags: dict[str, dict] | None = None
        self.cargo: dict | None = None
        self.points: dict[str, dict] | None = None
        self.hold_started_at: float | None = None
        self.owned_seconds: dict[str, float] = {'a': 0.0, 'b': 0.0}
        self._last_tick_at = self.start_at

        if mode == 'flag':
            self.flags = {
                'a': {'at_base': True, 'carrier': None, 'x': spawn_a[0], 'y': spawn_a[1], 'auto_return_at': None},
                'b': {'at_base': True, 'carrier': None, 'x': spawn_b[0], 'y': spawn_b[1], 'auto_return_at': None},
            }
        elif mode == 'cargo':
            # available=False на время между доставкой и следующим появлением через
            # ARENA_CARGO_RESPAWN_SEC (см. диалог: "через 5 сек он должен вернуться на
            # место респавна") — next_spawn_at раньше выставлялся, но нигде не читался
            # (доставка мгновенно возвращала груз в центр без задержки).
            self.cargo = {'spawned_at': self.start_at, 'carrier': None, 'x': 0.0, 'y': 0.0,
                           'next_spawn_at': self.start_at, 'available': True}
        elif mode == 'points':
            self.points = {
                pid: {'owner': 'neutral', 'durability': ARENA_POINT_MAX_DURABILITY,
                      'attacker': None, 'last_attacked_at': 0.0}
                for pid in ARENA_POINT_IDS
            }

    # ── очки/победа ──────────────────────────────────────────────────────
    def add_score(self, team: str):
        self.scores[team] = self.scores.get(team, 0) + 1

    def _score_target(self) -> int | None:
        if self.mode == 'flag':
            return ARENA_FLAG_SCORE
        if self.mode == 'cargo':
            return ARENA_CARGO_SCORE
        return None

    def all_points_held(self) -> str | None:
        if self.mode != 'points' or not self.points:
            return None
        owners = {p['owner'] for p in self.points.values()}
        if len(owners) == 1 and 'neutral' not in owners:
            return next(iter(owners))
        return None

    def has_advantage(self, team: str) -> bool:
        """Строгое преимущество team ПРЯМО СЕЙЧАС — для форфита при добровольном
        выходе соперника (см. main.py pvp_leave, диалог: "если ни одного флага/груза/
        точки не захвачено — победу не присуждать, просто выйти", "для победы должно
        быть преимущество"). flag/cargo/duel — общий self.scores (захваты/доставки/
        раунды); points туда НИКОГДА не пишет (self._score_target() возвращает None
        для points, победа там решается по all_points_held/owned_seconds, не по
        scores) — считаем отдельно, сколько точек команда держит ПРЯМО СЕЙЧАС."""
        other = 'b' if team == 'a' else 'a'
        if self.mode == 'points' and self.points:
            mine   = sum(1 for p in self.points.values() if p['owner'] == team)
            theirs = sum(1 for p in self.points.values() if p['owner'] == other)
            return mine > theirs
        return self.scores.get(team, 0) > self.scores.get(other, 0)

    def outcome_for(self, uid: int) -> str:
        """Нормализует self.outcome в 'win'|'lose'|'draw'|'void' для конкретного игрока."""
        if self.outcome is None:
            return 'void'
        if self.outcome == 'void':
            return 'void'
        if self.outcome == 'draw':
            return 'draw'
        team = self.team_of.get(uid)
        won_team = self.outcome[len('win_'):]  # 'win_a' → 'a'
        return 'win' if team == won_team else 'lose'

    def check_win(self, now: float) -> str | None:
        """Возвращает 'win_a'|'win_b'|'draw' если матч должен закончиться победой/ничьей
        прямо сейчас (кроме дедлайна — тот проверяется отдельно вызывающим, т.к. тайбрейк
        отличается по режиму)."""
        target = self._score_target()
        if target is not None:
            if self.scores['a'] >= target:
                return 'win_a'
            if self.scores['b'] >= target:
                return 'win_b'
        if self.mode == 'points':
            holder = self.all_points_held()
            if holder:
                if self.hold_started_at is None:
                    self.hold_started_at = now
                elif now - self.hold_started_at >= ARENA_POINTS_HOLD_MS / 1000.0:
                    return f'win_{holder}'
            else:
                self.hold_started_at = None
        return None

    def deadline_outcome(self) -> str:
        """Тайбрейк по истечении 10 мин — вызывать только когда now >= self.deadline."""
        target = self._score_target()
        if target is not None:
            if self.scores['a'] == self.scores['b']:
                return 'draw'
            return 'win_a' if self.scores['a'] > self.scores['b'] else 'win_b'
        if self.mode == 'points':
            if self.owned_seconds['a'] == self.owned_seconds['b']:
                return 'draw'
            return 'win_a' if self.owned_seconds['a'] > self.owned_seconds['b'] else 'win_b'
        if self.mode == 'duel':
            # До 2 побед из 3 обычно решается раньше в _arena_on_kill — это только
            # safety-net на 10-минутный дедлайн (напр. затянувшийся счёт 1:1).
            if self.scores['a'] == self.scores['b']:
                return 'draw'
            return 'win_a' if self.scores['a'] > self.scores['b'] else 'win_b'
        return 'draw'

    # ── тик — ТОЛЬКО абсолютные таймстемпы, никаких per-frame накоплений ──
    def tick(self, now: float):
        dt = max(0.0, now - self._last_tick_at)
        self._last_tick_at = now
        if self.mode == 'points' and self.points:
            for p in self.points.values():
                if p['owner'] != 'neutral' and now - p['last_attacked_at'] > ARENA_POINT_DECAY_MS / 1000.0:
                    p['attacker'] = None  # откат "тянущегося" кольца к цвету владельца
            for team in ('a', 'b'):
                if all(p['owner'] == team for p in self.points.values()):
                    self.owned_seconds[team] += dt
                elif any(p['owner'] == team for p in self.points.values()):
                    owned_by_team = sum(1 for p in self.points.values() if p['owner'] == team)
                    self.owned_seconds[team] += dt * (owned_by_team / len(self.points))


class ArenaQueueManager:
    """Очередь по режимам. 3на3 — записи это ГРУППЫ (member_uids уже полный состав
    команды), 1на1 — записи это одиночные игроки. Пара ищется FIFO, первая
    совместимая по ARENA_LEVEL_SPREAD."""

    def __init__(self):
        self.waiting: dict[str, list[dict]] = {m: [] for m in ARENA_TEAM_SIZE}
        self.player_queue: dict[int, str] = {}  # uid → mode, для leave-on-disconnect

    def enqueue(self, mode: str, leader_uid: int, member_uids: list[int], levels: list[int]) -> dict | None:
        entry = {'leader_uid': leader_uid, 'member_uids': list(member_uids),
                  'levels': list(levels), 'queued_at': time.time()}
        bucket = self.waiting[mode]
        for i, other in enumerate(bucket):
            all_levels = other['levels'] + entry['levels']
            if max(all_levels) - min(all_levels) <= ARENA_LEVEL_SPREAD:
                bucket.pop(i)
                for uid in other['member_uids']:
                    self.player_queue.pop(uid, None)
                for uid in entry['member_uids']:
                    self.player_queue.pop(uid, None)
                return {'a': other, 'b': entry}
        bucket.append(entry)
        for uid in entry['member_uids']:
            self.player_queue[uid] = mode
        return None

    def dequeue(self, uid: int):
        mode = self.player_queue.pop(uid, None)
        if not mode:
            return
        bucket = self.waiting[mode]
        for i, entry in enumerate(bucket):
            if uid in entry['member_uids']:
                for m in entry['member_uids']:
                    self.player_queue.pop(m, None)
                bucket.pop(i)
                return

    def waiting_count(self, mode: str) -> int:
        return len(self.waiting.get(mode, []))


class ArenaMatchManager:
    def __init__(self):
        self.matches: dict[str, ArenaMatch] = {}       # room_key → ArenaMatch
        self.player_match: dict[int, str] = {}         # uid → room_key

    def create(self, match: ArenaMatch):
        self.matches[match.room_key] = match
        for uid in match.team_of:
            self.player_match[uid] = match.room_key

    def get_by_uid(self, uid: int) -> ArenaMatch | None:
        room_key = self.player_match.get(uid)
        return self.matches.get(room_key) if room_key else None

    def end(self, room_key: str, outcome: str):
        m = self.matches.get(room_key)
        if not m or m.outcome:
            return
        m.outcome = outcome

    def cleanup_ended(self, now: float, grace_sec: float = 60.0):
        """Убирает завершённые матчи из памяти спустя grace-период (чтобы поздние
        /arena/match-complete запросы ещё успели найти матч и провалидировать outcome)."""
        for room_key, m in list(self.matches.items()):
            if m.outcome and now - m.deadline > grace_sec:
                for uid in list(m.team_of.keys()):
                    if self.player_match.get(uid) == room_key:
                        self.player_match.pop(uid, None)
                self.matches.pop(room_key, None)

    def on_disconnect(self, uid: int, now: float):
        m = self.get_by_uid(uid)
        if not m or m.outcome:
            return
        m.connected[uid] = False
        m.disconnected_at[uid] = now

    def on_reconnect(self, uid: int):
        m = self.get_by_uid(uid)
        if not m:
            return
        m.connected[uid] = True
        m.disconnected_at.pop(uid, None)
