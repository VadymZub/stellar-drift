# Stellar Drift — VFX Sprite Sheet Prompts

Все ефекти: RGBA PNG, прозорий чорний фон, additive blend в грі, вид зверху.
Формат спрайтшіту вказаний для кожного ефекту (сітка кадрів × розмір кадру).

Загальний стиль: `top-down 2D space VFX, dark sci-fi, additive blend on black, cinematic particle FX, sharp edges, RGBA sprite sheet PNG`

---

## Існуючі ефекти (вже нарізані, в assets/vfx/)

### emp_strike — EMP Strike AoE
> Sci-fi electromagnetic pulse explosion, top-down 2D. Bright electric-blue/cyan expanding ring with jagged lightning arcs radiating outward, crackling white energy core, thin ionization tendrils. 16-frame sprite sheet 4×4, each frame ~384×256px. RGBA PNG transparent black BG, additive blend style.

### engine_particle — Engine Exhaust
> Sci-fi engine exhaust particle trail, top-down 2D, looping animation. Bright cyan-white glowing core nozzle with hot plasma trail fading to deep blue then transparent. Directional, left-to-right. 12-frame sprite sheet 3×4, each frame ~418×314px. RGBA PNG, additive blend.

### hull_hit — Hull Impact Explosion
> Spacecraft hull impact explosion, top-down 2D. Orange-white core burst expanding outward, debris fragments, bright flash frame 0, shockwave ring, fading smoke. 12-frame 4×3, each frame ~384×342px. RGBA PNG, additive blend.

### laser_beam1 — Laser Beam Impact
> Laser beam impact flash, top-down 2D. Instant bright white-cyan flash, horizontal beam streak, secondary scatter sparks, fast fade. 12-frame 4×3, each frame ~384×341px. RGBA PNG, additive blend.

### laser_beam2 — Laser Burst Contact
> Laser beam contact explosion, top-down 2D. Compact bright white-blue detonation, radial energy burst, glowing ring edge. 8-frame 4×2, each frame ~384×512px. RGBA PNG, additive blend.

### plasma_bolt — Plasma Projectile
> Plasma bolt projectile in-flight, top-down 2D, looping animation. Elongated glowing green-cyan plasma capsule with bright core, trailing glow particles, soft pulsing aura. Horizontal orientation. 16-frame 4×4, each frame ~384×256px. RGBA PNG, additive blend.

### plasma_burst — Plasma AoE Burst
> Plasma area burst explosion, top-down 2D. Green-cyan plasma expanding sphere, volatile plasma tendrils, bright core, shockwave ring, hot green glow fade. 12-frame 4×3, each frame ~384×341px. RGBA PNG, additive blend.

### repair_pulse — Repair Pulse Ring
> Healing repair pulse ring, top-down 2D. Expanding teal/green ring emanating from center, soft glow, concentric secondary rings, particle sparkles, calming blue-green palette. 16-frame 4×4, each frame ~384×256px. RGBA PNG, additive blend.

### targeting_reticle — Target Lock Reticle
> Target lock-on reticle animation, top-down 2D. Reticle ring shrinks inward from large to normal size, orange-red corner brackets converge, brief inner crosshair flash, pulsing glow ring. 6-frame 2×3, each frame ~512×512px. RGBA PNG, additive blend.

---

## Нові ефекти (потрібно згенерувати)

---

### boss_aoe_collapse — Gravitational Collapse (Boss AoE деtonation)

Замінює простий вибух у босівській AoE-атаці. Відтворюється в момент детонації.

> Sci-fi gravitational collapse AoE detonation, top-down 2D. 16-frame 4×4 sprite sheet, 512×512px per frame. RGBA PNG, transparent black BG, additive blend.
>
> Animation: Frames 0–2: bright white singularity pinpoint at center (4–8px), intense halo, thin violet/teal energy tendrils spiraling inward like a lens flare implosion. Frames 3–6: dark void circle expands 60→140px, surrounded by compressed bright-white particles crushed inward; deep purple/indigo core with chromatic aberration distortion ring. Frames 7–10: DETONATION — void collapses, fast-expanding shockwave ring 200→480px, thin (8–12px), electric blue-white outer edge, purple inner glow, radial energy particles fly outward. Frames 11–13: ring expands and fades, debris sparks, gravitational lens ripple distortion at center. Frames 14–15: fade to transparent, faint residual core glow.
>
> Colors: deep violet #4a0070, electric blue-white #a0e0ff, compressed white #ffffff, teal accent #00ffd0. No orange/fire. Cold, alien, physics-based.

**Технічні параметри:** 16f @ 24fps, canvas 512×512, tween: scaleFrom 0.4→scalePeak 1.2→scaleEnd 1.0, alphaEnd 0.0

---

### drain_hit — Energy Drain (Высасыватель, ефект на гравці)

Накладається на гравця поки активний drain-промінь Высасувача. Лупинг.

> Sci-fi energy drain absorption effect, top-down 2D, looping. 8-frame 4×2 sprite sheet, 300×300px per frame. RGBA PNG, additive blend.
>
> Visual: Swirling violet/magenta energy vortex centered on player ship. Thin particle tendrils rotate clockwise, being pulled inward toward center. Bright rotating core (25px), outer glow ring (120px radius), particles spiral from periphery to center. Continuous loop, seamless. Dark purple #5500aa, magenta #cc00ff, bright core #ffffff.

**Технічні параметри:** 8f @ 12fps loop, canvas 300×300, tween: loop, scale ~0.5 на кораблі гравця

---

### shield_block_emp — Shield Block EMP (Блокировщик щита, ефект попадання)

Відтворюється на гравці при влученні EMP-снаряда від Блокировщика.

> Sci-fi EMP shield disruption pulse, top-down 2D. 12-frame 4×3 sprite sheet, 480×480px per frame. RGBA PNG, additive blend.
>
> Animation: Frame 0–1: central white flash burst (50px). Frames 2–8: three concentric hexagonal interference rings expanding outward from 60px to 440px, each ring sharp 3px stroke, electric blue-cyan color, between rings: scattered static noise pixels and short radial lines. Frames 9–11: rings fade, residual pixel scatter. Colors: electric blue #00c8ff, bright cyan #40ffee, white core #ffffff, hex grid accent #0066aa. No warmth, purely cold electromagnetic.

**Технічні параметри:** 12f @ 16fps, canvas 480×480, tween: scaleFrom 0.3→scalePeak 1.0, alphaEnd 0.0

---

### mine_explosion_small — Small Mine Explosion (Мала міна)

Вибух малої міни від Ancient Мінера.

> Small compact mine explosion, top-down 2D. 8-frame 4×2 sprite sheet, 220×220px per frame. RGBA PNG, additive blend.
>
> Animation: Frame 0–1: bright white pinpoint flash, instant full-frame glow. Frames 2–5: fast-expanding orange-white ring (20px→190px), thin 4px leading edge, inner orange glow, 8–12 small debris sparks flying radially. Frames 6–7: ring and sparks fade to transparent. Colors: white core #ffffff, hot orange #ff8800, amber #ffaa00. Sharp, fast, compact.

**Технічні параметри:** 8f @ 18fps, canvas 220×220, tween: scaleFrom 0.5→scalePeak 1.1, alphaEnd 0.0

---

### mine_explosion_large — Large Mine Explosion (Велика міна)

Вибух великої міни — помітний, небезпечний.

> Large mine detonation explosion, top-down 2D. 16-frame 4×4 sprite sheet, 440×440px per frame. RGBA PNG, additive blend.
>
> Animation: Frames 0–2: expanding orange fireball core (80px→200px), bright white center. Frames 3–8: massive shockwave ring expanding to 400px, bright white leading edge (6px), orange trailing glow (20px), inner smoke ring. Frames 9–12: secondary smaller debris arcs flying outward, ember particles, residual glow. Frames 13–15: slow fade to transparent, wispy smoke. Colors: white #ffffff, hot orange #ff6600, amber #ffcc00, deep orange smoke #992200.

**Технічні параметри:** 16f @ 20fps, canvas 440×440, tween: scaleFrom 0.4→scalePeak 1.3→scaleEnd 1.0, alphaEnd 0.0

---

### jammer_aura — Jammer Drone Aura (Дрон-глушитель, лупинг навколо дрона)

Постійно крутиться навколо Jammer-дрона, сигналізує про активну перешкоду.

> Sci-fi electronic jamming interference aura, top-down 2D, looping. 6-frame 3×2 sprite sheet, 180×180px per frame. RGBA PNG, additive blend.
>
> Visual: Concentric interference wavefronts emanating from center, pixelated/static noise texture in rings, green-yellow color, slight rotation per frame. Each ring has a jagged, non-smooth edge suggesting digital corruption. Center: faint pulsing dot. Continuous seamless loop. Colors: acid green #aaff00, yellow-green #ccff33, bright white nodes #ffffff scattered. Subtle, ambient, not distracting.

**Технічні параметри:** 6f @ 10fps loop, canvas 180×180, tween: loop, scale ~1.5 навколо дрона

---

### stealth_decloak — Stealth Decloak Flash (Стелс-снайпер, поява)

Відтворюється на Stealth Sniper коли він деcloakується для пострілу.

> Sci-fi stealth phase-in decloak effect, top-down 2D. 8-frame 4×2 sprite sheet, 260×260px per frame. RGBA PNG, additive blend.
>
> Animation: Frames 0–2: faint holographic shimmer — ghost outline of a ship silhouette with iridescent refraction distortion, rainbow chromatic aberration fringe (cyan, magenta, yellow), barely visible. Frames 3–5: rapid reveal — bright white-cyan burst radiating outward from ship center (60px→230px ring), intense flash, holographic grid lines briefly visible. Frames 6–7: settle, brief residual edge-glow around outline, fades to transparent. Colors: iridescent rainbow fringe, white core #ffffff, bright cyan #00ffee, silver #aaccdd.

**Технічні параметри:** 8f @ 16fps, canvas 260×260, tween: scaleFrom 0.6→scalePeak 1.0, alphaEnd 0.0

---

## Зведена таблиця нових ефектів

| Ключ | Кадри | FPS | Сітка | Canvas | Для |
|------|-------|-----|-------|--------|-----|
| boss_aoe_collapse | 16 | 24 | 4×4 | 512×512 | Boss AoE деtonation |
| drain_hit | 8 | 12 | 4×2 | 300×300 | Высасыватель → гравець |
| shield_block_emp | 12 | 16 | 4×3 | 480×480 | Блокировщик → гравець |
| mine_explosion_small | 8 | 18 | 4×2 | 220×220 | Мала міна |
| mine_explosion_large | 16 | 20 | 4×4 | 440×440 | Велика міна |
| jammer_aura | 6 | 10 | 3×2 | 180×180 | Навколо Jammer-дрона |
| stealth_decloak | 8 | 16 | 4×2 | 260×260 | Stealth Sniper декамуфляж |
