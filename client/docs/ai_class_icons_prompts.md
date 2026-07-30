# AI-Class Icon Prompts — Stellar Drift

Маленькие иконки поведения моба рядом с неймплейтом (см. `Mob.js` — `AI_CLASS_ICON`
маппинг, диалог: "иконка AI-класса моба... нужны реальные иконки, эмодзи не подходят").

**v2 — переписано.** Первая версия скопировала стиль крупных перк-иконок (тёмный бейдж +
светящееся кольцо + трещины) — этот стиль физически не может остаться читаемым при
уменьшении до ~18px в неймплейте: кольцо и трещины превращаются в шум, силуэт съедается.
Здесь — противоположный подход: **один жирный плоский силуэт, залитый цветом, без
кольца, без бейджа, без трещин, без мелкой текстуры**. Похоже на favicon/значок статуса
в мобильной игре, не на painterly-бейдж.

Формат: **PNG, 512×512, прозрачный фон**, силуэт занимает бо́льшую часть кадра (не
маленький значок посреди пустого поля — при уменьшении пустое поле съедает и так
небольшой объект).

## Общий суффикс (добавлять к каждому промту)
> `... flat solid single-color silhouette icon, thick bold rounded shape filling most of the frame, NO ring, NO badge, NO circular border, NO cracks, NO fine texture, NO gradient detail, extremely minimal geometric design, mobile game status/minimap icon style, crisp hard edges, isolated on pure black transparent background, no characters, no text, no letters, no words, 512x512, high contrast --ar 1:1 --stylize 250`

Ключ файла — `assets/ui/ai_icon_<key>.png`, куда `<key>` = значение `aiClass` в
`constants.js` (MOBS). `--stylize 250` (было 650) — намеренно ниже, чтобы модель меньше
"украшала" и не добавляла обратно детали, которых мы просим избежать.

---

| Ключ (`ai_icon_<key>`) | Класс | Цвет | Метафора (одна плоская форма) |
|---|---|---|---|
| `dasher` | Рывковый (сближается на скорости) | оранжевый | один жирный треугольник-шеврон `>` |
| `berserker` | Ярость при низком HP | красный | простой сжатый кулак, плоский силуэт |
| `shielder` | Щитовая аура на союзников | синий | простой геральдический щит, залитый цветом |
| `cloaker` | Телепорт/стелс за спину | фиолетовый | простой силуэт-капля/призрак, ровный контур |
| `sniper` | Держит дистанцию, отступает при сближении | тёмно-серый/белый | простой прицельный крест (перекрестие), плоские линии |
| `directedMine` | Направленная мина (конус) | янтарный | простой равнобедренный треугольник-конус с точкой на вершине |
| `stunMine` | Мина оглушения (EMP) | голубой | одна жирная молния (как значок заряда батареи) |
| `swarmDrone` | Дрон роя | зелёный | три жирные точки, слитые треугольником |
| `bomb` | Подрывник (детонирует у цели) | красно-чёрный | простой круг + короткий изогнутый фитиль |

```
flat solid single-color silhouette icon of a bold sharp chevron arrow pointing right (speed/rush symbol), thick bold rounded shape filling most of the frame, NO ring, NO badge, NO circular border, NO cracks, NO fine texture, NO gradient detail, extremely minimal geometric design, mobile game status/minimap icon style, crisp hard edges, vibrant orange color, isolated on pure black transparent background, no characters, no text, no letters, no words, 512x512, high contrast --ar 1:1 --stylize 250
```

```
flat solid single-color silhouette icon of a simple clenched fist, thick bold rounded shape filling most of the frame, NO ring, NO badge, NO circular border, NO cracks, NO fine texture, NO gradient detail, extremely minimal geometric design, mobile game status/minimap icon style, crisp hard edges, vibrant red color, isolated on pure black transparent background, no characters, no text, no letters, no words, 512x512, high contrast --ar 1:1 --stylize 250
```

```
flat solid single-color silhouette icon of a simple heraldic shield shape, thick bold rounded shape filling most of the frame, NO ring, NO badge, NO circular border, NO cracks, NO fine texture, NO gradient detail, extremely minimal geometric design, mobile game status/minimap icon style, crisp hard edges, vibrant blue color, isolated on pure black transparent background, no characters, no text, no letters, no words, 512x512, high contrast --ar 1:1 --stylize 250
```

```
flat solid single-color silhouette icon of a simple ghost/droplet shape with a smooth rounded top and a soft pointed base, thick bold rounded shape filling most of the frame, NO ring, NO badge, NO circular border, NO cracks, NO fine texture, NO gradient detail, extremely minimal geometric design, mobile game status/minimap icon style, crisp hard edges, vibrant violet color, isolated on pure black transparent background, no characters, no text, no letters, no words, 512x512, high contrast --ar 1:1 --stylize 250
```

```
flat solid single-color silhouette icon of a simple bold crosshair/reticle symbol (a circle with four short perpendicular tick lines), thick bold rounded shape filling most of the frame, NO ring, NO badge, NO circular border, NO cracks, NO fine texture, NO gradient detail, extremely minimal geometric design, mobile game status/minimap icon style, crisp hard edges, light gray-white color, isolated on pure black transparent background, no characters, no text, no letters, no words, 512x512, high contrast --ar 1:1 --stylize 250
```

```
flat solid single-color silhouette icon of a simple narrow isoceles triangle cone shape with a small dot at its tip, thick bold rounded shape filling most of the frame, NO ring, NO badge, NO circular border, NO cracks, NO fine texture, NO gradient detail, extremely minimal geometric design, mobile game status/minimap icon style, crisp hard edges, vibrant amber color, isolated on pure black transparent background, no characters, no text, no letters, no words, 512x512, high contrast --ar 1:1 --stylize 250
```

```
flat solid single-color silhouette icon of a single bold lightning bolt (like a battery charge symbol), thick bold rounded shape filling most of the frame, NO ring, NO badge, NO circular border, NO cracks, NO fine texture, NO gradient detail, extremely minimal geometric design, mobile game status/minimap icon style, crisp hard edges, vibrant cyan color, isolated on pure black transparent background, no characters, no text, no letters, no words, 512x512, high contrast --ar 1:1 --stylize 250
```

```
flat solid single-color silhouette icon of three bold circles connected in a tight triangle cluster, thick bold rounded shape filling most of the frame, NO ring, NO badge, NO circular border, NO cracks, NO fine texture, NO gradient detail, extremely minimal geometric design, mobile game status/minimap icon style, crisp hard edges, vibrant green color, isolated on pure black transparent background, no characters, no text, no letters, no words, 512x512, high contrast --ar 1:1 --stylize 250
```

```
flat solid single-color silhouette icon of a simple round bomb shape with one short curved fuse line, thick bold rounded shape filling most of the frame, NO ring, NO badge, NO circular border, NO cracks, NO fine texture, NO gradient detail, extremely minimal geometric design, mobile game status/minimap icon style, crisp hard edges, vibrant red color, isolated on pure black transparent background, no characters, no text, no letters, no words, 512x512, high contrast --ar 1:1 --stylize 250
```
