# Rank Icon Prompts - Stellar Drift (Military Fleet Theme)

Стиль: **Sci-Fi Military Holographic UI**.
Цветовая палитра: **Cyan (0x4dd0e1)**, **Amber/Gold (0xffb74d)**, **Silver/Chrome**.

---

## Контекст отображения

Иконка ранга отображается **рядом с ником над кораблём** в игровом мире.
- Реальный размер в игре: **22 px**.
- Фон у иконки: **прозрачный PNG**.
- Blend mode в Phaser: `NORMAL`.
- Цветовой тинт кодом дифференцирует суб-ранги внутри тира.

### Требования к иконке
| Параметр | Значение |
|---|---|
| Форма для генерации | Квадрат 512×512 |
| Фон | **Прозрачный** (PNG с alpha) |
| Контур | Тёмный stroke 3–4 px — читаемость на любом фоне |
| Blend mode | `NORMAL` |

---

## Общий модификатор стиля (Base Prompt Modifier)
Добавлять к каждому промту:
> `... sci-fi military rank insignia, transparent background, no background, isolated icon, bold clean silhouette, dark stroke outline around all shapes, high contrast, flat design, no fine filigree details, readable at small size, 2D icon, game UI asset, 4k resolution, PNG with alpha channel.`

---

## Tier 1: Supreme Command (Ranks 1–3)
**Гранд-Адмирал (×1), Адмирал Флота (×4), Вице-Адмирал (×14)**
**Силуэт:** 8-конечная звезда — самая сложная форма, максимальный престиж.

### Prompt:
> `Space grand admiral rank insignia, bold eight-pointed star with thick rays, double concentric gold ring border, glowing amber core, bright gold and cyan color scheme, clean strong silhouette, dark outline stroke.`

---

## Tier 2: Admiralty (Ranks 4–5)
**Контр-Адмирал (top 1%), Коммодор (top 3%)**
**Силуэт:** Ромб с крыльями.

### Prompt:
> `Space fleet admiral rank badge, bold diamond shape with two symmetrical wings, thick gold border, glowing cyan center gem, silver wing plates, strong dark outline, clean geometric silhouette.`

---

## Tier 3: Senior Officers (Ranks 6–9)
**Капитан I ранга (top 5%), Капитан II ранга (top 10%), Капитан III ранга (top 15%), Командор (top 20%)**
**Силуэт:** Три вертикальных бара в рамке.

### Prompt:
> `Sci-fi senior officer rank icon, three bold vertical rectangular bars side by side, silver metallic bars, cyan glow between bars, rectangular frame border, strong dark outline, clean flat design.`

---

## Tier 4: Junior Officers (Ranks 10–13)
**Капитан-лейтенант (top 25%), Старший лейтенант (top 30%), Лейтенант (top 40%), Младший лейтенант (top 50%)**
**Силуэт:** Щит с горизонтальной полосой — чётко отличается от баров и шевронов.

### Prompt:
> `Military space officer rank badge, bold shield shape, single thick horizontal bar across the center of the shield, metallic surface, cyan accent line, strong dark outline, clean flat design, no chevron, no bars arrangement.`

---

## Tier 5: Senior NCO (Ranks 14–15)
**Мичман (top 60%), Главный старшина (top 70%)**
**Силуэт:** Две горизонтальных параллельных полосы "=" — мгновенно отличается от шевронов.

### Prompt:
> `Space fleet NCO rank insignia, two bold horizontal parallel bars equal sign shape, thick metallic stripes, teal cyan color, dark background plate, strong dark outline, flat minimal design, no chevron shape.`

---

## Tier 6: Junior NCO (Ranks 16–17)
**Старшина I статьи (top 80%), Старшина II статьи (top 90%)**
**Силуэт:** Двойной V-шеврон — две вложенных галочки.

### Prompt:
> `Space military rank insignia, two nested bold V-shaped chevrons, double chevron pointing down, thick metallic stripes, steel blue color, dark outline stroke, flat minimal design.`

---

## Tier 7: Enlisted (Ranks 18–20)
**Старший матрос (100%), Матрос (100%), Кадет (100%)**
**Силуэт:** Одиночный V-шеврон — самая простая форма.

### Prompt:
> `Space fleet recruit rank insignia, single bold V-shaped chevron, thick stroke, dark matte steel color, faint cyan edge glow, very simple geometric shape, strong dark outline, minimal flat icon.`

---

## Спецификация для экспорта
- **Количество иконок:** 7 (одна на тир).
- **Размер генерации:** 512×512, прозрачный фон (PNG с alpha).
- **Имена файлов:** `rank_tier1.png` … `rank_tier7.png` → папка `client/assets/ranks/`.
- **Blend mode в Phaser:** `NORMAL` (уже выставлен в коде).
- **Тинт:** код дифференцирует суб-ранги внутри тира — иконки одинаковые, цвет разный.

## Маппинг: ранг → тир
| Тир | Ранги | Форма |
|---|---|---|
| 1 | 1–3 | 8-конечная звезда |
| 2 | 4–5 | Ромб + крылья |
| 3 | 6–9 | 3 вертикальных бара |
| 4 | 10–13 | Щит с полосой |
| 5 | 14–15 | Двойная горизонтальная "=" |
| 6 | 16–17 | Двойной V-шеврон |
| 7 | 18–20 | Одиночный V-шеврон |
