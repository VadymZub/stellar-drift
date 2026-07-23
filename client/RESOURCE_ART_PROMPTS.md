# Промты для арта данж-ресурсов

Три новых ресурса, добываемых в данжах. Используются для крафта материалов и улучшения баффов гильдии.

| Ключ | Название ресурса | Материал | Тинт |
|---|---|---|---|
| `biomech_fragment` | Органит | Органит-ядро | `#b39ddb` фиолетовый |
| `quantum_shard` | Фазолит | Фазолит-кристалл | `#80ffff` циан |
| `plasma_strand` | Каленит | Каленит-катушка | `#ff8c00` оранжевый |

---

## Органит (biomech_fragment) — фиолетовый

### Спрайт на карте (world sprite, ~64–128px, отображается 40px)

```
A small glowing biomechanical crystal fragment floating above ground,
purple-violet color (#b39ddb), half-organic fleshy texture interwoven
with dark metallic crystal facets, bioluminescent purple veins pulsing
through the shard, soft violet glow emanating from within, dark dungeon
floor background, isolated on pure black, top-down space game asset,
stylized sci-fi, no shadow, bloom effect, 2D sprite
```

### Иконка в трюме (inventory icon, 64–96px, квадрат)

```
Sci-fi game inventory icon, biomechanical crystal shard "Organit",
jagged triangular fragment, purple-violet hue, surface texture mixing
dark organic muscle-like ridges with reflective metallic crystal planes,
glowing purple veins cutting through the material, inner bioluminescent
glow, black background, centered composition, detailed, no text,
fantasy RPG item icon style
```

---

## Фазолит (quantum_shard) — циан

### Спрайт на карте

```
A small glowing quantum crystal shard hovering slightly above ground,
bright cyan color (#80ffff), translucent facets with internal prismatic
refraction, microscopic fractures emit cyan-white light, edges blur into
spacetime distortion haze, surrounded by faint geometric interference
pattern, dark dungeon floor, isolated on pure black, top-down space game
asset, sci-fi stylized 2D sprite, no shadow, ethereal glow
```

### Иконка в трюме

```
Sci-fi game inventory icon, quantum phase crystal "Fazolite",
translucent cyan-white hexagonal shard with internal refraction,
light splits into spectral ribbons inside, thin geometric interference
rings float around it, edges partially dissolve into quantum foam,
black background, glowing cyan bloom, centered composition, detailed,
no text, clean sci-fi aesthetic
```

---

## Каленит (plasma_strand) — оранжевый

### Спрайт на карте

```
A small glowing mineral fragment lying on dungeon floor, bright
orange-amber color (#ff8c00), surface looks like red-hot forged metal
with deep cracks filled with molten light, like a piece of superheated
ore that never cools down, heat shimmer distortion around edges,
tiny ember sparks drifting upward, inner core white-hot fading to
deep amber-orange, isolated on pure black, top-down space game asset,
stylized sci-fi 2D sprite, no shadow, ember bloom effect
```

### Иконка в трюме

```
Sci-fi game inventory icon, superheated mineral shard "Kalenit",
jagged ore fragment that glows from within like red-hot metal,
surface texture of dark scorched rock split by glowing orange-white
molten cracks, heat haze around edges, sparks at sharp tips,
deep amber to white-hot gradient at core, black background,
orange-red bloom, centered square composition, detailed, no text,
industrial sci-fi style
```

---

# Промты для арт-объектов Арены

Два носимых объекта арены (режимы "Захват флага" / "Захват груза"). Тинт-варианты — по
цвету КОМАНДЫ матча (синий/красный, `ARENA_TEAM_COLOR` в constants.js), НЕ по
корпорации — арена принципиально некорповая.

| Ключ | Название | Объект | Тинт |
|---|---|---|---|
| `arena_flag_a` / `arena_flag_b` | Флаг команды | носимый флаг | `#2196f3` синий / `#f44336` красный |
| `arena_cargo` | Контейнер груза | носимый контейнер | нейтральный, подсветка по несущему |

---

## Флаг команды (arena_flag) — синий / красный

### Спрайт на карте (world sprite, ~64–96px, отображается 48px)

```
Top-down floating team banner beacon for a sci-fi space arena, a compact
hovering flag pylon: a slim metallic mast with a taut glowing energy
pennant streaming to one side, pennant emits bright team-blue light
(#2196f3), thin holographic edge, small anti-grav base ring pulsing
underneath, subtle particle drift, isolated on pure black, no text,
stylized sci-fi 2D sprite, no shadow, crisp bloom, 256x256 PNG transparent
```

Красный вариант — идентичен, заменить team-blue (`#2196f3`) на team-red (`#f44336`).

### Иконка в трюме (inventory icon, 64–96px, квадрат)

```
Sci-fi game inventory icon, captured objective flag, folded energy
pennant on a short metallic mast, glowing team-blue banner cloth of
pure light, holographic trim, centered composition, black background,
blue bloom, detailed, no text, clean competitive-shooter objective icon
style
```

Красный вариант — заменить blue на red (`#f44336`).

---

## Контейнер груза (arena_cargo) — нейтральный

### Спрайт на карте

```
Top-down floating loot container for a sci-fi space game. Compact sealed
cargo pod, metallic grey-blue hull, orange hazard stripe across the
center, small glowing yellow-green status indicator light, faint
anti-grav glow underneath. No text. 256x256 PNG transparent background,
stylized sci-fi 2D sprite, no shadow, soft bloom.
```

### Иконка в трюме

```
Sci-fi game inventory icon, sealed cargo objective pod, metallic
grey-blue hull with orange hazard stripe and a single glowing status
light, reinforced corner clamps, centered square composition, black
background, subtle rim glow, detailed, no text, industrial sci-fi style.
```
