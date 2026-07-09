import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.1.0/dist/phaser.esm.js';

// Конвенция ключей ↔ файлов описана в client/assets/sfx/sfx_prompts.md.
// Файлов пока может не быть (звук — отдельный этап генерации художником/саунд-
// дизайнером): BootScene загружает их по этому списку, а play() ниже тихо
// ничего не делает для ключей, которых нет в кэше — код можно подключать уже
// сейчас, до появления реальных файлов.
export const SFX_KEYS = [
  'sfx_cannon_fire', 'sfx_laser_fire', 'sfx_weapon_miss',
  'sfx_hit_shield', 'sfx_hit_hull', 'sfx_crit',
  'sfx_mob_fire_plasma', 'sfx_mob_fire_hitscan',
  'sfx_explosion_small', 'sfx_explosion_boss', 'sfx_player_death',
  'sfx_dodge', 'sfx_bomb_arm', 'sfx_mine_detonate', 'sfx_emp_stun',
  'sfx_boss_phase', 'sfx_low_hp_warning',
];

export default class SoundManager {
  constructor(scene) {
    this.scene = scene;
    this._cds = {};      // per-key кулдаун — частая стрельба не превращается в шумовую кашу
    this._loopKeys = {}; // активные луп-звуки (напр. sfx_low_hp_warning), по ключу
  }

  /** One-shot проигрывание. cooldownMs — минимальный интервал между повторами ключа. */
  play(key, { volume = 0.6, cooldownMs = 0 } = {}) {
    if (!this.scene.cache.audio.exists(key)) return;
    const now = this.scene.time.now;
    if (cooldownMs > 0) {
      if ((this._cds[key] || 0) > now) return;
      this._cds[key] = now + cooldownMs;
    }
    // Небольшой случайный питч — иначе частый повтор одного сэмпла (выстрелы)
    // звучит механически-однообразно
    this.scene.sound.play(key, { volume, rate: Phaser.Math.FloatBetween(0.96, 1.04) });
  }

  /** Запускает зацикленный звук (если ещё не играет) и возвращает управление им. */
  startLoop(key, { volume = 0.4 } = {}) {
    if (!this.scene.cache.audio.exists(key) || this._loopKeys[key]) return;
    const s = this.scene.sound.add(key, { loop: true, volume });
    s.play();
    this._loopKeys[key] = s;
  }

  stopLoop(key) {
    this._loopKeys[key]?.stop();
    this._loopKeys[key]?.destroy();
    delete this._loopKeys[key];
  }

  stopAllLoops() {
    for (const key of Object.keys(this._loopKeys)) this.stopLoop(key);
  }
}
