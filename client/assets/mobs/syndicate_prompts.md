# СИНДИКАТ — организованная преступность. Промты для 11 кораблей

## Лор и роль

**Фракция:** Синдикат (The Syndicate)  
**Внутренний код:** `syndicate_01` … `syndicate_11`  
**Уровни:** 10–25 (элитные противники средне-высокого уровня)  
**Зоны:** нейтральные секторы, PvP-зоны, высокоуровневые коридоры

Синдикат — теневая корпорация, торгующая оружием, информацией и технологиями.
Их корабли — не самодел как у Корсаров, а прецизионная техника: контрабандные версии
корпоративных разработок, дооснащённые дальнобойными системами, ЭМИ-оружием и минами.
Они не дерутся в ближнем бою — они уничтожают цель раньше, чем та успеет ответить.

**Тактика:** атака с максимальной дистанции → минное заграждение → отступление.  
**Особенности:** дальнобойные рельсотроны, противощитные ЭМИ-мины, невидимые дроны-разведчики.

---

## Стиль всех промтов

**Формат:** PNG 512×512, прозрачный фон  
**Вид:** строго сверху (top-down), нос корабля направлен вниз  
**Палитра:** матовый антрацит (#0d0d0d), хром (#a0a0b0), неоновый электросиний (#00d4ff), фиолетовый (#7b00ff)  
**Стиль:** sleek corporate-crime military spacecraft, sharp geometric angular design, hidden weapon bays,
precision-engineered, sci-fi top-down game sprite, painterly stylized, AAA mobile RTS unit art

Для ChatGPT: `transparent background, top-down view, nose pointing downward, no smoke, no fog, no exhaust trails, no atmospheric effects, pure transparency only`

---

## ПРОМТЫ

---

### syndicate_01.png — Дрон-наблюдатель (Eye Drone)
Роль: разведчик · ур. 10–14 · hull 80 · нейтрален пока не атакован

```
top-down 2D game sprite of a sci-fi syndicate surveillance drone ship, tiny flat hexagonal disc-shaped hull with a central sensor eye glowing electric blue (#00d4ff), six small stabilizer fins at equal angles, matte anthracite (#0d0d0d) surface with chrome (#a0a0b0) edge trim, no visible weapons — threat is in what it sees, ultra-minimal silhouette, small size, top-down view, nose pointing downward, no smoke, no fog, no exhaust trails, no atmospheric effects, pure transparency only, isolated on transparent background, sleek corporate-crime sci-fi aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, no text, no characters
```

---

### syndicate_02.png — Снайпер (Rail Sniper)
Роль: дальнобойный · ур. 12–18 · hull 100 · aiClass sniper — атакует с края карты

```
top-down 2D game sprite of a sci-fi syndicate long-range sniper ship, extremely elongated needle-thin hull dominated by a massive electromagnetic railgun barrel running the full length of the ship, tiny compact engine pod at the rear, two small stabilizer wings mid-ship to counteract recoil, matte anthracite (#0d0d0d) hull with electric blue (#00d4ff) capacitor rings glowing along the railgun barrel indicating charge, chrome reinforcement ribs, minimal cross-section designed to be hard to hit from front, medium-small size, top-down view, nose pointing downward, no smoke, no fog, no exhaust trails, no atmospheric effects, pure transparency only, isolated on transparent background, sleek corporate-crime sci-fi aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, no text, no characters
```

---

### syndicate_03.png — Тень (Shadow Interceptor)
Роль: быстрый убийца · ур. 12–20 · hull 120 · aiClass dasher

```
top-down 2D game sprite of a sci-fi syndicate stealth interceptor ship, angular swept-wing design with faceted radar-absorbing hull panels, sharp chevron planform with serrated trailing edges, retractable weapon pods flush with the hull surface, deep matte black (#050505) with subtle purple (#7b00ff) iridescent shimmer on panel edges suggesting stealth coating, single narrow blue-lit cockpit slit, two concealed engine exhausts flush with the rear, sinister and elegant silhouette, medium size, top-down view, nose pointing downward, no smoke, no fog, no exhaust trails, no atmospheric effects, pure transparency only, isolated on transparent background, sleek corporate-crime sci-fi aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, no text, no characters
```

---

### syndicate_04.png — Минный заградитель (Mine Layer)
Роль: раскладывает мины · ур. 14–20 · hull 140 · aiClass support

```
top-down 2D game sprite of a sci-fi syndicate mine-laying ship, wide flat trapezoidal hull with two large side-mounted mine dispensers visible as recessed bays with sliding doors, multiple cylindrical anti-shield EMP mines visible in open bays ready for deployment, bulky mid-section housing the mine magazine, two rear engine pods, matte anthracite (#0d0d0d) with electric blue (#00d4ff) warning chevrons around the mine bay openings, chrome utility conduits running along the hull, purposeful industrial military silhouette, medium-large size, top-down view, nose pointing downward, no smoke, no fog, no exhaust trails, no atmospheric effects, pure transparency only, isolated on transparent background, sleek corporate-crime sci-fi aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, no text, no characters
```

---

### syndicate_05.png — ЭМИ-мина (EMP Shield Mine)
Роль: статичный объект · триггер при сближении · уничтожает щит

```
top-down 2D game sprite of a sci-fi syndicate anti-shield EMP mine, small flat octagonal disc with a pulsing electric blue (#00d4ff) central emitter core surrounded by eight short spike antennas radiating outward, purple (#7b00ff) electromagnetic field lines etched into the surface suggesting shield-disruption payload, chrome casing with warning stripe markings, subtle glow around the perimeter indicating active armed state, no propulsion — static object, small compact design, top-down view, nose pointing downward, no smoke, no fog, no atmospheric effects, pure transparency only, isolated on transparent background, sleek corporate-crime sci-fi aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, no text, no characters
```

---

### syndicate_05b.png — Направленная мина (Directed Charge)
Роль: статичный объект · при срабатывании выпускает сфокусированный бронебойный импульс в одном направлении · эффективна против корпуса, не щита

Лор: Синдикат разработал направленные мины для уничтожения кораблей с тяжёлой бронёй — они не рассеивают энергию взрыва сферически, а концентрируют его в конус через нижний шип-усилитель. Один удар способен пробить корпус любого фрейтера.

```
top-down 2D game sprite of a sci-fi syndicate directed-charge armor-piercing mine, angular diamond-shaped dark gunmetal (#0d0d0d) casing with sharp faceted edges, five electric blue (#00d4ff) energy capacitor nodes arranged on the front face indicating charge state, a prominent downward-pointing spike at the bottom acting as the directional focusing emitter that concentrates the blast into a piercing cone, purple (#7b00ff) hazard chevrons on the side panels, chrome edge reinforcement, the overall shape suggests directionality — top is trigger, bottom is weapon, small-medium size, top-down view, no smoke, no fog, no atmospheric effects, pure transparency only, isolated on transparent background, sleek corporate-crime sci-fi aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, no text, no characters
```

---

### syndicate_05b-1.png — Импульсная мина (Stun Pulse Mine)
Роль: статичный объект · при срабатывании выдаёт ЭМИ-импульс в радиусе · глушит двигатели и оружие на 3 сек · урона по корпусу не наносит

Лор: Специализированная мина для захвата, а не уничтожения. Синдикат использует их при абордажных операциях — парализованный корабль становится лёгкой добычей. Горизонтальный разряд проходит по всем системам одновременно, вызывая короткое замыкание без детонации реактора.

```
top-down 2D game sprite of a sci-fi syndicate stun-pulse EMP mine, compact symmetric rounded-hexagonal dark gunmetal (#0d0d0d) casing, four electric blue (#00d4ff) capacitor nodes arranged in a square pattern on the top face, a horizontal electric discharge ring visible around the equator of the mine glowing blue-white where the EMP pulse radiates outward, no directional spike — perfectly symmetric indicating area-effect not directed blast, purple (#7b00ff) circuit-trace markings etched into the surface panels, chrome edges, clearly engineered for precision non-lethal disruption, small-medium size, top-down view, no smoke, no fog, no atmospheric effects, pure transparency only, isolated on transparent background, sleek corporate-crime sci-fi aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, no text, no characters
```

---

### syndicate_06.png — Подавитель (ECM Suppressor)
Роль: отключает щиты/навигацию · ур. 14–20 · hull 160 · aiClass gunner

```
top-down 2D game sprite of a sci-fi syndicate electronic warfare ship, wide oblong hull covered in directional jamming antenna arrays and dish emitters pointed forward, central spine housing a powerful ECM reactor core glowing purple (#7b00ff), flanking secondary hulls each carrying a jamming dish, four short stabilizer fins, light point-defense guns for self-protection only, dark anthracite (#0d0d0d) and chrome hull panels, electric blue (#00d4ff) sensor apertures along the nose, medium size, top-down view, nose pointing downward, no smoke, no fog, no exhaust trails, no atmospheric effects, pure transparency only, isolated on transparent background, sleek corporate-crime sci-fi aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, no text, no characters
```

---

### syndicate_07.png — Каратель (Enforcer Gunship)
Роль: средний боец · ур. 16–22 · hull 200 · aiClass gunner

```
top-down 2D game sprite of a sci-fi syndicate enforcer gunship, angular box-like armored hull with two heavy long-barrel plasma cannons mounted on cheek sponsons flanking the nose, thick layered angular armor panels with sharp edges, no curves anywhere — purely geometric faceted design, matte anthracite (#0d0d0d) primary armor with electric blue (#00d4ff) lit weapon ports and power conduits, chrome sensor cluster at the nose center, four main engine pods in a square arrangement at the rear, medium-large size, top-down view, nose pointing downward, no smoke, no fog, no exhaust trails, no atmospheric effects, pure transparency only, isolated on transparent background, sleek corporate-crime sci-fi aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, no text, no characters
```

---

### syndicate_08.png — Дальнобойный крейсер (Long-Range Cruiser)
Роль: тяжёлый снайпер · ур. 18–24 · hull 280 · aiClass sniper

```
top-down 2D game sprite of a sci-fi syndicate long-range bombardment cruiser, long sleek cruiser hull with two massive dual-barrel railgun turrets mounted fore and aft on the centerline, secondary point-defense gun turrets along the flanks, wide stable platform hull for precision fire, angular shield projectors on port and starboard, deep matte black (#050505) hull with chrome structural frames visible, electric blue (#00d4ff) glowing capacitor banks along both railgun assemblies, large sensor dome on the bow for long-range targeting, large size, top-down view, nose pointing downward, no smoke, no fog, no exhaust trails, no atmospheric effects, pure transparency only, isolated on transparent background, sleek corporate-crime sci-fi aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, no text, no characters
```

---

### syndicate_09.png — Призрак-убийца (Ghost Assassin)
Роль: elite · ур. 20–25 · hull 180 · aiClass dasher · невидим пока не атакует

```
top-down 2D game sprite of a sci-fi syndicate elite ghost assassin ship, ultra-thin razor-flat hull barely visible edge-on, semi-translucent stealth panels with a mirror-like chrome finish that blends into space, extreme swept-back delta-wing form with no vertical profile, single precision heavy sniper cannon along the centerline, purple (#7b00ff) active cloaking emitter rings along the hull perimeter creating subtle distortion lines, electric blue (#00d4ff) weapon charge indicator at the muzzle, sinister barely-there silhouette, medium size, top-down view, nose pointing downward, no smoke, no fog, no exhaust trails, no atmospheric effects, pure transparency only, isolated on transparent background, sleek corporate-crime sci-fi aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, no text, no characters
```

---

### syndicate_10.png — Командор (Syndicate Commander)
Роль: elite командир · ур. 22–25 · hull 400 · усиливает союзников

```
top-down 2D game sprite of a sci-fi syndicate commander warship, imposing symmetrical capital warship with a wide aggressive stance, large central command bridge tower with panoramic sensor arrays, four heavy gun turrets in diamond arrangement, two long-range railgun barrels extending beyond the nose, flanking secondary hulls with point-defense clusters, matte anthracite (#0d0d0d) and chrome hull, electric blue (#00d4ff) running lights tracing the entire hull perimeter, purple (#7b00ff) command-rank insignia panels, large size, top-down view, nose pointing downward, no smoke, no fog, no exhaust trails, no atmospheric effects, pure transparency only, isolated on transparent background, sleek corporate-crime sci-fi aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, no text, no characters
```

---

### syndicate_11.png — Владыка Синдиката (Syndicate Overlord)
Роль: BOSS · bossType roaming · ур. 22–25 · hull 900+

```
top-down 2D game sprite of a sci-fi syndicate overlord flagship boss ship, colossal fortress-class warship — wide hexagonal command platform bristling with weapon systems, six heavy twin railgun emplacements arranged around the perimeter each with glowing electric blue (#00d4ff) charging rings, central raised command citadel with full sensor sphere, four long-range cannon spines extending outward from the corners like a crown, mine dispenser bays open along the flanks, deep matte black (#050505) with chrome structural skeleton visible through armor gaps, purple (#7b00ff) syndicate crest illuminated on the command tower, massive and undeniably powerful silhouette — clearly the apex predator of the faction, top-down view, nose pointing downward, no smoke, no fog, no exhaust trails, no atmospheric effects, pure transparency only, isolated on transparent background, sleek corporate-crime sci-fi aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, no text, no characters
```

---

## Имена в ru.json

```json
"mob.syndicate_01": "Дрон-наблюдатель",
"mob.syndicate_02": "Снайпер",
"mob.syndicate_03": "Тень",
"mob.syndicate_04": "Минный заградитель",
"mob.syndicate_05": "ЭМИ-мина",
"mob.syndicate_06": "Подавитель",
"mob.syndicate_07": "Каратель",
"mob.syndicate_08": "Дальнобойный крейсер",
"mob.syndicate_09": "Призрак-убийца",
"mob.syndicate_10": "Командор",
"mob.syndicate_11": "ВЛАДЫКА СИНДИКАТА"
```

## Порядок работы
1. Сгенерировать 11 спрайтов в ChatGPT / Midjourney
2. Сохранить как `syndicate_01.png` … `syndicate_11.png` → `client/assets/mobs/`
3. Добавить моб-шаблоны в `constants.js`
4. Прописать спавн в нужных секторах через `galaxy.js`
5. Обновить имена в `ru.json`
