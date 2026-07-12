import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';

// Convert manifest ease strings ("Quint.Out") to Phaser format ("Quint.easeOut")
function ease(s) {
  if (!s) return 'Linear';
  return s.replace(/\.InOut$/, '.easeInOut').replace(/\.Out$/, '.easeOut').replace(/\.In$/, '.easeIn');
}

export default class VFXManager {
  constructor(scene) {
    this.scene   = scene;
    this.manifest = scene.cache.json.get('vfx_manifest');
  }

  // One-shot effect with full tween envelope from manifest.
  play(key, x, y, { scale = 1, depth = 67 } = {}) {
    const m = this.manifest?.[key];
    if (!m) return null;

    const sc = this.scene;
    const tw = m.tween;
    const scalesDown = tw.scaleFrom > tw.scalePeak;

    const spr = sc.add.sprite(x, y, key)
      .setDepth(depth)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(tw.scaleFrom * scale)
      .setAlpha(scalesDown ? 0 : 1);

    spr.play(key);

    sc.tweens.add({ targets: spr, scale: tw.scalePeak * scale, duration: tw.introDur, ease: ease(tw.ease) });

    if (scalesDown) {
      sc.tweens.add({ targets: spr, alpha: 1, duration: tw.introDur * 0.45, ease: 'Sine.easeIn' });
    }

    if (tw.outroDur > 0) {
      const animDur = (m.frameCount / m.fps) * 1000;
      sc.time.delayedCall(Math.max(0, animDur - tw.outroDur - 30), () => {
        if (!spr.active) return;
        sc.tweens.add({ targets: spr, scale: tw.scaleEnd * scale, alpha: tw.alphaEnd, duration: tw.outroDur, ease: 'Sine.easeOut' });
      });
    }

    spr.once('animationcomplete', () => { if (spr.active) spr.destroy(); });
    return spr;
  }

  // Looping effect — returns the sprite. Call stopLoop() to fade it out.
  playLoop(key, x, y, { scale = 1, depth = 48 } = {}) {
    const m = this.manifest?.[key];
    if (!m) return null;

    const sc = this.scene;
    const tw = m.tween;

    const spr = sc.add.sprite(x, y, key)
      .setDepth(depth)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(tw.scaleFrom * scale)
      .setAlpha(0);

    spr.play({ key, repeat: -1 });

    sc.tweens.add({ targets: spr, scale: tw.scalePeak * scale, alpha: 1, duration: tw.introDur, ease: ease(tw.ease) });

    return spr;
  }

  stopLoop(spr, { fadeMs = 250 } = {}) {
    if (!spr?.active) return;
    this.scene.tweens.add({
      targets: spr, alpha: 0, duration: fadeMs, ease: 'Sine.easeOut',
      onComplete: () => { if (spr.active) spr.destroy(); },
    });
  }
}
