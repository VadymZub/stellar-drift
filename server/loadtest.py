"""Нагрузочный тест WS-реалтайма Stellar Drift.

Симулирует N ботов: каждый регистрируется, подключается к /ws/chat, заходит
в один PvP-сектор (pvp_enter) и затем ~10 раз/сек шлёт позицию (как реальный
клиент, см. PvpClient.js _posIntervalMs=100) плюс изредка "стреляет" по
случайному другому боту (pvp_fire_claim) — чтобы нагрузить не только сеть,
но и боевую валидацию на сервере (_resolve_pvp_hit).

Установка (один раз):
    pip install websockets requests

Запуск:
    python loadtest.py --clients 100 --url http://localhost:8000
    python loadtest.py --clients 150 --url https://ваш-сервис.onrender.com

Не восстанавливает состояние сервера — регистрирует НОВЫХ юзеров
(loadtest_<run_id>_<i>) при каждом запуске, они остаются в БД (SQLite не
страдает от нескольких сотен лишних строк, но для порядка их можно
почистить вручную из таблицы users, если понадобится).
"""
import argparse
import asyncio
import json
import random
import time
import uuid

import requests
import websockets

SHIPS = ['wisp', 'falcon', 'raven']
CORPS = ['helios', 'karax', 'tides']


def register_clients(base_url, n, run_id):
    """Регистрирует N тестовых юзеров синхронно (requests) — bcrypt и так
    достаточно дорог, гнать это параллельно на сервере с 0.1 CPU не нужно,
    иначе сама регистрация станет узким местом теста, а не реальная нагрузка."""
    accounts = []
    t0 = time.monotonic()
    for i in range(n):
        username = f'loadtest_{run_id}_{i}'
        r = requests.post(f'{base_url}/auth/register', json={
            'username': username, 'password': 'loadtest123',
        }, timeout=15)
        if r.status_code != 200:
            print(f'  ! регистрация {username} провалилась: {r.status_code} {r.text[:200]}')
            continue
        accounts.append((username, r.json()['access_token']))
        if (i + 1) % 20 == 0:
            print(f'  зарегистрировано {i + 1}/{n}...')
    print(f'Регистрация: {len(accounts)}/{n} за {time.monotonic() - t0:.1f}с')
    return accounts


class Stats:
    def __init__(self):
        self.connected = 0
        self.connect_failed = 0
        self.connect_times = []
        self.sent = 0
        self.received = 0
        self.errors = 0
        self.disconnected_early = 0
        self.fires_sent = 0
        self.fires_skipped_no_target = 0
        self.mob_room_updates = 0  # pvp_mob_room_update принято хоть кем-то — см. --drones
        self.error_samples = []  # первые N реальных исключений — для диагностики


async def bot_loop(ws_url, username, token, uid_by_name, sector, duration, ramp_delay, stats: Stats,
                    bot_index=0, drones=0):
    # ramp_delay — небольшой разброс старта, чтобы не открывать все N соединений
    # в один и тот же миллисекунд (реалистичнее "наплыва", легче искать в логах момент отказов)
    if ramp_delay:
        await asyncio.sleep(ramp_delay)

    url = f'{ws_url}/ws/chat?token={token}'
    t_connect_start = time.monotonic()
    connected_ok = False
    try:
        async with websockets.connect(url, open_timeout=15, close_timeout=5) as ws:
            connected_ok = True
            stats.connected += 1
            stats.connect_times.append(time.monotonic() - t_connect_start)

            async def reader():
                try:
                    async for raw in ws:
                        stats.received += 1
                        try:
                            msg = json.loads(raw)
                        except ValueError:
                            continue
                        if msg.get('type') == 'session_info':
                            uid_by_name[username] = msg.get('userId')
                        elif msg.get('type') == 'pvp_mob_room_update':
                            stats.mob_room_updates += 1
                except Exception:
                    pass

            reader_task = asyncio.create_task(reader())
            # session_info приходит сразу после подключения (см. server main.py) —
            # даём читалке кадр на его подхват до первого возможного pvp_fire_claim.
            await asyncio.sleep(0.05)

            x, y = random.uniform(-2000, 2000), random.uniform(-2000, 2000)
            loadout = {
                'dmg': 120, 'range': 550, 'cooldown': 0.9, 'penetration': 0.2,
                'evasion': 0.1, 'critChance': 0.15, 'critMult': 2.0,
                'shipKey': random.choice(SHIPS), 'corp': random.choice(CORPS),
                'level': random.randint(20, 50), 'maxHull': 2500, 'maxShield': 900,
            }
            await ws.send(json.dumps({'type': 'pvp_enter', 'sector': sector, 'x': x, 'y': y, 'loadout': loadout}))
            stats.sent += 1

            # --drones: симулируем волну дронов бронепоезда (План, Фаза 2 —
            # server-authoritative таргетинг). В реальности ArmoredTrain.registerMob()
            # зовёт КАЖДЫЙ клиент в комнате на один и тот же детерминированный mobId
            # (регистрация идемпотентна на сервере), для нагрузки достаточно одного
            # отправителя — важно именно поведение _tick_room/broadcast на N ботов.
            if drones and bot_index == 0:
                await asyncio.sleep(0.3)  # даём room_manager.enter() долететь на сервере
                for i in range(drones):
                    await ws.send(json.dumps({'type': 'pvp_mob_register', 'mobId': f'loadtest_drone_{username}_{i}'}))
                    stats.sent += 1

            end_at = time.monotonic() + duration
            last_fire = time.monotonic()
            while time.monotonic() < end_at:
                x += random.uniform(-15, 15)
                y += random.uniform(-15, 15)
                await ws.send(json.dumps({'type': 'pvp_pos', 'x': x, 'y': y, 'heading': random.uniform(0, 6.28)}))
                stats.sent += 1

                # Изредка "стреляем" по случайному другому боту — нагружает
                # _resolve_pvp_hit на сервере, не только позиционный синк. targetUserId
                # ДОЛЖЕН быть реальным числовым user.id (сервер делает int(target_id) без
                # try/except — строка вроде username там уронит всю обработку сообщения
                # и оборвёт СВОЁ ЖЕ соединение, см. main.py except-блок на верхнем уровне).
                if time.monotonic() - last_fire > random.uniform(2, 5):
                    last_fire = time.monotonic()
                    candidates = [uid for name, uid in uid_by_name.items() if name != username and uid is not None]
                    if candidates:
                        target = random.choice(candidates)
                        await ws.send(json.dumps({
                            'type': 'pvp_fire_claim', 'targetUserId': target,
                            'weaponType': 'cannon', 'dmg': random.uniform(80, 200),
                        }))
                        stats.sent += 1
                        stats.fires_sent += 1
                    else:
                        stats.fires_skipped_no_target += 1

                await asyncio.sleep(0.1)  # 10Hz, как реальный клиент

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
    print(f'== Нагрузочный тест: {args.clients} клиентов, {args.duration}с, сектор {args.sector} ==')
    print(f'Цель: {args.url}')

    accounts = register_clients(args.url, args.clients, run_id)
    if not accounts:
        print('Не удалось зарегистрировать ни одного юзера — прерываю.')
        return

    ws_url = args.url.replace('https://', 'wss://').replace('http://', 'ws://')
    stats = Stats()
    uid_by_name = {}  # username -> numeric user.id, заполняется по мере подключения ботов

    print(f'Открываю {len(accounts)} WS-соединений (разброс старта {args.ramp_ms}мс/бот)...')
    t0 = time.monotonic()
    tasks = [
        bot_loop(ws_url, username, token, uid_by_name, args.sector, args.duration,
                 i * args.ramp_ms / 1000.0, stats, bot_index=i, drones=args.drones)
        for i, (username, token) in enumerate(accounts)
    ]
    await asyncio.gather(*tasks, return_exceptions=True)
    elapsed = time.monotonic() - t0

    print()
    print('== Результат ==')
    print(f'Успешно подключились:   {stats.connected}/{len(accounts)}')
    print(f'Не удалось подключиться: {stats.connect_failed}')
    print(f'Оборвались раньше срока: {stats.disconnected_early}')
    if stats.connect_times:
        avg_c = sum(stats.connect_times) / len(stats.connect_times)
        print(f'Время подключения: среднее {avg_c:.2f}с, макс {max(stats.connect_times):.2f}с')
    print(f'Сообщений отправлено: {stats.sent}, получено: {stats.received}')
    print(f'"Выстрелов" отправлено: {stats.fires_sent} (пропущено из-за отсутствия целей: {stats.fires_skipped_no_target})')
    if args.drones:
        expected_ticks = int(args.duration / 0.175)  # MOB_TICK_MS=175 в main.py
        print(f'pvp_mob_room_update принято (суммарно всеми ботами): {stats.mob_room_updates} '
              f'(~{expected_ticks} тиков x {stats.connected} ботов = {expected_ticks * stats.connected} в идеале)')
    print(f'Всего ошибок: {stats.errors}')
    if stats.error_samples:
        print('Примеры ошибок:')
        for s in stats.error_samples:
            print(f'  - {s}')
    print(f'Тест занял: {elapsed:.1f}с (ожидалось ~{args.duration + args.ramp_ms * len(accounts) / 1000.0:.0f}с с учётом разброса старта)')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--clients', type=int, default=100, help='Кол-во одновременных ботов (100 или 150)')
    p.add_argument('--url', default='http://localhost:8000', help='Базовый URL сервера (http/https)')
    p.add_argument('--duration', type=int, default=120, help='Длительность фазы нагрузки на бота, сек')
    p.add_argument('--sector', default='pvp_1', help='PvP-сектор для всех ботов (общая комната)')
    p.add_argument('--ramp-ms', type=int, dest='ramp_ms', default=20,
                    help='Задержка между стартом соседних ботов, мс (0 = все разом)')
    p.add_argument('--drones', type=int, default=0,
                    help='Симулировать волну дронов бронепоезда: первый бот регистрирует '
                         'N ServerMob (pvp_mob_register), проверяем broadcast pvp_mob_room_update '
                         'на всех ботов комнаты (План "server-authoritative mobs", Фаза 2)')
    args = p.parse_args()
    asyncio.run(run(args))
