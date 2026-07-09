# БОЕВЫЕ ЗВУКИ — промты для генерации SFX (16 файлов)

## Контекст

Сейчас в игре нет звука вообще — ни одного `this.sound.play()` во всём клиенте.
Ниже — минимальный набор под выстрелы/попадания/взрывы/эффекты, покрывающий бой
игрок↔моб. Код (`SoundManager.js` + вызовы в `GameScene.js`/`Mob.js`) уже
подключён по этой конвенции имён — просто положить готовые файлы в
`client/assets/sfx/<key>.mp3` (или `.ogg`), больше никаких правок не нужно:
`BootScene` загружает их по списку ключей, и если файла нет — просто тихо
пропускает (игра не ломается, звука не будет, ошибок в консоли — не будет).

## Стиль всех промтов

**Формат:** MP3/OGG, 44.1kHz, моно или стерео, без клиппинга, с небольшим
запасом по громкости (peak ~-6dB) — микс на клиенте не делает нормализацию.
**Длительность:** короткие one-shot (0.1–0.6с) для выстрелов/попаданий,
средние (0.5–1.2с) для взрывов, `low_hp_warning` — луп 1–2с.
**Общий характер:** синтетическая sci-fi эстетика (не реалистичное огнестрельное
оружие) — тональные/синтезированные текстуры, а не сэмплы реального оружия.
Ничего низкочастотно-грязного/шумного — чистые, читаемые в миксе звуки, чтобы
не сливались друг с другом при частой стрельбе.

Для генератора (ElevenLabs Sound Effects / аналог): каждый промт — цельное
описание одним абзацем, без разметки внутри.

---

## ПРОМТЫ

---

### sfx_cannon_fire.mp3 — Выстрел пушки (игрок)
Роль: каждый выстрел плазменной пушки игрока · `_fireCannon`

```
a short punchy sci-fi plasma cannon shot, synthetic low-mid "thump" with a bright
tonal crack on top, quick attack and fast decay, energetic and satisfying, no
reverb tail, clean single shot, 0.15 seconds, video game weapon sound effect
```

---

### sfx_laser_fire.mp3 — Выстрел лазера (игрок)
Роль: каждый выстрел лазера игрока · `_fireLaser`

```
a short crisp sci-fi laser beam sound, high-pitched tonal sweep with a metallic
zap, instant and precise, thinner and brighter than a cannon shot, very short
tail, 0.12 seconds, video game weapon sound effect
```

---

### sfx_weapon_miss.mp3 — Промах
Роль: выстрел не попал (пушка/лазер) · тише и глуше обычного выстрела

```
a short muffled whiff sound of an energy weapon shot going wide, quieter and
duller than a direct hit sound, quick fading synthetic swish, no impact, 0.15
seconds, video game sound effect
```

---

### sfx_hit_shield.mp3 — Попадание по щиту
Роль: урон приходит по щиту (игрок или моб) · `hitFlash(toHull=false)`

```
a short bright synthetic energy-shield impact sound, glassy ping with a subtle
electric ripple, cool and light in tone, quick decay, no low-end thump, 0.2
seconds, sci-fi video game sound effect
```

---

### sfx_hit_hull.mp3 — Попадание по корпусу
Роль: урон приходит по корпусу (игрок или моб) · `hitFlash(toHull=true)`

```
a short heavy metallic impact sound with a synthetic sci-fi edge, duller and
lower-pitched than a shield hit, a brief clang with light debris crackle, no
explosion, quick decay, 0.2 seconds, video game sound effect
```

---

### sfx_crit.mp3 — Критический удар
Роль: крит игрока (пушка/лазер) или крит босса по игроку · накладывается
поверх `sfx_hit_hull`

```
a short sharp high-energy "sting" sound layered on top of an impact, a quick
bright metallic zing with a rising pitch flick, signals a especially powerful
hit, punchy and exciting, 0.25 seconds, video game critical-hit sound effect
```

---

### sfx_mob_fire_plasma.mp3 — Выстрел моба (plasma/стандартный)
Роль: обычный выстрел рядового моба · `fireMobWeapon` (plasma/ion/acid/grav)

```
a short synthetic alien blaster shot, slightly rougher and more organic-sounding
than a clean human weapon, mid-pitched pulse with a faint growl, quick decay,
0.15 seconds, sci-fi enemy weapon sound effect
```

---

### sfx_mob_fire_hitscan.mp3 — Выстрел-хитскан (void)
Роль: мгновенный луч (void-тип, боссы/элита) · `fireMobWeapon` (hitscan)

```
a short ominous instant energy beam sound, deep purple-toned synthetic zap with
a faint dissonant harmonic, heavier and more threatening than a normal blaster,
very short, 0.12 seconds, sci-fi boss weapon sound effect
```

---

### sfx_explosion_small.mp3 — Взрыв рядового моба
Роль: гибель обычного моба · `onMobKilled` (не босс)

```
a short compact sci-fi explosion, quick bright burst with a crackling synthetic
tail, small-scale destruction, punchy but not overwhelming, 0.5 seconds, video
game death explosion sound effect
```

---

### sfx_explosion_boss.mp3 — Взрыв босса
Роль: гибель босса/элиты · `onMobKilled` (isBoss)

```
a large dramatic sci-fi explosion, deep bass thump followed by a bright crackling
shockwave, layered with a subtle low rumble tail, powerful and satisfying, feels
like a significant kill, 1.1 seconds, video game boss death sound effect
```

---

### sfx_player_death.mp3 — Гибель игрока
Роль: смерть игрока · `onPlayerKilled`

```
a dramatic descending sci-fi ship destruction sound, a sharp initial impact
followed by a falling pitch synthetic wail and a soft explosion tail, feels
final and heavy without being harsh, 1.0 seconds, video game player-death sound
effect
```

---

### sfx_dodge.mp3 — Уклонение
Роль: `res.dodged === true` · `showDodge`

```
a short quick whoosh sound with a subtle metallic shimmer, light and airy,
signals a narrow miss or successful evasive maneuver, no impact, very fast,
0.2 seconds, sci-fi video game sound effect
```

---

### sfx_bomb_arm.mp3 — Взвод мины/бомбы
Роль: `aiClass:'bomb'`/`directedMine`/`stunMine` — момент фитиля (тинт-флик)

```
a short rising electronic beeping sound, two or three quick ascending pulses
getting faster, classic "arming" or "danger incoming" cue, tense but brief,
0.4 seconds, video game sound effect
```

---

### sfx_mine_detonate.mp3 — Взрыв мины/бомбы
Роль: `onBombDetonate`/`onDirectedMineDetonate` — момент срабатывания

```
a sharp focused synthetic detonation, tighter and more directional than a ship
explosion, a quick crack with a short metallic ring, 0.5 seconds, sci-fi mine
explosion sound effect
```

---

### sfx_emp_stun.mp3 — ЭМИ-стан
Роль: `onStunMineDetonate`/`_applyPlayerStun` — отключение двигателей/оружия

```
a short electric power-down sound, a descending synthetic warble followed by a
soft fizzle, communicates systems shutting off rather than damage, no explosion,
0.6 seconds, sci-fi EMP sound effect
```

---

### sfx_boss_phase.mp3 — Переход фазы босса
Роль: `onDungeonBossPhase`/переход фазы Апофиса — синхронно с тряской камеры

```
a short ominous rising synthetic tone with a deep impact at the peak, signals a
boss becoming more dangerous, dramatic and a little unsettling, 0.8 seconds,
video game boss-phase-transition sound effect
```

---

### sfx_low_hp_warning.mp3 — Предупреждение о низком HP (луп)
Роль: пока HP игрока < 25% · зациклен вместе с виньеткой экрана

```
a tense repeating soft electronic heartbeat-like pulse, low and steady, designed
to loop seamlessly, communicates danger without being annoying on repeat, 1.2
seconds seamless loop, video game low-health warning sound
```

---

## Порядок работы

1. Сгенерировать 16 файлов по промтам выше, положить в `client/assets/sfx/`
   с именами `<key>.mp3` (ключи — из заголовков `###`, без `.mp3` уже указаны).
2. Ничего в коде менять не нужно — `SoundManager`/`BootScene` уже ждут эти
   файлы по этим именам (см. `SFX_KEYS` в `client/src/systems/SoundManager.js`).
3. Если звук не устраивает — можно перегенерировать/заменить файл в любой
   момент, конвенция имён не меняется.
