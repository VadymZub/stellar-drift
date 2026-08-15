"""USDT (TRC-20 / Tron) приём платежей — см. диалог "давай подключим кошелек usdt".

Схема (согласована в диалоге, НЕ переизобретать без обсуждения):
  1. Игрок жмёт "купить пачку" в DonateScene → POST /wallet/create-deposit-order.
  2. Сервер деривует СЛЕДУЮЩИЙ (монотонно растущий, никогда не переиспользуемый)
     Tron-адрес из CRYPTO_WALLET_SEED — одноразовый адрес на ОДИН заказ, не
     постоянный адрес на аккаунт (см. диалог: приватность + не нужно вечно
     следить за адресами всех игроков, только за активными заказами).
  3. Фоновый воркер (poll_pending_orders, вызывается из main.py по таймеру)
     раз в POLL_INTERVAL_SEC проверяет TRC-20-переводы USDT на адрес каждого
     PENDING заказа через TronGrid API.
  4. Нашёл перевод >= ожидаемой суммы → status='paid', user.pending_star_gold_credit
     += star_gold_amount. Клиент потом сам "забирает" через отдельный эндпоинт
     (не через общий player_state — см. комментарий у User.pending_star_gold_credit
     в models.py, это НЕ клиент-доверенный путь).
  5. Просрочен (now > expires_at, всё ещё pending) → status='expired'.

НЕ реализовано (осознанно, следующий шаг): вывод собранных USDT с адресов заказов
на основной кошелёк ("sweep") — потребуется derive_private_key(index) ниже, уже
готова для этого, просто ещё не вызывается нигде.
"""
import os

import requests
from bip_utils import Bip39SeedGenerator, Bip44, Bip44Coins, Bip44Changes
from tronpy import Tron
from tronpy.providers import HTTPProvider

# Зеркало STAR_PACKS из client/src/scenes/DonateScene.js — держать в синхроне
# руками при правке цен там. Сервер — единственный источник истины по цене/кол-ву
# звёзд для реального платежа (клиент присылает только packId, см. main.py
# create_deposit_order — иначе игрок мог бы заказать топовую пачку по цене низшей).
# USDT 1:1 с USD (стейблкоин) — сумма в USDT = цена в $.
STAR_PACKS = {
    "stars_pilot":    {"stars": 625,  "usdt_micro": 4_990_000},
    "stars_sergeant": {"stars": 1250, "usdt_micro": 9_990_000},
    "stars_captain":  {"stars": 2750, "usdt_micro": 19_990_000},
    "stars_admiral":  {"stars": 6000, "usdt_micro": 39_990_000},
}

CRYPTO_WALLET_SEED = os.getenv("CRYPTO_WALLET_SEED", "")
CRYPTO_NETWORK = os.getenv("CRYPTO_NETWORK", "shasta")  # shasta (тест) | mainnet (реальные деньги)

# USDT-TRC20 контракт — на mainnet это ОБЩЕИЗВЕСТНЫЙ адрес, выпущенный Tether.
# На Shasta официального USDT нет (Tether не деплоит на тестнеты) — берём из
# .env (CRYPTO_USDT_CONTRACT), пока не определимся с конкретным тестовым
# токеном (свой TRC-20-контракт-заглушка или публичный community-контракт).
_MAINNET_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
USDT_CONTRACT = os.getenv("CRYPTO_USDT_CONTRACT") or (
    _MAINNET_USDT_CONTRACT if CRYPTO_NETWORK == "mainnet" else ""
)
USDT_DECIMALS = 6

_ENDPOINTS = {
    "shasta": "https://api.shasta.trongrid.io",
    "mainnet": "https://api.trongrid.io",
}


def get_client() -> Tron:
    api_key = os.getenv("TRON_API_KEY") or None  # опционально — поднимает rate-limit TronGrid
    return Tron(HTTPProvider(api_key=api_key, endpoint_uri=_ENDPOINTS[CRYPTO_NETWORK]))


def _account(index: int):
    if not CRYPTO_WALLET_SEED:
        raise RuntimeError("CRYPTO_WALLET_SEED не задан в .env — см. server/.env.example")
    seed = Bip39SeedGenerator(CRYPTO_WALLET_SEED).Generate()
    bip44 = Bip44.FromSeed(seed, Bip44Coins.TRON).Purpose().Coin().Account(0).Change(Bip44Changes.CHAIN_EXT)
    return bip44.AddressIndex(index)


def derive_address(index: int) -> str:
    return _account(index).PublicKey().ToAddress()


def derive_private_key_hex(index: int) -> str:
    # Только для будущего sweep'а собранных средств — НЕ вызывается нигде в
    # обычном потоке приёма платежей (там нужен только публичный адрес).
    # Ключ никогда не хранится в БД — вычисляется на лету из seed+index.
    return _account(index).PrivateKey().Raw().ToHex()


def check_incoming_usdt(address: str, min_timestamp_ms: int) -> list[dict]:
    """TRC-20-переводы USDT НА address, случившиеся после min_timestamp_ms.
    Возвращает [{amount_micro, tx_hash, timestamp_ms}, ...], новые первыми.
    """
    if not USDT_CONTRACT:
        raise RuntimeError(
            "CRYPTO_USDT_CONTRACT не задан для сети "
            f"'{CRYPTO_NETWORK}' — на Shasta нет официального USDT, нужно "
            "выбрать/задеплоить тестовый TRC-20-токен и прописать его адрес в .env"
        )
    # tronpy.Tron НЕ оборачивает этот эндпоинт вообще (проверено живым тестом —
    # AttributeError: 'Tron' object has no attribute 'get_account_trc20_transactions',
    # хотя изначально код был написан в предположении, что оборачивает). Это
    # TronGrid-специфичный REST-индекс (не часть базового JSON-RPC ноды, который
    # tronpy реально оборачивает) — бьём HTTP напрямую.
    headers = {}
    api_key = os.getenv("TRON_API_KEY")
    if api_key:
        headers["TRON-PRO-API-KEY"] = api_key
    resp = requests.get(
        f"{_ENDPOINTS[CRYPTO_NETWORK]}/v1/accounts/{address}/transactions/trc20",
        params={"only_to": "true", "limit": 50, "contract_address": USDT_CONTRACT},
        headers=headers, timeout=15,
    )
    resp.raise_for_status()
    txs = resp.json().get("data", [])
    out = []
    for tx in txs:
        if tx.get("token_info", {}).get("address") != USDT_CONTRACT:
            continue
        ts = int(tx.get("block_timestamp", 0))
        if ts < min_timestamp_ms:
            continue
        out.append({
            "amount_micro": int(tx["value"]),
            "tx_hash": tx["transaction_id"],
            "timestamp_ms": ts,
        })
    return out
