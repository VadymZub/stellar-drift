# РОЙ — насекомоподобная раса. Промты для 9 кораблей-мобов

## Лор и роль в игре

**Название фракции:** Рой (The Swarm)  
**Внутренний код:** `corsair` (не меняем, чтобы не трогать спавн-логику)  
**Уровни:** 1–20 (начальная угроза для всех корпораций)  
**Зоны:** все три корпоративных коридора — Helios, Karax, Tides

### Кто они
Рой — биомеханическая раса, эволюционировавшая в поясах астероидов между корпоративными территориями.
Их корабли — не машины, а **живые организмы**: хитиновые экзоскелеты выполняют роль брони,
крылья и усики — сенсоры и маневровые органы. Никакого металла — только органика, усиленная
миллионами лет эволюции в вакууме.

Рой не имеет единого разума — каждый улей управляется Маткой (pirate_09).
Без Матки отряд распадается и действует хаотично (passive → aggressive при уроне).

### Роль в геймплее
- **Ранняя угроза** (ур. 1–20): первые враги, с которыми встречается игрок
- **Тактика роя**: слабые поодиночке, опасны числом — aiClass `gunner` / `dasher`
- **Нейтральны на стартовых планетах**: на helios_1/karax_1/tides_1 passive=true
- **Лут**: plasma-заряды, дешёвые T1–T2 модули, иногда биомех-материалы (rare)
- **Нарратив**: корпорации нанимают пилотов чистить астероидные пояса от Роя перед прокладкой маршрутов

### 3 подтверждённых ассета (уже будут нарисованы отдельно)
- **Рогатый жук** → pirate_06 (Жук-боец)
- **Стрекоза** → pirate_05 (Стрекоза-рейдер)
- **Муравей** → pirate_08 (Муравей-элита)

---

## Стиль всех промтов

**Формат:** PNG 512×512, прозрачный фон  
**Вид:** строго сверху (top-down), нос корабля направлен вверх  
**Палитра Роя:** хитин от тёмно-зелёного (#1b3a1b) до янтарно-жёлтого (#c8860a),
биолюминесцентные детали — кислотно-зелёный (#39ff14) и оранжевый (#ff6a00)  
**Стиль:** sci-fi organic bio-mechanical insect spaceship, top-down game sprite,
chitinous exoskeleton, alien hive aesthetic, painterly stylized, AAA mobile RTS unit art  

Для Midjourney добавлять: `--ar 1:1 --stylize 700`

---

## ПРОМТЫ

---

### pirate_01.png — Личинка (Larva Drone)
**Роль:** pirate_01 · ур. 1–5 · hull 60 · самый маленький, быстрый, слабый  
**Архетип насекомого:** личинка / мошка — бескрылое, вытянутое, примитивное

```
top-down 2D game sprite of an alien bio-mechanical insect spaceship, larva drone unit, small primitive chitinous slug-shaped hull, segmented worm-like body armor plating, two tiny mandible-like plasma emitters at the front, no wings, mottled dark green (#1b3a1b) and brown chitin with faint bioluminescent acid-green (#39ff14) stripe along spine, organic slimy texture, simple and small silhouette, isolated on transparent background, sci-fi organic hive alien aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, nose pointing downward, no smoke, no fog, no mist, no cotton, no clouds, no atmospheric effects, no ground shadow, pure transparency only, isolated on transparent background, no text, no characters --ar 1:1 --stylize 700
```

---

### pirate_02.png — Рабочий (Worker Ant Scout)
**Роль:** pirate_02 · ур. 3–8 · hull 90 · разведчик, средняя скорость  
**Архетип насекомого:** муравей-рабочий — три сегмента, шесть конечностей-дюз

```
top-down 2D game sprite of an alien bio-mechanical insect spaceship, ant worker scout unit, three-segmented chitinous body (head-thorax-abdomen), six short thruster-legs splayed outward, small rounded head with two antennae sensor stalks, dark olive-green (#2d4a1e) and amber (#c8860a) chitin panels, bioluminescent acid-green eyes (#39ff14), compact silhouette, medium-small size, organic plating with surface texture ridges, isolated on transparent background, sci-fi organic hive alien aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, nose pointing downward, no smoke, no fog, no mist, no cotton, no clouds, no atmospheric effects, no ground shadow, pure transparency only, isolated on transparent background, no text, no characters --ar 1:1 --stylize 700
```

---

### pirate_03.png — Оса (Wasp Fighter)
**Роль:** pirate_03 · ур. 5–12 · hull 120 · перехватчик с щитом  
**Архетип насекомого:** оса — тонкая талия, крылья, длинное жало

```
top-down 2D game sprite of an alien bio-mechanical insect spaceship, wasp fighter unit, narrow wasp-waist fuselage with segmented abdomen tapering to a sharp stinger cannon at the rear, two swept delta-wings formed from translucent chitin membrane with visible vein structure, forward-facing twin plasma mandibles, yellow-black (#c8860a and #1a1a1a) warning stripes on chitin armor, bioluminescent orange (#ff6a00) engine glow from wing roots, aggressive silhouette, medium size, isolated on transparent background, sci-fi organic hive alien aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, nose pointing downward, no smoke, no fog, no mist, no cotton, no clouds, no atmospheric effects, no ground shadow, pure transparency only, isolated on transparent background, no text, no characters --ar 1:1 --stylize 700
```

---

### pirate_04.png — Шершень (Hornet Skirmisher)
**Роль:** pirate_04 · ур. 7–15 · hull 100 · самый быстрый в роте, aiClass gunner  
**Архетип насекомого:** шершень — крупнее осы, агрессивный, мощные челюсти

```
top-down 2D game sprite of an alien bio-mechanical insect spaceship, hornet skirmisher unit, bulkier than a wasp with a massive armored head section housing large crushing mandible-cannons, broad thorax with two pairs of high-swept chitin wings angled backward for speed, thick abdomen with orange bioluminescent (#ff6a00) stripe segments, dark amber-brown (#8b5a00) and near-black (#1a1a1a) chitin plating, engine exhaust vents glowing orange along abdomen sides, fast and aggressive top-down silhouette, medium size, isolated on transparent background, sci-fi organic hive alien aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, nose pointing downward, no smoke, no fog, no mist, no cotton, no clouds, no atmospheric effects, no ground shadow, pure transparency only, isolated on transparent background, no text, no characters --ar 1:1 --stylize 700
```

---

### pirate_05.png — Стрекоза (Dragonfly Raider)
**Роль:** pirate_05 · ур. 8–18 · hull 160 · aiClass dasher — быстрые рывки  
**Архетип насекомого:** стрекоза — длинное тело, четыре крыла, фасеточные глаза  
⚠ Подтверждённый ассет (будет нарисован отдельно)

```
top-down 2D game sprite of an alien bio-mechanical insect spaceship, dragonfly raider unit, long slender body with four large iridescent chitin wings arranged in an X-pattern — two forward-swept and two rear-swept, elongated abdomen with segmented rings tapering to a tail thruster, enormous compound-eye sensor domes at the front glowing acid-green (#39ff14), teal-iridescent (#2a9d8f) and dark green (#1b3a1b) wing membranes with visible venation, fast elegant silhouette, medium size, isolated on transparent background, sci-fi organic hive alien aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, nose pointing downward, no smoke, no fog, no mist, no cotton, no clouds, no atmospheric effects, no ground shadow, pure transparency only, isolated on transparent background, no text, no characters --ar 1:1 --stylize 700
```

---

### pirate_06.png — Рогатый Жук (Horned Beetle Brawler)
**Роль:** pirate_06 · ур. 10–20 · hull 200 · тяжёлый боец, aiClass dasher  
**Архетип насекомого:** жук-носорог / рогатый жук — массивный, два рога-орудия  
⚠ Подтверждённый ассет (будет нарисован отдельно)

```
top-down 2D game sprite of an alien bio-mechanical insect spaceship, horned beetle brawler unit, massive wide rounded chitinous hull like a tank, two massive forward-facing horns serving as heavy plasma cannons, thick layered armor plates with deep surface grooves, short stubby wing covers (elytra) half-open revealing thruster vents underneath glowing orange (#ff6a00), dark forest-green (#1b3a1b) and near-black (#0d1a0d) carapace with amber (#c8860a) bioluminescent markings along edges, heavy imposing silhouette, large size, isolated on transparent background, sci-fi organic hive alien aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, nose pointing downward, no smoke, no fog, no mist, no cotton, no clouds, no atmospheric effects, no ground shadow, pure transparency only, isolated on transparent background, no text, no characters --ar 1:1 --stylize 700
```

---

### pirate_07.png — Паук-Охотник (Spider Gunship)
**Роль:** pirate_07 · ур. 12–20 · hull 240 · восемь орудий, aiClass dasher  
**Архетип насекомого:** паук — широкий, восемь ног-орудий по кругу

```
top-down 2D game sprite of an alien bio-mechanical insect spaceship, spider hunter gunship unit, wide round cephalothorax-shaped hull with eight articulated chitinous gun-legs extending radially outward each tipped with a plasma emitter, two large fang-like forward-facing main cannons, abdomen-shaped thruster pod at the rear, dark brown-black (#1a0f00) carapace with bioluminescent acid-green (#39ff14) eye-cluster at center and orange (#ff6a00) engine glow from abdomen, web-like surface texture on hull panels, broad intimidating silhouette, large size, isolated on transparent background, sci-fi organic hive alien aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, nose pointing downward, no smoke, no fog, no mist, no cotton, no clouds, no atmospheric effects, no ground shadow, pure transparency only, isolated on transparent background, no text, no characters --ar 1:1 --stylize 700
```

---

### pirate_08.png — Муравей-Солдат (Soldier Ant Elite)
**Роль:** pirate_08 · ур. 15–20 · hull 320 · elite · aiClass berserker  
**Архетип насекомого:** муравей-солдат — крупная голова с мощными жвалами  
⚠ Подтверждённый ассет (будет нарисован отдельно)

```
top-down 2D game sprite of an alien bio-mechanical insect spaceship, soldier ant elite unit, heavily armored three-segment body with disproportionately massive head section dominated by enormous crushing mandible-weapons, head strictly pointing downward, thick neck shield connecting head to thorax, six powerful thruster-legs, dark matte black (#0d0d0d) and deep red-brown (#3d1a00) chitin elite markings, acid-green (#39ff14) bioluminescent slits along mandibles charging with energy, battle-scarred carapace with impact dents and scratch marks, elite unit — largest and most intimidating ant silhouette, clean transparent background with absolutely nothing underneath the ship — no smoke, no fog, no mist, no cotton, no clouds, no atmospheric effects, no ground shadow, no debris, pure transparency only, isolated on transparent background, sci-fi organic hive alien aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, no text, no characters --ar 1:1 --stylize 700
```

---

### pirate_09.png — Матка (Hive Queen)
**Роль:** pirate_09 · ур. 15–20 · hull 700 · BOSS · bossType roaming · самый крупный  
**Архетип насекомого:** матка / королева — огромная, брюхо с яйцевыми камерами, свита

```
top-down 2D game sprite of an alien bio-mechanical insect spaceship, hive queen boss unit, massive elongated queen insect body — enormous swollen abdomen filled with glowing bioluminescent (#39ff14) egg-chambers visible through translucent chitin panels, broad thorax with four large layered wing-shields folded flat as armor, large regal head with crown-like chitinous protrusions and six sensor antennae, multiple weapon-limbs arranged along flanks, dark royal purple-black (#1a0a2e) and deep green (#1b3a1b) carapace with gold-amber (#c8860a) royal markings, intense orange (#ff6a00) engine glow from abdomen tip, massive imposing queen silhouette — clearly the largest and most complex unit, isolated on transparent background, sci-fi organic hive alien aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, nose pointing downward, no smoke, no fog, no mist, no cotton, no clouds, no atmospheric effects, no ground shadow, pure transparency only, isolated on transparent background, no text, no characters --ar 1:1 --stylize 700
```

---

## Имена в ru.json (заменить)

```json
"mob.pirate_01": "Личинка-дрон",
"mob.pirate_02": "Рабочий Роя",
"mob.pirate_03": "Оса-боец",
"mob.pirate_04": "Шершень",
"mob.pirate_05": "Стрекоза-рейдер",
"mob.pirate_06": "Рогатый жук",
"mob.pirate_07": "Паук-охотник",
"mob.pirate_08": "Муравей-солдат",
"mob.pirate_09": "МАТКА РОЯ"
```

## Порядок работы
1. Сгенерировать 6 новых спрайтов в Midjourney (01-04, 07, 09)
2. Получить готовые ассеты: стрекоза (05), рогатый жук (06), муравей (08)
3. Сохранить как `pirate_01.png` … `pirate_09.png` → `client/assets/mobs/`
4. Обновить displaySize в constants.js если нужна коррекция размеров
5. Обновить имена в ru.json
