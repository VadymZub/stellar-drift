# ЧАСТНАЯ БЕЗОПАСНОСТЬ — охрана нейтральных добывающих баз в PvP. Промты для 2 юнитов

Сейчас `sec_drone`/`sec_destroyer` (constants.js, faction:'security') используют
чужой арт — текстурные ключи `guard_drone`/`guard_main` (faction:'guard',
Конфедерация, охраняет нейтральные базы в обычных секторах). Разные фракции по
лору, одна картинка. Ниже — новые промты под СОБСТВЕННЫЙ арт "Частной
Безопасности": визуально отличимый от Конфедерации (та — чёрно-белая с бирюзой,
"официальная армия"), но не пиратский — корпоративный охранный подрядчик.

## Стиль

**Формат:** PNG 512×512, прозрачный фон
**Вид:** строго сверху (top-down), нос корабля направлен вниз
**Палитра:** тёмный гунметал (#2a2d33), угольно-серый (#1a1c20), янтарно-оранжевый
акцент (#ff9800) — цвет предупреждающей разметки охранного подрядчика, НЕ бирюза
(та зарезервирована за Конфедерацией) и НЕ красный (тот у корсаров-пиратов)
**Концепция:** частный охранный контрактор — чистые, функциональные, слегка
безликие корпоративные корпуса без вычурности военных или потрёпанности пиратов;
читается как "нанятая охрана", не государственная армия и не банда

Для Midjourney добавлять: `--ar 1:1 --stylize 700`

---

### sec_drone.png — Дрон охраны (Sentry Drone)

Роль: мелкий, быстрый рой-юнит вокруг баз · aiClass swarmDrone · displaySize 34

```
top-down 2D game sprite of a sci-fi private security sentry drone, compact
quad-nacelle turret-drone silhouette with four short symmetric engine pods
at the corners, central sensor-eye housing glowing amber-orange (#ff9800),
dark gunmetal (#2a2d33) and charcoal (#1a1c20) plating, clean minimal
corporate design with subtle hazard-stripe markings near the thrusters,
small stenciled security-contractor logo on the hull (abstract shield glyph,
no readable text), no battle damage, pristine well-maintained surface,
compact aggressive-but-tidy silhouette, top-down view, nose pointing downward,
no smoke, no exhaust trails, no engine combustion effects,
isolated on transparent background, painterly stylized sci-fi top-down RTS
unit art, AAA mobile game quality, no text, no characters --ar 1:1 --stylize 700
```

---

### sec_destroyer.png — Страж-Разрушитель (Sentinel Destroyer)

Роль: статичный мини-босс, охраняет нейтральные базы в PvP · bossType:'static' ·
displaySize 180

```
top-down 2D game sprite of a sci-fi private security static defense platform,
large heavy destroyer-class hull built like an armed corporate guard tower
mounted on a starship frame, wide symmetric wings each carrying a heavy
turret cluster, thick slab armor plating in dark gunmetal (#2a2d33) and
charcoal (#1a1c20), broad amber-orange (#ff9800) warning stripes across the
turret bases and engine cowlings, prominent central sensor dome glowing
amber, abstract shield-glyph insignia stenciled on both wings (no readable
text), clean well-maintained corporate-military hybrid design — imposing but
not scrappy, no rust, no battle scars, large intimidating size,
top-down view, nose pointing downward,
no smoke, no exhaust trails, no engine combustion effects,
isolated on transparent background, painterly stylized sci-fi top-down RTS
unit art, AAA mobile game quality, no text, no characters --ar 1:1 --stylize 700
```

---

## Примечания

- После генерации: сохранить как `sec_drone.png`/`sec_destroyer.png` в
  `client/assets/mobs/`, добавить загрузку в `BootScene.js` (рядом с
  `guard_drone`/`guard_main`), и заменить `key: 'guard_drone'` →
  `key: 'sec_drone'` / `key: 'guard_main'` → `key: 'sec_destroyer'` в
  `constants.js:314-315`.
- Разница с Конфедерацией (guard_drone/guard_main): та же общая "организованная
  охрана" ниша, но чёрно-белый+бирюза (гос. армия) vs. серый+янтарь (частный
  подрядчик) — не рескин, отдельная фракция должна читаться отдельной.
