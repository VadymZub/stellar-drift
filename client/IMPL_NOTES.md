# Stellar Drift — Заметки по реализации

---

## Чёткость спрайтов и изображений (2026-06-15)

### Проблема

Phaser 4 WebGL на Windows 125% (DPR=1.25) давал размытые корабли, шрифты и иконки по трём причинам:

1. **CSS bilinear blur** — canvas был в физических пикселях (2400px), CSS масштабировал до 1920px через bilinear → всё размыто
2. **WebGL 4× downscale** — спрайты из `resize_ships.py` были `displaySize×4` (для DPR=2+zoom=2), без zoom = 4× bilinear за один проход
3. **Большие source изображения** — `drover_g` 1672px, NPC 941×1672, иконки рангов 1024px — все `setScale(float)` или WebGL bilinear с огромным ratio

### Решение — 4 слоя

**1. CSS canvas (`index.html` + `main.js`)**
```css
canvas { image-rendering: pixelated; image-rendering: crisp-edges; }
```
```js
const W = () => Math.floor(window.innerWidth  * DPR);  // физические пиксели
const H = () => Math.floor(window.innerHeight * DPR);
// fitCanvas: style.width = innerWidth + 'px'           // CSS = логические пиксели
```
→ NN CSS downscale вместо bilinear, работает для любого DPR (1.0/1.25/1.5/2.0)

**2. `_prepShipTex` в BootScene.create() — одноразовый pre-процессинг при старте**

Функция в `BootScene.js` заменяет текстуру на Canvas 2D версию с `targetMax` пикселями по длинной стороне. Использует step-halving (каждый проход ≤2×, итог = качество multi-pass Lanczos).

```js
// Игровые спрайты: displaySize×2 → WebGL делает чистый 2× bilinear
for (const s of SHIPS) _prepShipTex(this, s.key, s.displaySize * 2);

// Большие garageKey (T3/T4) → 446px (2× от 223px display box)
for (const key of ['drover_g','phantom_g','argosy_g','helion_g','drifter_g'])
  _prepShipTex(this, key, 446);

// NPC портреты: 941×1672 → 432px (2× от 216px portrait height)
for (const key of ['npc_corvus', ...]) _prepShipTex(this, key, 432);

// Иконки ранга: 1024×1024 → 44px (2× от 22px display)
for (let t = 1; t <= 7; t++) _prepShipTex(this, `rank_tier${t}`, 44);
```

**3. `prerenderTex` с multi-step halving (`utils/prerenderTex.js`)**

Для динамического рендеринга в сценах (GarageScene, MissionsScene). Тот же step-halving. Кеширует по `__pre_${key}_${dw}x${dh}`.

```js
// GarageScene.shipImg() / MissionsScene
const preKey = prerenderTex(this, key, dw, dh);
this.add.image(cx, cy, preKey).setDisplaySize(dw, dh);
// НЕ setScale(float) — только setDisplaySize с целыми значениями
```

**4. Render config (`main.js`)**
```js
render: { roundPixels: true, mipmapFilter: 'LINEAR' }
// mipmapFilter: 'LINEAR' — НЕ LINEAR_MIPMAP_LINEAR (артефакты на non-POT текстурах)
```

### Правило для новых ассетов

| Ситуация | Решение |
|---|---|
| Новая большая текстура, отображается мелко | `_prepShipTex(this, key, displaySize * 2)` в BootScene |
| Динамический рендер в сцене (не в игровом мире) | `prerenderTex(this, key, dw, dh)` + `setDisplaySize(dw, dh)` |
| `setScale(float)` на большом изображении | Заменить на `prerenderTex` + `setDisplaySize` |
| Мерцание иконки при движении | pre-process до 2× display size, позицию НЕ `Math.round()` (world coords) |

### Файлы изменены

| Файл | Что |
|---|---|
| `index.html` | `image-rendering: pixelated` на canvas |
| `src/main.js` | `W/H = innerWidth/Height * DPR`, CSS = logical px |
| `src/scenes/BootScene.js` | `_prepShipTex` + вызовы для ships/garageKey/NPC/ranks |
| `src/utils/prerenderTex.js` | NEW — multi-step halving Canvas 2D cache |
| `src/scenes/GarageScene.js` | `shipImg()` через prerenderTex + setDisplaySize |
| `src/scenes/MissionsScene.js` | NPC портрет через prerenderTex + setDisplaySize |
| `src/entities/Player.js` | `setDisplaySize(round(dw), round(dh))` для спрайта; nameplate — float-позиция |

---

## Престиж-корабли: баланс + активные скиллы (2026-06-18)

### Три корабля по одному на корпорацию

Все три: **7о / 7щ / 2дв** слотов. Дифференциация через dmgMod, базы корпуса/скорости, пассив и уникальный активный скилл.

| | Helion (Гелиос) | Argosy (Каракс) | Drifter (Приливы) |
|---|---|---|---|
| hullMax | 3100 | 3600 | 2900 |
| shieldBase | 450 | 480 | 440 |
| baseSpeed | 220 | 215 | 265 |
| dmgMod | 1.12 | 1.05 | 1.08 |
| Пассив | +8% урон | 25 HP/с реген | +15% уклонение |
| Активный | Залповый огонь | Аварийный ремонт | Фазовый прыжок |
| КД | 40 с | 55 с | 60 с |

### Пассивы (Player.js — recomputeStats)

- `damageBonus` — умножает `cannonDamage` + `laserDamage` после всех остальных бонусов
- `hullRegen` — сохраняется в `this.hullRegenPerSec`, в `update()` регенерирует HP без задержки (постоянно)
- `evasionBonus` — добавляется к `this.evasion` после модулей, капает до 0.30 (не 0.15)

### Активные скиллы (ключи с префиксом `ship:`)

**ship:helion_volley — Залповый огонь**
- Требует активную цель. Один выстрел с `skillMult = 1.25` (весь урон всех оружий × 1.25).
- Реализация: `this._volleyBlastMult = 1.25` → `firePlayerWeapon()` потребляет в первом вызове.

**ship:argosy_repair — Аварийный ремонт**
- +25% maxHull мгновенно + `lastDamageAt = 0` (щит начинает регенерировать немедленно).

**ship:drifter_jump — Фазовый прыжок**
- 700 пкс вперёд по вектору носа. `invulnerable = true` на 250 мс (снаряды не наносят урон).
- `body.reset(destX, destY)` + `waypoint = null` + `speed = 0`.

### Архитектура ship: скиллов

- Ключи с префиксом `ship:` (аналогично `use:` для расходников)
- `_activateSkillSlot`: обрабатывается до проверки `lv === 0`
- `_skillCooldownMs`: отдельная ветка для `ship:`, КД × `activeCooldownMod`
- `_rebuildActionBarIcons` (HudScene): canvas-текстура `__ss_${key}` — цветной фон + текст (ЗП/РМ/ПР)
- `_updateActionBarHUD`: `lv = ship: ? 1 : skillLevels[key]` — всегда активны (не тусклые)
- Auto-insert: после `this.actionBar` инициализации в `create()`, вставляет скилл в слот 0 если пуст или занят другим `ship:` ключом

### Промты для иконок

Файл с промтами для генерации: см. `assets/skills/ship_skill_prompts.md`

### Файлы изменены

| Файл | Что |
|---|---|
| `src/ships.js` | Новые статы, `passives`, `activeSkill` на всех трёх престиж-кораблях |
| `src/entities/Player.js` | `hullRegenPerSec` в update; `damageBonus`/`evasionBonus`/`hullRegen` в recomputeStats; `invulnerable` в takeDamage/respawn |
| `src/scenes/GameScene.js` | `_volleyBlastMult`; ship: ветка в `_activateSkillSlot`/`_skillCooldownMs`; `_doShipVolleyBlast`/`_doShipArgosyRepair`/`_doShipDrifterJump`; auto-insert в create |
| `src/scenes/HudScene.js` | `_ensureShipSkillTex`; ship: в `_rebuildActionBarIcons`; effectiveLv в `_updateActionBarHUD` |
| `src/scenes/GarageScene.js` | Отображение `damageBonus`/`hullRegen`/`evasionBonus` в панели пассивов |
| `locales/ru.json` | Названия скиллов + обновлённые описания кораблей |

---

## Слоты Боеприпасов (2026-06-18)

### Концепция

Отдельные слоты («Боеприпасы») для хранения патронов и расходников вне трюма. Количество слотов зависит от корабля.

| Корабль | Слоты |
|---|---|
| Wisp | 2 |
| Stiletto | 3 |
| Anvil | 4 |
| Drover, Aegis | 5 |
| Phantom, Helion, Argosy, Drifter, Argus | 6 |

### Типы боеприпасов

| Ключ | Название | Мaкс/слот | Эффект |
|---|---|---|---|
| `ammo_plasma` | Плазма-патроны | 10 000 | Стандарт |
| `ammo_plasma_elite` | Элит-плазма | 10 000 | ×1.2 урон пушки |
| `ammo_laser` | Лазерные заряды | 10 000 | Без бонуса |

Все расходники (repair_pack и др.) тоже можно перемещать в слоты боеприпасов.

### Механика

- **Авто-расход**: `_consumeAmmo('cannon')` в `_fireCannon` — сначала ищет elite-плазму (×1.2), потом стандарт. Лазер — `_consumeAmmo('laser')` после проверки попадания.
- **Расходники**: `_useConsumable` сначала ищет в слотах боеприпасов, потом в трюме.
- **Подбор лута**: `_tryAddToAmmoSlots(type, amount)` — приоритетно заполняет слоты перед трюмом. Ammo-типы авто-заполняют пустые слоты, расходники только в уже-совпадающие.
- **Сохранение**: `ammoSlots` в `_serializeState` / `_applyLoadedState`.

### UI

- **Склад (C)**: секция «БОЕПРИПАСЫ» выше трюма. Клик по занятому слоту → сдампить в трюм.
- **Гараж (G) → Оборудование**: ряд слотов боеприпасов ниже двигателей, только отображение.
- **Иконки**: canvas-текстуры с цветным фоном и буквой (П/ПЭ/Л). Промты для AI-генерации: `assets/ammo_prompts.md`.

### Файлы изменены

| Файл | Что |
|---|---|
| `src/items.js` | `ammo_plasma/elite/laser` в `CONSUMABLES` (category: 'ammo'), экспорт `AMMO_ICON` |
| `src/ships.js` | `aSlots` для всех кораблей |
| `src/scenes/GameScene.js` | Init `ammoSlots`, `_consumeAmmo`, `_tryAddToAmmoSlots`, loot pickup priority, serialize |
| `src/scenes/CargoScene.js` | Ammo section UI, `_ensureAmmoTex`, `_renderAmmoSlots`, `_moveAmmoSlotToCargo`, `_moveCargoAmmoToSlot` |
| `src/scenes/GarageScene.js` | `_renderAmmoSlotRow`, slotRow 'ammo' ветка, импорт AMMO_ICON |
| `locales/ru.json` | Названия ammo-типов, `garage.ammo` |
| `assets/ammo_prompts.md` | Промты иконок боеприпасов |

---

## Что добавлено ранее (2026-06-12)

---

### 1. SkillScene — дерево скиллов (hotkey K)

**Как открыть:** нажать `K` в игре (или `ESC`/`K` для закрытия)

**20 скиллов в 3 ветках:**

| Ветка | Скиллов | Max SP | Цвет |
|---|---|---|---|
| ⚔ Combat | 7 | 21 | красный |
| 🔧 Engineering | 7 | 22 | cyan |
| 💰 Trading | 6 | 18 | amber |
| **Итого** | **20** | **61** | — |

**Активные скиллы** (можно назначить на панель действий):
- ⚡ Overcharge Shot — ×2 урон, КД 25c
- 🚀 Salvo — 5 сек все орудия, КД 55c
- 💀 Berserker — +60% урон HP<25%, КД 60c
- 💉 Emergency Repair — +30% HP, КД 120c
- 🛡 Shield Burst — +120% щит, КД 85c
- 👻 Stealth Sprint — +35% скор + стелс, КД 55c

**SP-система:**
- 1 SP за каждый уровень пилота (уровень 1 = 1 SP, уровень 50 = 50 SP)
- Формула: `_spTotal = pilotLevel + skillAchievementSP`
- Дерево всего: 61 SP (Combat 21 + Engineering 22 + Trading 18) → нельзя прокачать всё
- Активные скиллы: max 1 уровень (1 SP, сразу финальная версия)
- Пассивные: max 3–4 уровня
- Данные живут на `gs.skillLevels`, `gs.actionBar`

**Что тестить:**
- [ ] Дерево отображается (3 колонки, узлы с ★☆)
- [ ] Locked узлы (требования не выполнены) серые с 🔒
- [ ] Клик по доступному узлу → tooltip с кнопкой «Изучить»
- [ ] SP тратятся при изучении, счётчик в хедере обновляется
- [ ] Зависимости: Sharpshooter 2/4 нужен для Heavy Caliber
- [ ] Изученный активный скилл → кнопка «📌 На панель действий»
- [ ] Action bar (10 слотов внизу) показывает назначенные скиллы
- [ ] ПКМ на слоте action bar — снимает скилл
- [ ] Кнопка 🔄 СБРОС SP → модал с бесплатным и платным вариантом
- [ ] Закрытие: K или ESC

---

### 2. Перки модулей

**Система:**
- 20 перков (8 для орудий, 12 для щитов)
- 4 редкости: 🟢 Common, 🟣 Uncommon, 🟡 Rare, 🔴 Jackpot
- Каждый дроп орудия/щита теперь содержит случайный перк

**Апгрейд двумя путями** (5 уровней каждый):
- 💰 Кредиты: +0.9% за уровень → max +4.5%
- ⭐ Звёзды: +9% за уровень → max +45%

**Реролл:** 200⭐ первая попытка, x2 за каждую следующую в течение дня

---

### 3. GarageScene — вкладка ПЕРКИ

**Как открыть:** `G` → таб `ПЕРКИ`

**Что тестить:**
- [ ] Таб появляется (4-й, после АПГРЕЙД)
- [ ] Список слотов слева (оружие + щит активного корабля)
- [ ] Клик по слоту — детали перка справа
- [ ] Картинка перка отображается (из assets/perks/)
- [ ] Рамка/бейдж редкости корректного цвета
- [ ] Кнопка апгрейда кредитами (серая если нет денег)
- [ ] Кнопка апгрейда звёздами (серая если нет звёзд)
- [ ] Кнопка реролла — списывает ⭐ и назначает новый перк
- [ ] Старые предметы без перка получают его автоматически
- [ ] После реролла картинка меняется

---

### Известные ограничения (MVP)

- Активные скиллы **отображаются** на панели действий, но не триггерятся с клавиатуры (1–0) — логика кулдаунов в GameScene ещё не добавлена
- Бонусы пассивных скиллов (урон, HP, рег.) пока не применяются к статам игрока — нужна интеграция с Player.js
- Перки влияют на UI (% отображаются), но в боевой логике не активны
- Бесплатный респек не привязан к реальному расписанию (пятница) — упрощённо: доступен, пока не использован

---

### Файлы изменены

| Файл | Что |
|---|---|
| `src/scenes/SkillScene.js` | NEW — весь UI дерева скиллов |
| `src/perks.js` | NEW — данные перков, rolling, стоимости |
| `src/scenes/GarageScene.js` | +tab ПЕРКИ, renderPerksTab |
| `src/scenes/GameScene.js` | +init skillLevels/actionBar, hotkey K, input block |
| `src/main.js` | +import SkillScene |
| `src/items.js` | rollCannon/rollShield теперь добавляют perk |
| `src/scenes/BootScene.js` | загрузка 20 perk-изображений |
| `assets/perks/` | 20 PNG файлов |

---

## Расписание ивентов: бронепоезд + нашествие (2026-07-16)

### Запрос

Раньше время старта бронепоезда и нашествия в каждом PvP-секторе считалось независимым хешем от даты (`_worldEventHash`) — час 0–23 без учёта дня недели, без гарантии, что события не столкнутся друг с другом или между секторами (только эвристика — суффикс `:train` в сиде, чтобы *обычно* не совпадать с нашествием).

Новое требование:
- Будни — окно **19:00–23:00**
- Выходные (сб/вс) — окно **11:00–23:00**
- Бронепоезд — идёт **каждый день**
- Нашествие — только **сб/вс**
- Все события дня разнесены по времени между собой и по картам (не должны скучиваться)

### Решение

`GameScene._dailyEventSchedule()` — единый суточный слот-план вместо двух независимых per-sector хешей:

1. Собираем список слотов на сегодня: 5 бронепоездов (по одному на сектор) всегда; если сб/вс — добавляем ещё 5 слотов нашествия.
2. Слоты детерминированно перетасовываются (Fisher-Yates, сид от даты — тот же приём, что `ConfedGuardSystem._seededRandom`) — порядок меняется день ото дня, но одинаков у всех клиентов.
3. Слоты раскладываются **равномерно** по дневному окну (240 мин в будни / 720 мин в выходные ÷ на число слотов) → гарантированный минимальный зазор между любыми двумя событиями, а не просто "авось не совпадёт".

`_worldEventTodayStart(sectorKey)`/`_armoredTrainTodayStart(sectorKey)` теперь просто ищут свой слот в `_dailyEventSchedule()` и возвращают `null`, если сегодня ничего не запланировано (нашествие в будний день) — все 4 места, где раньше предполагался всегда-валидный timestamp (`_initWorldEvent`, `_initArmoredTrain`, `_initEventCountdown`, `_upcomingScheduledEvents`), обновлены под null-проверку.

Всё по-прежнему **100% на клиенте** — сервер не участвует в расписании (только трекает урон/награды уже во время самого ивента, как и раньше).

### Пример реального расписания (сгенерировано алгоритмом, 16–22 июля 2026)

Будни — шаг ~48 мин:

| Дата | 19:00 | 19:48 | 20:36 | 21:24 | 22:12 |
|---|---|---|---|---|---|
| Чт 16.07 | Нейтральная Зона | Сердце Бездны | Алгол | Граница X-12 | Граница X-44 |
| Пт 17.07 | Алгол | Сердце Бездны | Нейтральная Зона | Граница X-44 | Граница X-12 |

Выходные — 10 событий (5 бронепоезд + 5 нашествие), шаг ~72 мин, окно 11:00–23:00. Пример, Сб 18.07:
`11:00` Бронепоезд·Граница X-44 → `12:12` Бронепоезд·Нейтральная Зона → `13:24` Бронепоезд·Граница X-12 → `14:36` Бронепоезд·Сердце Бездны → `15:48` Нашествие·Алгол → `17:00` Нашествие·Граница X-12 → `18:12` Бронепоезд·Алгол → `19:24` Нашествие·Сердце Бездны → `20:36` Нашествие·Граница X-44 → `21:48` Нашествие·Нейтральная Зона

Конкретное время/сектор каждый день своё (перетасовка по дате) — фиксировано только окно и минимальный зазор между событиями.

### Файлы изменены

| Файл | Что |
|---|---|
| `src/scenes/GameScene.js` | `_dailyEventSchedule()` NEW; `_worldEventTodayStart`/`_armoredTrainTodayStart` переписаны на lookup из общего плана; `_initWorldEvent`/`_initArmoredTrain`/`_initEventCountdown`/`_upcomingScheduledEvents` — null-проверки |

---

## Десктоп-клиент на Tauri (2026-07-17)

### Запрос

Нужны: реальная дистрибуция (инсталлятор вместо "открой URL"), ощущение нативного приложения (своё окно/иконка, без хрома браузера), прирост скорости за счёт изоляции от остального браузера (вкладки/расширения делят GPU/память). Выбор стоял между Electron и Tauri.

### Решение — Tauri, не Electron

Оба оборачивают тот же Chromium-движок на Windows (Tauri — через системный WebView2, Electron — через встроенный Chromium), так что сырой рендер не станет быстрее ни там, ни там — выигрыш именно в изоляции процесса. Tauri выбран из-за меньшего веса инсталлятора (~5-10 МБ против ~150-200 МБ) и отсутствия встроенного браузера.

**Важное уточнение по хостингу**: Tauri зашивает статику клиента (весь `client/`) в инсталлятор — хостинг фронтенда (Vercel/Netlify из старого плана) становится не нужен. Бэкенд (FastAPI + БД) как был отдельным сервисом, так и остаётся — общий мир на всех игроков не может «уехать» в локальный инстанс каждого игрока (см. `deployment_hosting_plan` — Render + Neon/Supabase, ещё не реализовано, отдельная задача).

### Архитектура

1. **Vendoring Phaser вместо CDN** (`client/vendor/phaser.esm.js` + import map в `index.html`):
   ```html
   <script type="importmap">
   { "imports": { "https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js": "./vendor/phaser.esm.js" } }
   </script>
   ```
   Все 40 файлов, каждый из которых независимо делает `import * as Phaser from 'https://cdn.jsdelivr.net/...'`, продолжают импортировать ровно ту же CDN-строку — браузер/webview прозрачно резолвит её в локальный файл. Ноль правок в этих 40 файлах. Убирает рантайм-зависимость от jsdelivr (важно для офлайн-надёжности инсталлятора), заодно работает и для обычного браузерного дев-режима.

2. **`src-tauri/`** (корень репо, СИБЛИНГ `client/`, не внутри неё) — Tauri v2 скаффолд (`tauri.conf.json`):
   - `build.frontendDist = "../client"` — указывает на `client/` целиком, без сборки — Tauri просто встраивает статику при `tauri build`. Изначально `src-tauri` жила ВНУТРИ `client/`, а `frontendDist = "../"` указывал на саму `client/` — `tauri build` (не `dev`!) на это ругался: "frontendDist includes src-tauri/target" (пытался бы упаковать собственный build-каталог как веб-ассеты). Первый реальный релиз (v1.1.341) упал на этом в CI — фикс: вынести `src-tauri` из `client/` на уровень репо.
   - `build.devUrl = "http://localhost:8080"` — переиспользует существующий dev-сервер из `run.ps1`; `tauri dev` просто ждёт TCP-соединение по этому адресу вместо запуска своего сервера. Дев-цикл не меняется вообще.
   - `identifier: "com.stellardrift.app"`, `app.security.csp: null` (v1 — ничего не блокируется, как и текущий wildcard CORS на сервере; сузить CSP — будущий hardening-шаг, не блокер).
   - **Без `tauri-plugin-single-instance`** — намеренно, чтобы можно было запускать 2 инстанса на одной машине для локального тестирования PvP (как сейчас 2 вкладки браузера). Отдельный риск — WebView2 эксклюзивно блокирует свою user-data-folder на процесс; 2 ярлыка одной и той же установленной копии могут столкнуться на втором запуске. Митигация: ставить/копировать приложение в 2 разные папки — тогда у каждой своя UDF.

3. **`client/src/api.js`** — детект «это упакованный Tauri-билд» через `location.hostname === 'tauri.localhost'` (v2 prod-origin; НЕ `location.protocol === 'tauri:'` — это устаревший v1 синтаксис). В этом случае — плейсхолдер прод-URL бэкенда (`https://stellar-drift-api.onrender.com`, обновить после реального деплоя на Render) вместо `location.hostname`-логики. Экспортирован `WS_BASE` рядом с `API_BASE`; `HudScene.js._connectChatWS()` теперь берёт готовый `WS_BASE` вместо независимого дублирования `ws://${location.hostname}:8000` у себя. Дев-поведение (браузер ИЛИ `tauri dev` на :8080) не меняется байт в байт, поскольку `location.hostname` остаётся `localhost` в обоих случаях.

4. **DevTools/Playwright никуда не делись** — WebView2 хромиумный, те же Chrome DevTools (по умолчанию включены в dev-сборке). Для скриптовых репродукций (как весь этот сеанс) — запуск с `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` (именно через env var, не как обычный argv-флаг exe — WebView2-специфичный способ прокинуть Chromium-флаги во внутренний процесс), затем Playwright `chromium.connectOverCDP('http://localhost:9222')` вместо `chromium.launch()`.

5. **DEV_MODE = true** в `LoginScene.js`/`GameScene.js` — ручной чек-лист перед реальным релизом (флипнуть в `false`), не автоматизировано — в проекте нет механизма dev/prod-веток без сборщика, а добавлять его ради этого было бы лишним усложнением.

### Живая проверка

`npx @tauri-apps/cli dev` (Rust на машине отсутствовал — доустановлен через `rustup-init`, MSVC Build Tools и WebView2 рантайм уже были) — первая сборка ~360 крейтов, 6м45с. Реальное нативное окно WebView2 «Stellar Drift» запустилось, подключилось к локальному бэкенду, полностью отрендерило и логин-экран, и геймплей (полёт, HUD, миникарта, чат, лог миссий) — 0 page errors. Проверено через `--remote-debugging-port` + Playwright CDP-attach (скриншот именно webview-контента приложения, не экрана целиком — первая попытка скриншотить через `GetWindowRect`+`CopyFromScreen` по ошибке поймала чужое окно с рабочего стола, immediately deleted).

### Файлы изменены

| Файл | Что |
|---|---|
| `index.html` | import map, редирект Phaser-CDN на vendor |
| `vendor/phaser.esm.js` | NEW — локальная копия Phaser 4.2.1 ESM |
| `src/api.js` | `isTauriProd` детект, `WS_BASE` export |
| `src/scenes/HudScene.js` | `_connectChatWS()` использует `WS_BASE` вместо дублирования |
| `src-tauri/` | NEW — весь Tauri v2 скаффолд (tauri.conf.json, Cargo.toml/.lock, src/main.rs, src/lib.rs, capabilities, icons) |
| `locales/ru.json` | +garage.tab_perks |
