# Module Icon Prompts - Stellar Drift

Стиль: **Sci-Fi 3D Render, Isometric View, Inventory Icon**.
Цветовая палитра: **Cyan** (T1–T3), **Purple + Cyan** (T4).

---

## Контекст отображения

Иконки модулей используются в **слотах инвентаря/гаража** (Cargo, Garage).
- Реальный размер в UI: **48–64 px**.
- Фон: **прозрачный PNG**.
- Прогрессия тиров: нарастающая сложность формы + смена цвета энергии на T4.

### Требования к иконке
| Параметр | Значение |
|---|---|
| Размер генерации | Квадрат 512×512 (или 600×600) |
| Фон | **Прозрачный** (PNG с alpha) |
| Ракурс | Isometric (изометрия, ~30°) |
| Стиль | 3D render, dark metallic, sci-fi |
| Энергия T1–T3 | Cyan / blue-cyan |
| Энергия T4 | Purple + violet + cyan |

---

## Общий суффикс (добавлять к каждому промту)

> `transparent background, no background, isolated icon, bold clean silhouette, 3D render, isometric view, game inventory icon, 4k resolution, PNG with alpha channel.`

---

## Plasma Cannon

### T1 Plasma Cannon
> `Sci-fi T1 single plasma cannon, one thick barrel, compact dark metallic housing, faint cyan glow at barrel tip, simple robust design, minimal details.`

### T2 Plasma Cannon
> `Sci-fi T2 dual plasma cannon, two side-by-side barrels, reinforced dark metallic housing with armor panels, bright cyan glowing barrel tips, more detailed than T1.`

### T3 Plasma Cannon
> `Sci-fi T3 triple plasma cannon, three barrels arranged linearly, bulkier armored housing with cyan glow between barrels and energy conduits, cyan arc discharge at barrel tips.`

### T4 Plasma Cannon *(переделан — gatling)*
> `Sci-fi T4 rotary plasma gatling cannon, six thin barrels arranged in circular rotating cluster pointing forward, heavy cylindrical armored housing behind the barrel cluster, glowing purple plasma energy at all barrel tips, violet and cyan energy rings around the rotating barrel assembly, mechanical rotation joints visible, clearly directional weapon with muzzles facing viewer, dark metallic surface.`

**Прогрессия:**
| Тир | Форма | Цвет |
|---|---|---|
| T1 | 1 ствол | cyan faint |
| T2 | 2 ствола | cyan |
| T3 | 3 ствола (линейно) | cyan + arcs |
| T4 | 4 ствола (2×2) + coils | purple + cyan |

---

## Shield Module

### T1 Shield Module
> `Sci-fi T1 shield generator module, small rounded dark metallic base housing, single emitter dome on top, faint cyan energy bubble above, compact simple design, minimal glow.`

### T2 Shield Module
> `Sci-fi T2 shield generator module, medium rounded housing with reinforced frame, dome emitter with stronger cyan energy field, visible emitter ring, more detailed than T1.`

### T3 Shield Module
> `Sci-fi T3 advanced shield generator, larger armored housing with side panels, projecting smooth cyan energy dome sphere, bright cyan glow, energy conduits on housing surface.`

### T4 Shield Module *(переделан)*
> `Sci-fi T4 heavy shield generator, thick rectangular armored housing with angular side plates, dual emitter rings on both sides, projecting hexagonal energy field dome with visible hex grid pattern, glowing purple and violet energy web with cyan electric arc discharge, dark metallic surface.`

**Прогрессия:**
| Тир | Форма | Цвет |
|---|---|---|
| T1 | Округлый корпус, 1 эмиттер | cyan faint |
| T2 | Округлый + рамка | cyan |
| T3 | Армированный + гладкий купол | bright cyan |
| T4 | Прямоугольный + hex-сетка | purple + cyan |

---

## Engine

### T1 Engine
> `Sci-fi T1 basic ion thruster engine module, single round thruster nozzle, compact dark metallic housing, faint blue-cyan exhaust glow at nozzle opening, simple geometric form, minimal details.`

### T2 Engine
> `Sci-fi T2 dual ion thruster engine module, two side-by-side cylindrical nozzles, reinforced dark metallic housing with cooling fins, moderate cyan exhaust glow from both nozzles, compact but more detailed than T1.`

### T3 Engine
> `Sci-fi T3 advanced plasma thruster engine, triple nozzle cluster arranged in triangle formation, large armored housing with visible exhaust manifolds and heat vents, bright cyan plasma exhaust jets streaming from all three nozzles, energy conduits on housing surface.`

### T4 Engine
> `Sci-fi T4 high-power fusion thruster engine, massive four-nozzle engine block with reactor core visible at center glowing violet purple, twin lateral booster pods with cyan plasma vents, energy arcs across nozzle array, heavy armored plating with glowing conduits, purple and cyan mixed exhaust plumes.`

**Прогрессия:**
| Тир | Форма | Цвет |
|---|---|---|
| T1 | 1 сопло | cyan faint |
| T2 | 2 сопла | cyan |
| T3 | 3 сопла (треугольник) | cyan jets |
| T4 | 4 сопла + reactor core | purple + cyan |

---

## Laser Cannon *(один тип, без тиров)*

Легендарное оружие. Дроп только из босса Апофиса (8% шанс).
Цвет энергии: **amber/orange** — контрастирует с cyan плазмы.

> `Sci-fi legendary laser cannon module, single long precision barrel with multi-lens focusing array at muzzle tip, sleek elongated dark metallic housing with heat dissipation fins along barrel, glowing intense amber-orange beam emitter at muzzle, polished angular form, precision optics visible, warm amber-orange energy glow, distinct from plasma cannons, transparent background, no background, isolated icon, bold clean silhouette, 3D render, isometric view, game inventory icon, 4k resolution, PNG with alpha channel.`

**Файл:** `laser_cannon.png` → папка `client/assets/modules/`

---

## Спецификация экспорта

- **Размер:** 512×512, прозрачный фон (PNG с alpha).
- **Имена файлов:** `plasma_cannon_t1.png` … `engine_t4.png` → папка `client/assets/modules/`.
- **Инструмент:** Midjourney / DALL-E 3 / Stable Diffusion.
- **Постобработка:** если фон белый — удалить в Photoshop/онлайн remove.bg.
