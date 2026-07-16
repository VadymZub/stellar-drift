import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { COLORS, UI_RES, CORP_META, MOCK_CORP_RATINGS } from '../constants.js';
import { i18n } from '../i18n.js';
import { profileGet } from '../api.js';
import { SHIP_BY_KEY } from '../ships.js';
import { calculateRating, getRank } from '../ranking.js';

// Read-only попап профиля ДРУГОГО игрока. Отдельная лёгкая сцена (не часть ProfileScene,
// не в overlays-массиве GameScene.toggleOverlay) — должна открываться ПОВЕРХ любой уже
// открытой меню-сцены (например, ClanScene), не закрывая её. Лаунчится как
// `this.scene.launch('ProfileViewScene', { viewName })` из HudScene/ClanScene.
export default class ProfileViewScene extends Phaser.Scene {
  constructor() { super('ProfileViewScene'); }

  create(data) {
    const viewName = data?.viewName || '';
    const W = this.scale.width, H = this.scale.height;
    const F = (sz, c) => ({ fontFamily: 'Inter, sans-serif',    fontSize: sz, color: c, resolution: UI_RES });
    const O = (sz, c) => ({ fontFamily: 'Orbitron, sans-serif', fontSize: sz, color: c, resolution: UI_RES });

    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.55).setOrigin(0).setDepth(0).setInteractive();
    dim.on('pointerdown', () => this.scene.stop());

    const PW = 400, PH = 520;
    const px = Math.round((W - PW) / 2), py = Math.round((H - PH) / 2);

    const panel = this.add.graphics().setDepth(1);
    panel.fillStyle(0x03080f, 0.97);
    panel.fillRoundedRect(px, py, PW, PH, 10);
    panel.lineStyle(1.5, COLORS.primary, 0.7);
    panel.strokeRoundedRect(px, py, PW, PH, 10);
    panel.fillStyle(0x081422, 1);
    panel.fillRoundedRect(px, py, PW, 34, { tl: 10, tr: 10, bl: 0, br: 0 });

    this.add.rectangle(px, py, PW, PH, 0, 0.001).setOrigin(0).setDepth(1).setInteractive();

    this.add.text(px + PW / 2, py + 17, i18n.t('profileview.title'), O('13px', '#4dd0e1')).setOrigin(0.5).setDepth(2);
    const closeBtn = this.add.text(px + PW - 14, py + 17, '✕', F('14px', '#335566'))
      .setOrigin(1, 0.5).setDepth(2).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor('#ef5350'));
    closeBtn.on('pointerout',  () => closeBtn.setColor('#335566'));
    closeBtn.on('pointerdown', () => this.scene.stop());

    this._bodyObjs = [];
    const bodyX = px + 20, bodyY = py + 50, bodyW = PW - 40;
    this._renderLoading(bodyX, bodyY, bodyW, F);

    this.input.keyboard.on('keydown-ESC', () => this.scene.stop());

    profileGet(viewName)
      .then(p => this._renderProfile(bodyX, bodyY, bodyW, F, O, viewName, p))
      .catch(e => this._renderError(bodyX, bodyY, bodyW, F, viewName, e));
  }

  _clearBody() {
    for (const o of this._bodyObjs) o.destroy();
    this._bodyObjs = [];
  }

  // depth 3 — над панелью (1) и заголовком (2), см. create(); без этого текст тела
  // рисуется НИЖЕ фона панели и почти не виден (был баг: имя/бейджи еле проступали).
  _track(o) { o.setDepth(3); this._bodyObjs.push(o); return o; }

  _renderLoading(x, y, w, F) {
    this._track(this.add.text(x + w / 2, y + 60, i18n.t('profileview.loading'), F('12px', '#7eb8c8')).setOrigin(0.5));
  }

  _renderError(x, y, w, F, viewName, err) {
    if (!this.scene.isActive()) return; // сцена уже закрыта пока грузился запрос
    this._clearBody();
    if (err?.status === 403) {
      this._track(this.add.text(x + w / 2, y + 60, i18n.t('profileview.private'), F('12px', '#ffb74d')).setOrigin(0.5));
      return;
    }
    this._track(this.add.text(x + w / 2, y + 40, i18n.t('profileview.error'), F('12px', '#ef5350')).setOrigin(0.5));
    const retryBtn = this._track(this.add.rectangle(x + w / 2 - 50, y + 70, 100, 26, 0x0a2030, 1).setOrigin(0.5)
      .setStrokeStyle(1, COLORS.primary, 0.8).setInteractive({ useHandCursor: true }));
    this._track(this.add.text(x + w / 2 - 50, y + 70, i18n.t('profileview.retry'), F('11px', '#4dd0e1')).setOrigin(0.5));
    retryBtn.on('pointerdown', () => {
      this._clearBody();
      this._renderLoading(x, y, w, F);
      profileGet(viewName)
        .then(p => this._renderProfile(x, y, w, F, this._O, viewName, p))
        .catch(e => this._renderError(x, y, w, F, viewName, e));
    });
  }

  _renderProfile(x, y, w, F, O, viewName, p) {
    if (!this.scene.isActive()) return;
    this._clearBody();
    let cy = y;

    this._track(this.add.text(x, cy, p.display_name || p.username, O('16px', '#e0f7fa')));
    cy += 22;
    if (p.display_name) {
      this._track(this.add.text(x, cy, `@${p.username}`, F('10px', '#607d8b')));
      cy += 16;
    }

    const badges = [];
    if (p.level != null) badges.push(`${i18n.t('mob.level') || 'ур.'} ${p.level}`);
    if (p.honor != null) badges.push(`⭐ ${p.honor}`);
    if (badges.length) {
      this._track(this.add.text(x, cy, badges.join('   '), F('11px', '#4dd0e1')));
      cy += 22;
    } else {
      cy += 10;
    }

    // Звание — считаем на клиенте той же формулой, что и для своего пилота
    // (нет живого лидерборда с сервера, только фиксированный мок-пул, см. GameScene).
    // Корпорация — свой цвет из CORP_META, тот же справочник, что в CorpScene.
    if (p.xp != null && p.honor != null) {
      const rating = calculateRating(p.xp, p.honor);
      const ratings = MOCK_CORP_RATINGS.includes(rating) ? MOCK_CORP_RATINGS : [...MOCK_CORP_RATINGS, rating].sort((a, b) => b - a);
      const rank = getRank(rating, ratings);
      this._track(this.add.text(x, cy, rank.name, F('11px', '#ffb74d')));
      cy += 18;
    }
    if (p.corp) {
      const meta = CORP_META[p.corp] || CORP_META.neutral;
      this._track(this.add.text(x, cy, meta.label, F('11px', meta.color)));
      cy += 18;
    }
    if (p.clan_name) {
      const tag = p.clan_tag ? ` [${p.clan_tag}]` : '';
      this._track(this.add.text(x, cy, `${i18n.t('profileview.guild')}: ${p.clan_name}${tag}`, F('11px', '#9fb3b8')));
      cy += 18;
    }
    cy += 4;

    const row = (label, value) => {
      if (!value) return;
      this._track(this.add.text(x, cy, label, F('10px', '#607d8b')));
      this._track(this.add.text(x, cy + 14, String(value), F('12px', '#cfe9ee'), { wordWrap: { width: w } }));
      cy += 38;
    };

    row(i18n.t('profile.country'), p.country);
    row(i18n.t('profile.city'), p.city);
    row(i18n.t('profile.goal'), p.goal);
    row(i18n.t('profile.favorite_games'), p.favorite_games);

    const links = p.social_links || {};
    const linkParts = ['discord', 'telegram', 'steam', 'other']
      .filter(k => links[k])
      .map(k => `${k}: ${links[k]}`);
    if (linkParts.length) row('Соцсети', linkParts.join('  ·  '));

    if (p.favorite_ship_key && SHIP_BY_KEY[p.favorite_ship_key]) {
      row(i18n.t('profileview.favorite_ship'), i18n.t(SHIP_BY_KEY[p.favorite_ship_key].nameKey));
    }
    row(i18n.t('profile.playtime'), p.playtime_hours ? `${p.playtime_hours} ч` : null);
    row(i18n.t('profile.pvp_wins'), p.pvp_wins || null);

    if (!p.country && !p.city && !p.goal && !p.favorite_games && !linkParts.length && !p.favorite_ship_key) {
      this._track(this.add.text(x, cy, '— игрок пока не заполнил профиль —', F('11px', '#455a64')));
    }
  }
}
