# АРГУС — Квантовый Стражник. Промт + анимация

## Концепция

Аргус существует одновременно в нескольких квантовых состояниях.
Его корпус — не один корабль, а несколько вероятностных проекций одного и того же объекта,
наложенных в реальном пространстве с разными сдвигами. Часть брони мерцает и исчезает —
она «здесь» и «не здесь» одновременно. Оружие материализуется за долю секунды до выстрела,
затем снова растворяется. Визуально — как голограмма с рассинхронизацией каналов.

Он не летит — он *переходит* из точки в точку, оставляя квантовый след.

---

## ПРОМТ

### argus.png — Аргус (Quantum Enforcer)

```
top-down 2D game sprite of a sci-fi quantum enforcement warship called Argus, a massive angular warship that appears to exist in multiple quantum states simultaneously — the hull is rendered as 2-3 semi-transparent overlapping ghost layers of the same ship offset by a few pixels from each other creating a chromatic-aberration-like phase-shift effect, the primary hull layer is solid gunmetal-black (#0a0a14) while the ghost layers are translucent electric blue (#00d4ff) and pale violet (#b39ddb) shifted slightly to the left and right, large swept-back wings with serrated quantum-unstable trailing edges that fade into transparency at the tips, four heavy railgun barrels at the prow — solid on the main layer but ghosted on the offset layers creating a doubled-barrel visual, a massive central spine glowing intense white-blue (#e0f7fa) running full hull length as the quantum anchor core, sections of armor plating are visibly absent — gaps in the hull showing nothing underneath (quantum phased-out), subtle horizontal scan-line artifacts across the surface suggesting digital instability, chrome structural framing visible through phased-out hull sections, imposing and deeply unsettling silhouette — clearly a warship but wrong in a way that's hard to articulate, very large size fills most of the frame, top-down view, nose pointing downward, no smoke, no fog, no exhaust trails, no atmospheric effects, pure transparency only, isolated on transparent background, sci-fi quantum phase-shift aesthetic, painterly stylized top-down RTS unit art, AAA mobile game quality, no text, no characters
```

---

## Анимация Аргуса в Phaser 4

### Структура объекта (4 слоя)

```
Аргус = 4 спрайта из одного argus.png:
  [0] layer_main   — основной корпус, alpha 1.0, без сдвига        (depth 40)
  [1] layer_blue   — синий дубль, alpha 0.35, tint 0x00d4ff, +4px вправо (depth 39)
  [2] layer_violet — фиолетовый дубль, alpha 0.25, tint 0xb39ddb, -4px влево (depth 38)
  [3] layer_white  — белый дубль, alpha 0.15, tint 0xe0f7fa, без сдвига (depth 37)
```

### Квантовое мерцание (update loop)

```javascript
// В ArgusController.update():
this._phaseTimer = (this._phaseTimer || 0) + delta;

// Случайное мерцание каждые 2-6 секунд
if (this._phaseTimer > this._nextPhase) {
  this._phaseTimer = 0;
  this._nextPhase = 2000 + Math.random() * 4000;
  this._triggerPhaseFlicker();
}

_triggerPhaseFlicker() {
  // Главный слой кратко "проваливается"
  this.scene.tweens.add({
    targets: this.layerMain,
    alpha: { from: 1.0, to: 0.3 },
    duration: 80,
    yoyo: true,
    repeat: 2,
    ease: 'Stepped'
  });
  // Боковые слои смещаются сильнее
  this.scene.tweens.add({
    targets: this.layerBlue,
    x: this.layerBlue.x + (Math.random() > 0.5 ? 8 : -8),
    alpha: { from: 0.35, to: 0.7 },
    duration: 100,
    yoyo: true,
    ease: 'Linear'
  });
}
```

### Эффект сканирующей линии (scan-line sweep)

```javascript
// Тонкая горизонтальная линия движется сверху вниз по корпусу раз в 3 сек
// Реализация: Graphics объект, setAlpha(0.15), y-позиция через tween
this.scene.tweens.add({
  targets: this.scanLine,
  y: { from: this.sprite.y - 60, to: this.sprite.y + 60 },
  duration: 800,
  repeat: -1,
  repeatDelay: 2200,
  ease: 'Linear'
});
```

### Фаза берсерка (hull < 40%)

```javascript
// Мерцание учащается × 3
this._nextPhase = 500 + Math.random() * 1000;
// Синий слой становится ярче
this.layerBlue.setAlpha(0.6);
// Фиолетовый смещается сильнее и начинает вращаться
this.scene.tweens.add({
  targets: this.layerViolet,
  angle: { from: -3, to: 3 },
  duration: 150,
  yoyo: true,
  repeat: -1
});
// Белая вспышка на каждой атаке: layerWhite.setAlpha(0.8) → 0.15 за 200ms
```

### Квантовый скачок (способность — телепорт на 400px)

```javascript
// Все слои мгновенно исчезают (alpha=0 за 50ms)
// Позиция меняется
// Все слои появляются со взрывным рассогласованием:
//   layerBlue появляется первым (+200ms offset)
//   layerMain появляется через 350ms
//   layerViolet и layerWhite догоняют за 500ms
// Создаёт эффект "материализации" из квантового состояния
```

---

## Имена в ru.json

```json
"mob.argus": "АРГУС",
"argus.phase_berserk": "Квантовый берсерк",
"argus.ability_jump": "Квантовый скачок"

http://localhost:8080/weapon-compare.html
```
