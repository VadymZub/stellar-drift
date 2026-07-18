# Icon Generation Prompts — Stellar Drift

## Стиль игры (общий контекст)

Stellar Drift — мрачный космический top-down MMO-шутер. Визуальная стилистика:
- Фон: глубокий космос, оттенок **#080814** (почти чёрный с синим подтоном), звёздные поля
- Иконки на **чёрном/прозрачном фоне**, высокий контраст
- Sci-fi militari: угловые формы, технические гравюры, неоновые контуры
- Размер: **512×512 px**, квадратный формат, без рамки
- Стиль рендера: детализированная цифровая иллюстрация, photorealistic металл + neon glow

---

## Броня (Armor Modules) — 4 иконки по тирам

**Общий стиль брони:** угловые металлические пластины с гексагональной текстурой,
технические гравюры-линии, энергетический контур по краю. Без щитового пузыря — только твёрдый металл.

---

### T1 — Basic Plating

```
Sci-fi space game armor module icon, flat hexagonal metallic plate, gunmetal grey, 
industrial texture with subtle rivets and seams, faint cool white edge glow, 
single layer plating, worn surface, scratched metal,
dark space background #080814, no text, square 512x512,
game item icon style, high contrast, digital illustration
```

---

### T2 — Reinforced Plating

```
Sci-fi space game armor module icon, layered composite armor panel,
two overlapping hexagonal plates, steel-blue tint with cyan energy lines etched into surface,
reinforced bolts at corners, subtle blue-white edge glow, geometric circuit pattern,
dark space background #080814, no text, square 512x512,
game item icon style, high contrast, digital illustration
```

---

### T3 — Advanced Composite

```
Sci-fi space game armor module icon, advanced composite armor slab,
hexagonal nano-panels with glowing orange-amber circuit veins,
tri-layered structure, energy conduit channels cut into surface,
bright amber glow on edges, heat shimmer effect,
dark space background #080814, no text, square 512x512,
game item icon style, high contrast, digital illustration
```

---

### T4 — Nano-Plating (Elite)

```
Sci-fi space game armor module icon, elite nano-technology armor plating,
deep violet-purple hexagonal scales with shifting energy field shimmer,
micro-circuit patterns glowing with violet-magenta light,
reactive energy membrane visible on surface, intense purple aura,
dark space background #080814, no text, square 512x512,
game item icon style, high contrast, cinematic digital illustration
```

---

## Бустеры (Boosters) — временные усилители для магазина

**Общий стиль бустеров:** флакон / ампула / энергетическая сфера, яркий цветной
свет изнутри, sci-fi дизайн контейнера с корпусом корабля-стилистикой.
Читается как «расходник», не как «модуль».

---

### Damage Booster — «Усилитель урона»

```
Sci-fi space game booster item icon, combat damage amplifier,
sleek angular vial with glowing red-orange plasma inside,
weapon targeting reticle etched on glass surface,
aggressive sharp geometric form, fierce crimson-orange inner glow,
energy sparks at the tip, military red accent lines,
dark space background #080814, no text, square 512x512,
game consumable icon style, high contrast, digital illustration
```

---

### Shield Booster — «Усилитель щита»

```
Sci-fi space game booster item icon, shield energy booster,
hexagonal crystalline vial filled with bright cyan-blue liquid light,
protective dome hologram faintly projected from cap,
cool blue-white inner glow, electric arc detail on surface,
smooth aerospace design, defensive blue color scheme,
dark space background #080814, no text, square 512x512,
game consumable icon style, high contrast, digital illustration
```

---

### Hull Booster — «Усилитель прочности»

```
Sci-fi space game booster item icon, hull reinforcement booster,
robust armored vial with green-amber nanite fluid inside,
micro-plating texture on canister exterior, structural integrity circuit,
solid heavy design, warm green glow with amber highlights,
industrial rivet details, fortress-like silhouette,
dark space background #080814, no text, square 512x512,
game consumable icon style, high contrast, digital illustration
```

---

### XP Booster — «Усилитель опыта»

```
Sci-fi space game booster item icon, experience accelerator,
elegant vial with swirling golden-white luminescent energy inside,
star particle effects emanating from container,
pilot rank insignia etched on surface, bright gold-yellow glow,
ethereal shimmer, premium prestige appearance,
dark space background #080814, no text, square 512x512,
game consumable icon style, high contrast, digital illustration
```

---

## Иконка приложения (App Icon — Tauri desktop, taskbar/favicon)

Сейчас в `src-tauri/icons/` (корень репо — папка вынесена из `client/`, см.
IMPL_NOTES.md) стоит дефолтный логотип самого Tauri (заглушка
скаффолда, см. диалог "иконка которую ты выбрал" — на самом деле ничего не выбирал,
это stock-иконка фреймворка). Нужна настоящая иконка под "Stellar Drift".

**В отличие от предметных иконок выше** — эта должна читаться на **16×16/32×32**
(таскбар, папка, alt-tab), поэтому силуэт должен быть узнаваем БЕЗ деталей —
1-2 крупные формы, не мелкая графика/текстуры. Фон — **сплошной**, не прозрачный
(системная иконка — это плитка, не floating item), тёмный, в духе основного фона
игры (#080814 / глубокий космос). Квадрат 512×512 (Tauri сам генерит все нужные
размеры через `tauri icon`).

**Три принципа отбора:** несложная (читается на 16px), по смыслу (звёзды/дрифт/полёт,
не случайный sci-fi мотив), интересная (не банальный "космический корабль анфас").

---

### Вариант 1 — Корабль + след дрейфа

```
Minimalist app icon for a space game called "Stellar Drift", bold flat design,
single angular top-down starship silhouette in bright cyan (#4dd0e1) mid-turn,
one sweeping curved comet-like drift trail behind it fading to transparent,
solid dark background deep space navy (#080814), no text, no other details,
extremely simple bold shapes readable at 16px, high contrast silhouette,
square 512x512, flat vector icon style, no gradients on the ship itself,
subtle soft glow only on the trail
```

### Вариант 2 — Комета сквозь кольцо (джампгейт)

```
Minimalist app icon for a space game called "Stellar Drift", bold flat design,
a small bright star/comet with a long curved drift streak passing through
the center of a simple glowing ring (like a jumpgate), ring in warm amber (#ffb74d),
comet and streak in bright cyan (#4dd0e1), solid dark deep-space background (#080814),
no text, no stars/background clutter, two clean geometric shapes only,
extremely simple silhouette readable at 16px, high contrast,
square 512x512, flat vector icon style, subtle glow, no gradients on background
```

### Вариант 3 — Абстрактный дрейф-виток (буква/знак)

Выбран как финальный (2026-07-18). **Правка по фидбеку после первой генерации**:
хвост витка почти не виден (затухал в прозрачность), сам обвод местами читался
тонкой линией — именно то, от чего предостерегали принципы "читаемая на 16px".
Ниже — исправленная версия: **одинаковая толщина по всей длине**, хвост остаётся
полностью непрозрачным (не тает), просто чуть темнее по тону, а не по alpha.

```
Minimalist app icon for a space game called "Stellar Drift", bold flat design,
a single abstract swooshing orbital arc curling into a loose spiral like a drifting
comet trail, forming a shape reminiscent of the letter S, THICK uniform ribbon
stroke width from end to end (no tapering to a thin line or point anywhere),
fully opaque solid fill throughout — the trailing end must stay clearly visible
and bold, NOT fading to transparent or thinning out, only the color shifts along
the ribbon from emerald (#66bb6a) at the trailing end to bright cyan (#4dd0e1)
at the leading end, bright star/node glowing at the leading tip in cyan,
solid dark deep-space navy background (#080814), no text,
extremely simple bold silhouette clearly readable at 16px, high contrast,
square 512x512, flat vector icon style, subtle soft glow only at the star tip,
thick chunky proportions like a rounded ribbon, not a thin calligraphic line
```

### Вариант 4 — Прицел наведения (игровой HUD-мотив)

```
Minimalist app icon for a space game called "Stellar Drift", bold flat design,
a simple circular targeting reticle (crosshair with four short corner brackets,
like a lock-on HUD marker) in bright cyan (#4dd0e1), with one small bright star
drifting just off-center inside the ring, slight motion streak trailing the star,
solid dark deep-space navy background (#080814), no text, no clutter,
extremely simple bold geometric shapes readable at 16px, high contrast silhouette,
square 512x512, flat vector icon style, subtle glow only on the star and streak
```

### Вариант 5 — Планета с орбитальным дрейф-следом

```
Minimalist app icon for a space game called "Stellar Drift", bold flat design,
a small solid planet circle in cool slate-blue, encircled by a single thin
elliptical orbit ring, part of the ring rendered as a bright cyan (#4dd0e1)
comet-drift streak that fades out rather than a full closed line,
solid dark deep-space navy background (#080814), no text, no extra stars,
extremely simple two-shape silhouette readable at 16px, high contrast,
square 512x512, flat vector icon style, subtle soft glow only on the streak
```

---

## Примечания

- Все иконки: **без текста**, **чёрный/прозрачный фон**, квадрат 512×512
- Для игры нужен PNG с прозрачным фоном → при генерации указывать «transparent background» или удалять фон вручную
- Цветовая кодировка: T1=серый, T2=синий, T3=оранжевый, T4=фиолетовый (consistent с тирами модулей в UI)
- Бустеры: красный, синий, зелёный, золотой — стандартная RPG-кодировка + sci-fi подача
