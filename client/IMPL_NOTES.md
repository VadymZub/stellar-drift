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
| `locales/ru.json` | +garage.tab_perks |
