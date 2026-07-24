# Щит-дрон (Shield Reflector Drone) — расходник, промты для арта

Расходник из магазина: активируется с action bar, спавнит рядом с кораблём
владельца видимого всем дрона-отражателя (щит 15 000 / прочность 10 000, без
оружия, перенаправляет 90% урона с владельца на себя). Дизайн см. в roadmap
(shield-drone секция). Нужны ДВА арта:

1. **Иконка расходника** (магазин/инвентарь/action bar) — по стилю остальных
   `CONSUMABLES` в `ICON_PROMPTS.md` (флакон/капсула-контейнер).
2. **Мировой спрайт дрона** — видимая в игре сущность top-down, по стилю
   `client/assets/mobs/*_prompts.md` (нос вниз, прозрачный фон).

**Цветовая идентичность:** электрик-циан/голубой энергетический щит + светлый
хром/серебро на корпусе — читается как "щит", НЕ пересекается с зарезервированными
цветами фракций (бирюза+ч/б — Конфедерация, янтарь — частная охрана, красный —
пираты). Мотив "отражатель" — зеркальные/хромированные грани, никакого оружия
на модели.

---

## 1. Иконка расходника — `consumable_shield_drone.png`

**Формат:** PNG 512×512, тёмный фон #080814, квадрат — как остальные консьюмабл-иконки

```
Sci-fi space game consumable item icon, deployable shield-drone capsule,
compact chrome-silver launch pod with a small folded drone visible inside a
transparent energy-blue canopy, bright cyan-electric glow emanating from the
core, hexagonal shield-projector emblem etched on the capsule surface,
mirrored reflective metal plating, faint holographic dome projection hovering
above the pod, cool blue-white inner light, sleek defensive-tech design,
dark space background #080814, no text, square 512x512,
game consumable icon style, high contrast, digital illustration
```

---

## 2. Мировой спрайт — `shield_drone.png`

**Вид:** строго сверху (top-down), нос дрона направлен вниз (как остальные мобы/юниты)
**Роль:** видимая всем сущность-щит без оружия, зависает рядом с кораблём владельца

```
top-down 2D game sprite of a small sci-fi shield-reflector support drone,
compact rounded chrome-silver hull with mirrored reflective panels, no visible
weapons or turrets, central hexagonal shield-projector core glowing bright
cyan-electric blue, thin translucent energy-dome ring faintly visible around
the drone's perimeter, smooth aerospace defensive-tech design, clean
well-maintained ally-drone silhouette (not military, not corporate-hostile),
subtle silver piping and light-blue accent lines, no hazard stripes,
no battle damage, pristine polished surface, top-down view, nose pointing
downward, no smoke, no exhaust trails, no engine combustion effects,
isolated on transparent background, painterly stylized sci-fi top-down RTS
unit art, AAA mobile game quality, no text, no characters --ar 1:1 --stylize 700
```

---

## Примечания

- После генерации: `consumable_shield_drone.png` → `client/assets/consumables/`
  (добавить загрузку в `BootScene.js` рядом с остальными `consumable_*`,
  паттерн `consumable_${item.type}` в `items.js`); `shield_drone.png` →
  `client/assets/consumables/` или новый подкаталог, загрузка как обычная
  игровая сущность (аналогично мобам/дронам охраны в `BootScene.js`).
- Мировой спрайт должен визуально читаться как "нейтральный ally-объект", не
  моб — не путать с `guard_drone`/`sec_drone` (те — вражеские/охранные фракции
  с другой палитрой).
