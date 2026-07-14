"""Смешанный игровой нагрузочный тест: имитирует реалистичный срез беты —
N групп по group_size игроков фармят данж-мобов (+ периодически валят
босса группой, проверяя сплит награды из Фазы 4), плюс M соло-игроков,
которые просто на связи и изредка пишут в чат (соло-данж клиент-локален —
сервер их вообще не видит в боевом плане, только соединение/чат/иногда
позиция). Все боты периодически шлют сообщения в общий чат — нагружает
ChatMessage-запись в БД (main.py: msg_type == 'msg' коммитит в SQLite на
КАЖДОЕ сообщение), не только WS-фан-аут.

Установка (как и у loadtest.py):
    pip install websockets requests

Запуск:
    python loadtest_mixed.py --groups 16 --group-size 5 --solo 20 --duration 90
    python loadtest_mixed.py --groups 16 --group-size 5 --solo 20 --duration 90 --url https://ваш-сервис.onrender.com
"""
import argparse
import asyncio
import json
import random
import time
import uuid

import requests
import websockets

CHAT_LINES = [
    'кто в группу?', 'лут неплохой', 'го дальше', 'осторожно засада',
    'фарм в процессе', 'у кого есть аптечки?', 'красиво зашли', 'ещё раунд',
]


def register_clients(base_url, names, run_id):
    accounts = []
    t0 = time.monotonic()
    for i, name in enumerate(names):
        username = f'{name}_{run_id}'
        r = requests.post(f'{base_url}/auth/register', json={
            'username': username, 'password': 'loadtest123',
        }, timeout=15)
        if r.status_code != 200:
            print(f'  ! регистрация {username} провалилась: {r.status_code} {r.text[:200]}')
            continue
        accounts.append((username, r.json()['access_token']))
        if (i + 1) % 20 == 0:
            print(f'  зарегистрировано {i + 1}/{len(names)}...')
    print(f'Регистрация: {len(accounts)}/{len(names)} за {time.monotonic() - t0:.1f}с')
    return accounts


class Stats:
    def __init__(self):
        self.connected = 0
        self.connect_failed = 0
        self.disconnected_early = 0
        self.sent = 0
        self.received = 0
        self.errors = 0
        self.error_samples = []
        self.fires_sent = 0
        self.mobs_killed = 0
        self.chat_sent = 0
        self.boss_kills_attempted = 0
        self.boss_reward_msgs = 0
        self.group_join_failed = 0


async def solo_bot(ws_url, username, token, duration, ramp_delay, stats: Stats):
    """Соло-игрок: просто на связи, изредка чат — соло-данж клиент-локален,
    сервер тут не участвует в бою вообще (см. память server_authoritative_mobs_status:
    solo dungeons НЕ ТРОГАЕМ), так что для сервера это чистая нагрузка на
    соединение + редкие сообщения, без pvp_enter/mob-траффика."""
    if ramp_delay:
        await asyncio.sleep(ramp_delay)
    url = f'{ws_url}/ws/chat?token={token}'
    connected_ok = False
    try:
        async with websockets.connect(url, open_timeout=15, close_timeout=5) as ws:
            connected_ok = True
            stats.connected += 1

            async def reader():
                try:
                    async for raw in ws:
                        stats.received += 1
                except Exception:
                    pass
            reader_task = asyncio.create_task(reader())

            end_at = time.monotonic() + duration
            while time.monotonic() < end_at:
                if random.random() < 0.3:
                    await ws.send(json.dumps({'type': 'msg', 'channel': 'general', 'text': random.choice(CHAT_LINES)}))
                    stats.sent += 1
                    stats.chat_sent += 1
                await asyncio.sleep(random.uniform(4, 9))
            reader_task.cancel()
    except Exception as e:
        if connected_ok:
            stats.disconnected_early += 1
        else:
            stats.connect_failed += 1
        stats.errors += 1
        if len(stats.error_samples) < 8:
            stats.error_samples.append(f'{username}: {type(e).__name__}: {e}')


async def group_bot(ws_url, group_id, is_leader, leader_username, username, token,
                     dungeon_key, duration, ramp_delay, stats: Stats):
    """Один участник группового данжа: если лидер — создаёт группу и данж-сектор
    (group:<instanceId>), остальные — джойнятся. Дальше все `duration` секунд
    фармят серию мелких мобов (реалистичный кулдаун фарма — не молотят один
    мертвый mob_id) плюс раз где-то в середине теста группой валят "босса"
    (isDungeonBoss=True) и проверяют, что реально пришла доля награды —
    нагружает именно тот путь, что чинился в Фазе 4 (см. main.py
    pvp_mob_fire_claim/group_boss_dead), не только позиционный трафик."""
    if ramp_delay:
        await asyncio.sleep(ramp_delay)
    url = f'{ws_url}/ws/chat?token={token}'
    connected_ok = False
    try:
        async with websockets.connect(url, open_timeout=15, close_timeout=5) as ws:
            connected_ok = True
            stats.connected += 1
            reward_events = []
            # Единственный читатель сокета на всё время соединения — раньше здесь
            # ОДНОВРЕМЕННО был фоновый reader() (async for raw in ws) И отдельные прямые
            # ws.recv() внутри wait_for_type для group_created/group_joined; оба
            # конкурировали за один и тот же входящий поток сообщений библиотеки
            # websockets, из-за чего group_created иногда доставался фоновому reader'у,
            # а wait_for_type зависал навсегда в ожидании сообщения, которое уже никогда
            # не придёт повторно. Теперь ВСЁ разбирается в одном месте через asyncio.Event.
            group_created_evt = asyncio.Event()
            group_joined_evt = asyncio.Event()
            state = {'instanceId': None, 'joinError': None}

            async def reader():
                try:
                    async for raw in ws:
                        stats.received += 1
                        try:
                            msg = json.loads(raw)
                        except ValueError:
                            continue
                        mtype = msg.get('type')
                        if mtype == 'group_created':
                            state['instanceId'] = msg.get('instanceId')
                            group_created_evt.set()
                        elif mtype == 'group_joined':
                            state['instanceId'] = msg.get('instanceId')
                            group_joined_evt.set()
                        elif mtype == 'group_error':
                            state['joinError'] = msg.get('text')
                            group_created_evt.set()
                            group_joined_evt.set()
                        elif mtype == 'group_gold_reward':
                            reward_events.append(msg)
                except Exception:
                    pass
            reader_task = asyncio.create_task(reader())
            await asyncio.sleep(0.1)

            if is_leader:
                await ws.send(json.dumps({'type': 'group_create', 'dungeon': dungeon_key, 'solo': False}))
                await asyncio.wait_for(group_created_evt.wait(), timeout=10)
                instance_id = state['instanceId']
                group_id['instanceId'] = instance_id
                group_id['ready'].set()
            else:
                await group_id['ready'].wait()
                instance_id = group_id['instanceId']
                await ws.send(json.dumps({'type': 'group_join', 'leader': leader_username}))
                await asyncio.wait_for(group_joined_evt.wait(), timeout=10)
                if state['joinError']:
                    stats.group_join_failed += 1
                    reader_task.cancel()
                    return

            sector = f'group:{instance_id}'
            loadout = {
                'dmg': 100, 'range': 999999, 'cooldown': 0.2, 'penetration': 0.2,
                'evasion': 0.0, 'critChance': 0.1, 'critMult': 2.0,
                'shipKey': 'wisp', 'corp': 'neutral', 'level': 30, 'maxHull': 2000, 'maxShield': 800,
            }
            await ws.send(json.dumps({'type': 'pvp_enter', 'sector': sector, 'x': 0, 'y': 0, 'loadout': loadout}))
            await asyncio.sleep(0.3)

            end_at = time.monotonic() + duration
            boss_done = False
            boss_at = time.monotonic() + duration * random.uniform(0.4, 0.6)
            mob_idx = 0
            mob_hull_left = 400  # ~4 выстрелов на моба — реалистичный темп фарма мелочи

            while time.monotonic() < end_at:
                if not boss_done and time.monotonic() >= boss_at:
                    # Групповой босс: все "участники" синхронно бьют один и тот же
                    # mob_id с isDungeonBoss=True, лидер шлёт group_boss_dead —
                    # эмулирует реальный клиентский путь (GameScene.onMobKilled).
                    boss_mob_id = f'{sector}:boss'
                    dmg = random.choice([90, 100, 110])
                    await ws.send(json.dumps({
                        'type': 'pvp_mob_fire_claim', 'mobId': boss_mob_id,
                        'maxHull': 100000, 'maxShield': 0, 'mobX': 0, 'mobY': 0,
                        'weaponType': 'cannon', 'dmg': dmg, 'isDungeonBoss': True,
                    }))
                    stats.sent += 1
                    stats.fires_sent += 1
                    stats.boss_kills_attempted += 1
                    boss_done = True
                    await asyncio.sleep(0.25)
                    if is_leader:
                        # Даём остальным время нанести свою долю урона перед тем, как
                        # "заметить" килл — реалистичнее мгновенного соло-добива.
                        await asyncio.sleep(2.0)
                        await ws.send(json.dumps({
                            'type': 'group_boss_dead', 'baseGold': 50, 'baseCredits': 500, 'baseXp': 250,
                        }))
                        stats.sent += 1
                    continue

                # Обычный фарм: мелкие мобы, реалистичный кулдаун (>=0.2с — сервер
                # клэмпит любой заявленный ниже PVP_FIRE_COOLDOWN_FLOOR=0.15с и молча
                # дропает заявки внутри окна, см. память server_authoritative_mobs_status).
                dmg = random.choice([90, 100, 110])
                mob_id = f'{sector}:trash:{mob_idx}'
                await ws.send(json.dumps({
                    'type': 'pvp_mob_fire_claim', 'mobId': mob_id,
                    'maxHull': 400, 'maxShield': 0, 'mobX': 0, 'mobY': 0,
                    'weaponType': 'cannon', 'dmg': dmg,
                }))
                stats.sent += 1
                stats.fires_sent += 1
                mob_hull_left -= dmg
                if mob_hull_left <= 0:
                    mob_idx += 1
                    mob_hull_left = 400
                    stats.mobs_killed += 1

                if random.random() < 0.15:
                    await ws.send(json.dumps({'type': 'msg', 'channel': 'general', 'text': random.choice(CHAT_LINES)}))
                    stats.sent += 1
                    stats.chat_sent += 1

                await asyncio.sleep(random.uniform(0.25, 0.4))

            await asyncio.sleep(1.0)
            stats.boss_reward_msgs += len(reward_events)
            reader_task.cancel()
    except Exception as e:
        if connected_ok:
            stats.disconnected_early += 1
        else:
            stats.connect_failed += 1
        stats.errors += 1
        if len(stats.error_samples) < 8:
            stats.error_samples.append(f'{username}: {type(e).__name__}: {e}')


async def run(args):
    run_id = uuid.uuid4().hex[:8]
    n_group_players = args.groups * args.group_size
    print(f'== Смешанный нагрузочный тест: {args.groups} групп x {args.group_size} '
          f'({n_group_players} игроков) + {args.solo} соло, {args.duration}с ==')
    print(f'Цель: {args.url}')

    group_names = [f'ldgrp_{g}_{i}' for g in range(args.groups) for i in range(args.group_size)]
    solo_names = [f'ldsolo_{i}' for i in range(args.solo)]
    accounts = register_clients(args.url, group_names + solo_names, run_id)
    if not accounts:
        print('Не удалось зарегистрировать ни одного юзера — прерываю.')
        return
    by_name = dict(accounts)

    ws_url = args.url.replace('https://', 'wss://').replace('http://', 'ws://')
    stats = Stats()
    tasks = []
    ramp_ms = args.ramp_ms

    t = 0
    for g in range(args.groups):
        group_id = {'instanceId': None, 'ready': asyncio.Event()}
        leader_name = f'ldgrp_{g}_0_{run_id}'
        for i in range(args.group_size):
            name = f'ldgrp_{g}_{i}_{run_id}'
            if name not in by_name:
                continue
            tasks.append(group_bot(
                ws_url, group_id, i == 0, leader_name, name, by_name[name],
                args.dungeon, args.duration, t * ramp_ms / 1000.0, stats,
            ))
            t += 1
    for i in range(args.solo):
        name = f'ldsolo_{i}_{run_id}'
        if name not in by_name:
            continue
        tasks.append(solo_bot(ws_url, name, by_name[name], args.duration, t * ramp_ms / 1000.0, stats))
        t += 1

    print(f'Запускаю {len(tasks)} ботов (разброс старта {ramp_ms}мс/бот)...')
    t0 = time.monotonic()
    await asyncio.gather(*tasks, return_exceptions=True)
    elapsed = time.monotonic() - t0

    print()
    print('== Результат ==')
    print(f'Успешно подключились:    {stats.connected}/{len(tasks)}')
    print(f'Не удалось подключиться: {stats.connect_failed}')
    print(f'Оборвались раньше срока: {stats.disconnected_early}')
    print(f'Не удалось войти в группу: {stats.group_join_failed}')
    print(f'Сообщений отправлено: {stats.sent}, получено: {stats.received}')
    print(f'"Выстрелов" (fire_claim) отправлено: {stats.fires_sent}')
    print(f'Мобов "убито" (фарм-цикл): {stats.mobs_killed}')
    print(f'Групповых боссов атаковано: {stats.boss_kills_attempted}, наград получено: {stats.boss_reward_msgs} '
          f'(ожидается по 1 на каждого живого участника каждой успешной группы)')
    print(f'Сообщений в чат отправлено: {stats.chat_sent}')
    print(f'Всего ошибок: {stats.errors}')
    if stats.error_samples:
        print('Примеры ошибок:')
        for s in stats.error_samples:
            print(f'  - {s}')
    print(f'Тест занял: {elapsed:.1f}с (ожидалось ~{args.duration + ramp_ms * len(tasks) / 1000.0:.0f}с с учётом разброса старта)')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--groups', type=int, default=16, help='Кол-во групп')
    p.add_argument('--group-size', type=int, dest='group_size', default=5, help='Игроков в группе')
    p.add_argument('--solo', type=int, default=20, help='Кол-во соло-игроков (просто на связи + чат)')
    p.add_argument('--dungeon', default='dungeon_1', help='Ключ данжа для групп')
    p.add_argument('--url', default='http://localhost:8000', help='Базовый URL сервера (http/https)')
    p.add_argument('--duration', type=int, default=90, help='Длительность фазы нагрузки на бота, сек')
    p.add_argument('--ramp-ms', type=int, dest='ramp_ms', default=25,
                    help='Задержка между стартом соседних ботов, мс (0 = все разом)')
    args = p.parse_args()
    asyncio.run(run(args))
