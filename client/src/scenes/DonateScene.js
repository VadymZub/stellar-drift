import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { COLORS, UI_RES } from '../constants.js';
import { prerenderTex } from '../utils/prerenderTex.js';
import { i18n } from '../i18n.js';
import { walletCreateDepositOrder, walletDepositOrderStatus, walletClaimCredit } from '../api.js';

const PREMIUM_PLANS = [
  { id: 'prem_1m',  label: '1 МЕСЯЦ',  price: '$5.00',  days: 30  },
  { id: 'prem_3m',  label: '3 МЕСЯЦА', price: '$12.00', days: 90,  badge: '−20%' },
  { id: 'prem_12m', label: '1 ГОД',    price: '$45.00', days: 365, badge: '−25%' },
];

const STAR_PACKS = [
  { id: 'stars_pilot',    label: 'ПИЛОТ',   stars: 625,  price: '$4.99'  },
  { id: 'stars_sergeant', label: 'СЕРЖАНТ', stars: 1250, price: '$9.99'  },
  { id: 'stars_captain',  label: 'КАПИТАН', stars: 2750, price: '$19.99', badge: '+10%' },
  { id: 'stars_admiral',  label: 'АДМИРАЛ', stars: 6000, price: '$39.99', badge: '+20%' },
];

// Недельный бустер опыта/чести — подключён к той же USDT-инфраструктуре, что и звёзды
// (см. диалог "так мы можем подключить оплату криптой"), id совпадает с ключом в
// server/crypto_payments.py BOOSTERS.
const WEEKLY_BOOSTER = { id: 'boost_xp_honor_7d', label: '+10% ОПЫТ  ·  +10% ЧЕСТЬ', desc: '7 дней', price: '$2.99' };

const PREMIUM_BENEFITS = [
  '+8 слотов трюма',
  '+8 слотов склада',
  'Авто-сбор плазмита (магнит)',
  '+10% опыта',
  'Удалённая продажа (без захода на базу)',
  'Бой с тенью: 6 попыток/сутки (было 3)',
  'Доступ в премиум-данж «Лабиринт Тьмы»',
  'Элитные миссии  (скоро)',
];

// Base hotkeys → scene to open
const BASE_HOTKEYS = {
  G: 'GarageScene', N: 'ClanScene', H: 'CorpScene',
  O: 'MissionsScene', P: 'ShopScene', K: 'SkillScene', C: 'CargoScene',
};

export default class DonateScene extends Phaser.Scene {
  constructor() { super('DonateScene'); }

  O(s, c = '#4dd0e1') { return { fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES }; }
  F(s, c = '#cce8f0') { return { fontFamily: 'Inter, sans-serif',    fontSize: s, color: c, resolution: UI_RES }; }

  create() {
    const W = this.scale.width, H = this.scale.height;
    const gs = this.scene.get('GameScene');

    // Background — same as ShopScene
    if (this.textures.exists('bg_shop')) {
      const bg = this.add.image(W / 2, H / 2, 'bg_shop');
      bg.setScale(Math.max(W / bg.width, H / bg.height)).setAlpha(0.7);
    } else {
      this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.6);
    }

    const pw = Math.min(1100, W - 24), ph = Math.min(800, H - 24);
    const px = (W - pw) / 2,          py = (H - ph) / 2;

    // Panel — lighter than before
    const g = this.add.graphics();
    g.fillStyle(0x0d1828, 0.97); g.fillRoundedRect(px, py, pw, ph, 14);
    g.lineStyle(2, COLORS.amber, 0.9); g.strokeRoundedRect(px, py, pw, ph, 14);

    // Header
    this.add.text(px + 34, py + 22, 'ДОНАТ МАГАЗИН', this.O('20px', '#ffd54f'));

    // Открытая модалка оплаты держит два this.time.addEvent(loop: true) —
    // без этого они продолжали бы тикать (и слать запросы на сервер) после
    // закрытия сцены любым путём (ESC, хоткей другой базовой сцены).
    this.events.once('shutdown', () => this._closeDepositModal());

    // ESC button — full exit from base
    const _exit = () => { this.scene.stop(); gs._exitToSpace(); };
    const escBtn = this.add.text(px + pw - 30, py + 28, 'ESC', this.F('13px', '#445566'))
      .setOrigin(1, 0).setInteractive({ useHandCursor: true });
    escBtn.on('pointerover', () => escBtn.setColor('#aabbcc'));
    escBtn.on('pointerout',  () => escBtn.setColor('#445566'));
    escBtn.on('pointerdown', _exit);
    this.input.keyboard.on('keydown-ESC', _exit);

    // Base hotkeys → close donate + open target scene
    Object.entries(BASE_HOTKEYS).forEach(([key, sceneKey]) => {
      this.input.keyboard.on(`keydown-${key}`, () => {
        this.scene.stop();
        gs.toggleOverlay(sceneKey);
      });
    });

    // Divider
    g.lineStyle(1, 0x1e3a5a, 0.7); g.lineBetween(px + 20, py + 58, px + pw - 20, py + 58);

    // Live balance — icon_gold (24px) + number + separator + premium status
    const balCX = px + pw / 2;
    const balY  = py + 32;
    this.add.image(balCX - 80, balY, prerenderTex(this, 'icon_gold', 24, 24))
      .setDisplaySize(24, 24).setOrigin(0.5);
    const starTxt = this.add.text(balCX - 64, balY, '', this.O('13px', '#ffd54f')).setOrigin(0, 0.5);
    const sepTxt  = this.add.text(0, balY, '  |  ', this.O('13px', '#445566')).setOrigin(0, 0.5);
    const premTxt = this.add.text(0, balY, '', this.O('13px', '#ce93d8')).setOrigin(0, 0.5);
    const refreshBal = () => {
      starTxt.setText(`${gs.starGold || 0}`);
      sepTxt.setX(balCX - 64 + starTxt.width);
      const active = gs.premium;
      // "до <дата>" — раньше статус был просто вкл/выкл без срока (диалог: "premium
      // активен до и число — клиент должен видеть такие данные"). gs.premiumUntil
      // отсутствует у вечного тестового премиума (TestProfileScene) — тогда просто
      // "АКТИВЕН" без даты, как и было.
      const untilTxt = active && gs.premiumUntil
        ? ` до ${new Date(gs.premiumUntil).toLocaleDateString('ru-RU')}`
        : '';
      premTxt.setX(sepTxt.x + sepTxt.width)
             .setText(`PREMIUM: ${active ? 'АКТИВЕН' + untilTxt : 'НЕТ'}`)
             .setColor(active ? '#ffd54f' : '#ce93d8');
    };
    refreshBal();

    // Подчищаем "забытые" начисления при каждом открытии магазина: если игрок
    // закрыл модалку оплаты ДО того, как её поллинг увидел status='paid'
    // (например, ушёл из базы, не дождавшись), кредит остаётся висеть на
    // сервере в pending_star_gold_credit — сама модалка его больше не заберёт
    // (её таймеры уже уничтожены). Без этого шага деньги были бы формально
    // начислены, но никогда не попали бы в gs.starGold, пока игрок случайно
    // не откроет магазин снова и не купит что-то ещё, дождавшись оплаты ЭТОГО
    // заказа. Дешёвый no-op запрос, если начислять нечего (credited === 0).
    walletClaimCredit().then(res => this._applyClaimResult(res, gs, refreshBal))
      .catch(() => { /* нет токена/сеть недоступна — не критично, попробуем при следующем открытии */ });

    const colW = (pw - 60) / 2;
    const leftX   = px + 20;
    const rightX  = px + 40 + colW;
    const contentY = py + 72;

    this._drawPremiumSection(leftX, contentY, colW, ph - 90, gs, refreshBal);

    g.lineStyle(1, 0x1e3a5a, 0.6);
    g.lineBetween(px + pw / 2, py + 65, px + pw / 2, py + ph - 20);

    this._drawStarSection(rightX, contentY, colW, ph - 90, gs, refreshBal);
  }

  _drawPremiumSection(x, y, w, h, gs, refreshBal) {
    this.add.text(x, y, 'ПОДПИСКА PREMIUM', this.O('14px', '#ffb74d'));

    // Premium icon — 260px (было 320 — список преимуществ вырос с 5 до 8 строк,
    // на 320 не помещалось бы в панель без прокрутки, см. диалог "актуализируй
    // преимущества премиума").
    const iconSz = 260;
    const iconX  = x + w / 2;
    this.add.image(iconX, y + 44 + iconSz / 2, prerenderTex(this, 'icon_premium', iconSz, iconSz))
      .setDisplaySize(iconSz, iconSz).setOrigin(0.5);

    // Plan buttons start after icon
    const planY = y + 44 + iconSz + 20;
    PREMIUM_PLANS.forEach((plan, i) => {
      this._drawPlanBtn(x, planY + i * 58, w, plan, gs, refreshBal);
    });

    // Benefits hint
    const hintY = planY + PREMIUM_PLANS.length * 58 + 12;
    const hintH = PREMIUM_BENEFITS.length * 19 + 28;
    const hg = this.add.graphics();
    hg.fillStyle(0x0a1a0a, 0.85); hg.fillRoundedRect(x, hintY, w - 10, hintH, 8);
    hg.lineStyle(1, 0x2a5a2a, 0.7); hg.strokeRoundedRect(x, hintY, w - 10, hintH, 8);
    this.add.text(x + 14, hintY + 10, 'ПРЕИМУЩЕСТВА PREMIUM:', this.F('11px', '#66bb6a'));
    PREMIUM_BENEFITS.forEach((line, i) => {
      this.add.text(x + 14, hintY + 28 + i * 19, `✓  ${line}`, this.F('11px', '#99cc99'));
    });
  }

  _drawPlanBtn(x, y, w, plan, gs, refreshBal) {
    const bh = 48, bw = w - 10;
    const bg = this.add.rectangle(x + bw / 2, y + bh / 2, bw, bh, 0x1a0a2e)
      .setStrokeStyle(1.5, 0x7c4dff, 0.8).setInteractive({ useHandCursor: true });

    this.add.text(x + 14, y + bh / 2, plan.label, this.O('11px', '#ce93d8')).setOrigin(0, 0.5);
    this.add.text(x + bw - 14, y + bh / 2, plan.price, this.O('13px', '#ffd54f')).setOrigin(1, 0.5);

    if (plan.badge) {
      const badgeX = x + bw - 78;
      this.add.rectangle(badgeX, y + 12, 38, 16, 0x2a0a4e).setOrigin(0.5);
      this.add.text(badgeX, y + 12, plan.badge, this.F('10px', '#ea80fc')).setOrigin(0.5);
    }

    bg.on('pointerover', () => bg.setFillStyle(0x2e1050));
    bg.on('pointerout',  () => bg.setFillStyle(0x1a0a2e));
    bg.on('pointerdown', () => this._buyProduct(plan, gs, refreshBal));
  }

  _drawStarSection(x, y, w, h, gs, refreshBal) {
    // Icon (24px) + title with spacing
    this.add.image(x + 12, y + 9, prerenderTex(this, 'icon_gold', 24, 24))
      .setDisplaySize(24, 24).setOrigin(0, 0.5);
    this.add.text(x + 44, y, 'ЗОЛОТЫЕ ЗВЁЗДЫ', this.O('14px', '#ffd54f'));

    const cw = (w - 20) / 2, ch = 200, gap = 10;
    STAR_PACKS.forEach((pack, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const cx  = x + col * (cw + gap);
      const cy  = y + 30 + row * (ch + gap);
      this._drawStarCard(cx, cy, cw, ch, pack, gs, refreshBal);
    });

    // Недельный бустер — под сеткой звёзд, есть запас по высоте в этой колонке
    // (левая с premium-планами заполнена почти до низа панели, эта — нет).
    const rows = Math.ceil(STAR_PACKS.length / 2);
    const boosterY = y + 30 + rows * (ch + gap) + 16;
    this._drawWeeklyBoosterCard(x, boosterY, w - 10, gs, refreshBal);
  }

  _drawWeeklyBoosterCard(x, y, w, gs, refreshBal) {
    const bh = 74;
    const g = this.add.graphics();
    g.fillStyle(0x1a1400, 0.95); g.fillRoundedRect(x, y, w, bh, 10);
    g.lineStyle(1.5, 0xffd54f, 0.85); g.strokeRoundedRect(x, y, w, bh, 10);

    this.add.text(x + 16, y + 14, WEEKLY_BOOSTER.label, this.O('12px', '#ffd54f'));
    this.add.text(x + 16, y + 36, WEEKLY_BOOSTER.desc, this.F('11px', '#c9a04a'));

    const btnW = 90, btnH = 44, btnX = x + w - btnW - 14, btnY = y + (bh - btnH) / 2;
    const btn = this.add.rectangle(btnX + btnW / 2, btnY + btnH / 2, btnW, btnH, 0x2a1a00)
      .setStrokeStyle(1.5, 0xffd54f, 0.85).setInteractive({ useHandCursor: true });
    this.add.text(btnX + btnW / 2, btnY + btnH / 2, WEEKLY_BOOSTER.price, this.O('13px', '#ffd54f')).setOrigin(0.5);

    btn.on('pointerover', () => btn.setFillStyle(0x4a2a00));
    btn.on('pointerout',  () => btn.setFillStyle(0x2a1a00));
    btn.on('pointerdown', () => this._buyProduct(WEEKLY_BOOSTER, gs, refreshBal));
  }

  _drawStarCard(cx, cy, cw, ch, pack, gs, refreshBal) {
    const g = this.add.graphics();
    g.fillStyle(0x0c1810, 0.97); g.fillRoundedRect(cx, cy, cw, ch, 10);
    g.lineStyle(1.5, 0x3a5a20, 0.8); g.strokeRoundedRect(cx, cy, cw, ch, 10);

    this.add.text(cx + cw / 2, cy + 14, pack.label, this.O('12px', '#aed581')).setOrigin(0.5, 0);

    // Icon (88px) + number centered
    const icoSz = 88;
    const numTxt = this.add.text(0, 0, `${pack.stars}`, this.O('24px', '#ffd54f')).setOrigin(0, 0.5);
    const pairW  = icoSz + 10 + numTxt.width;
    const pairX  = cx + (cw - pairW) / 2;
    const pairY  = cy + 80;
    this.add.image(pairX + icoSz / 2, pairY, prerenderTex(this, 'icon_gold', icoSz, icoSz))
      .setDisplaySize(icoSz, icoSz).setOrigin(0.5);
    numTxt.setPosition(pairX + icoSz + 10, pairY);

    if (pack.badge) {
      this.add.text(cx + cw / 2, cy + 126, pack.badge, this.F('11px', '#a5d6a7')).setOrigin(0.5, 0);
    }

    const btnY = cy + ch - 44;
    const btn  = this.add.rectangle(cx + cw / 2, btnY + 18, cw - 16, 34, 0x1a3010)
      .setStrokeStyle(1.5, 0xaed581, 0.8).setInteractive({ useHandCursor: true });
    this.add.text(cx + cw / 2, btnY + 18, pack.price, this.O('13px', '#dce775')).setOrigin(0.5);

    btn.on('pointerover', () => btn.setFillStyle(0x2a4a20));
    btn.on('pointerout',  () => btn.setFillStyle(0x1a3010));
    btn.on('pointerdown', () => this._buyProduct(pack, gs, refreshBal));
  }

  // ── Покупка за USDT (TRC-20) — звёзды/premium/недельный бустер, все три через
  // одну и ту же серверную инфраструктуру (см. диалог "так мы можем подключить
  // оплату криптой" — раньше премиум/бустер были мок-кнопками _showComingSoon,
  // т.к. ждали ответа от Xolla; теперь используют то же, что уже работает для звёзд).
  // product.id должен совпадать с ключом в server/crypto_payments.py (STAR_PACKS/
  // PREMIUM_PLANS/BOOSTERS — сервер сам ищет across всех трёх, см. resolve_product).
  _buyProduct(product, gs, refreshBal) {
    if (this._depositBusy) return;
    this._depositBusy = true;
    walletCreateDepositOrder(product.id)
      .then(order => { this._depositBusy = false; this._showDepositModal(order, gs, refreshBal); })
      .catch(err => {
        this._depositBusy = false;
        this._showError(err?.message || 'Не удалось создать заказ');
      });
  }

  // ── Общее применение результата /wallet/claim-credit — звёзды сразу в баланс,
  // premium продлевает premiumUntil (не перезаписывает — см. диалог), бустер
  // добавляется в gs.activeBoosters['xp_honor_7d'] (те же "оставшиеся мс", что и
  // у остальных бустеров, см. GameScene.update()). Общий метод — вызывается и из
  // авто-клейма при открытии сцены, и из модалки после детекта оплаты, чтобы не
  // дублировать эту логику в двух местах.
  _applyClaimResult(res, gs, refreshBal) {
    if (res.credited > 0) {
      gs.starGold = (gs.starGold || 0) + res.credited;
      gs.log(i18n.t('log.stargold', { amount: res.credited }));
    }
    if (res.premiumDays > 0) {
      const addMs = res.premiumDays * 86_400_000;
      if (gs.premium && gs.premiumUntil == null) {
        // Бессрочный premium (DEV/тест-профиль) — покупка не должна его портить,
        // превращая в конечный срок; просто ничего не меняем.
      } else {
        gs.premiumUntil = Math.max(Date.now(), gs.premiumUntil || 0) + addMs;
        gs.premium = true;
      }
      gs.log(`💎 Premium продлён на ${res.premiumDays} дн.`);
    }
    if (res.boosterXpHonorMs > 0) {
      gs.activeBoosters = gs.activeBoosters || {};
      gs.activeBoosters.xp_honor_7d = (gs.activeBoosters.xp_honor_7d || 0) + res.boosterXpHonorMs;
      gs.log(`🎖 Бустер "Опыт+Честь" +${Math.round(res.boosterXpHonorMs / 86_400_000)} дн.`);
    }
    if (res.credited > 0 || res.premiumDays > 0 || res.boosterXpHonorMs > 0) {
      gs._saveState?.();
      refreshBal();
    }
  }

  _showError(message, color = '#ff8a80') {
    const W = this.scale.width, H = this.scale.height;
    const lbl = this.add.text(W / 2, H / 2 + 40, message, this.F('12px', color))
      .setOrigin(0.5).setDepth(200).setAlpha(0);
    this.tweens.add({ targets: lbl, alpha: 1, duration: 200,
      onComplete: () => this.tweens.add({ targets: lbl, alpha: 0, duration: 400, delay: 1800,
        onComplete: () => lbl.destroy() }) });
  }

  // ── Модалка ожидания оплаты — адрес депозита + сумма + обратный отсчёт до
  // истечения + поллинг статуса заказа. Тот же визуальный паттерн, что и
  // ShopScene._showConfirm (затемнение + панель по центру), но с собственным
  // таймером поллинга вместо однократного подтверждения.
  _showDepositModal(order, gs, refreshBal) {
    this._closeDepositModal();
    const W = this.scale.width, H = this.scale.height;
    const dw = 460, dh = 300;
    const dx = W / 2, dy = H / 2;
    const objs = [];
    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.6).setDepth(199).setInteractive();
    const dlg = this.add.rectangle(dx, dy, dw, dh, 0x060e1c, 1)
      .setStrokeStyle(2, COLORS.amber, 1).setDepth(200);
    objs.push(overlay, dlg);

    // Что именно покупается — ровно одно из трёх ненулевое (см. server CreateDepositOrderResponse).
    const rewardStr = order.starGoldAmount > 0 ? `+${order.starGoldAmount} ⭐`
      : order.premiumDays > 0 ? `Premium +${order.premiumDays} дн.`
      : order.boosterDays > 0 ? `Бустер "Опыт+Честь" +${order.boosterDays} дн.`
      : '?';
    objs.push(this.add.text(dx, dy - dh / 2 + 16, 'ОПЛАТА USDT (TRC-20)', this.O('14px', '#ffd54f'))
      .setOrigin(0.5, 0).setDepth(201));
    objs.push(this.add.text(dx, dy - dh / 2 + 42,
      `${order.amountUsdt} USDT  →  ${rewardStr}`, this.F('12px', '#cce8f0'))
      .setOrigin(0.5, 0).setDepth(201));

    objs.push(this.add.text(dx, dy - dh / 2 + 72, 'Адрес для перевода (нажмите, чтобы скопировать):',
      this.F('11px', '#6aacb8')).setOrigin(0.5, 0).setDepth(201));
    const addrBg = this.add.rectangle(dx, dy - dh / 2 + 100, dw - 40, 32, 0x0d1828)
      .setStrokeStyle(1, 0x3a5a7a, 0.9).setDepth(200).setInteractive({ useHandCursor: true });
    const addrTxt = this.add.text(dx, dy - dh / 2 + 100, order.address, this.F('12px', '#4dd0e1'))
      .setOrigin(0.5).setDepth(201);
    objs.push(addrBg, addrTxt);
    addrBg.on('pointerdown', () => {
      navigator.clipboard?.writeText(order.address)
        .then(() => this._showError('Адрес скопирован', '#aed581'))
        .catch(() => this._showError('Буфер обмена недоступен — скопируйте вручную'));
    });

    const statusTxt = this.add.text(dx, dy - dh / 2 + 150, 'Ожидание платежа…', this.O('12px', '#ffb74d'))
      .setOrigin(0.5, 0).setDepth(201);
    const timerTxt = this.add.text(dx, dy - dh / 2 + 176, '', this.F('11px', '#6aacb8'))
      .setOrigin(0.5, 0).setDepth(201);
    objs.push(statusTxt, timerTxt);

    const closeBtn = this.add.rectangle(dx, dy + dh / 2 - 30, 140, 34, 0x1a0a0a)
      .setStrokeStyle(1.5, 0x995544, 1).setDepth(200).setInteractive({ useHandCursor: true });
    const closeTxt = this.add.text(dx, dy + dh / 2 - 30, 'ЗАКРЫТЬ', this.F('12px', '#aa6655')).setOrigin(0.5).setDepth(201);
    objs.push(closeBtn, closeTxt);
    closeBtn.on('pointerover', () => closeBtn.setFillStyle(0x2a1010));
    closeBtn.on('pointerout',  () => closeBtn.setFillStyle(0x1a0a0a));
    closeBtn.on('pointerdown', () => this._closeDepositModal());

    this._depositObjs = objs;

    // Сервер шлёт datetime.utcnow().isoformat() — БЕЗ 'Z'/offset (наивный UTC).
    // new Date(...) без суффикса трактует строку как ЛОКАЛЬНОЕ время браузера,
    // а не UTC — без явного 'Z' отсчёт до истечения был бы сдвинут на
    // часовой пояс игрока. Достраиваем 'Z', если сервер его ещё не прислал.
    const isoUtc = /[Zz]|[+-]\d\d:\d\d$/.test(order.expiresAt) ? order.expiresAt : order.expiresAt + 'Z';
    const expiresAtMs = new Date(isoUtc).getTime();
    const tickTimer = () => {
      const msLeft = expiresAtMs - Date.now();
      if (msLeft <= 0) { timerTxt.setText('Истекает…'); return; }
      const m = Math.floor(msLeft / 60000), s = Math.floor((msLeft % 60000) / 1000);
      timerTxt.setText(`Заказ действителен ещё ${m}:${String(s).padStart(2, '0')}`);
    };
    tickTimer();
    this._depositTickEvent = this.time.addEvent({ delay: 1000, loop: true, callback: tickTimer });

    // Поллинг раз в 5с — сервер сам проверяет TronGrid раз в 20с (см.
    // CRYPTO_POLL_INTERVAL_SEC в main.py), чаще спрашивать смысла нет, но
    // и разрежать сильно тоже — игрок ждёт живого фидбека на экране.
    const poll = () => {
      walletDepositOrderStatus(order.orderId).then(st => {
        if (!statusTxt.active) return; // модалка уже закрыта
        if (st.status === 'paid') {
          this._depositPollEvent?.remove(); this._depositTickEvent?.remove();
          timerTxt.setText('');
          statusTxt.setColor('#aed581').setText('Оплачено! Зачисление…');
          walletClaimCredit().then(res => {
            this._applyClaimResult(res, gs, refreshBal);
            const doneStr = res.credited > 0 ? `+${res.credited} ⭐`
              : res.premiumDays > 0 ? `Premium +${res.premiumDays} дн.`
              : res.boosterXpHonorMs > 0 ? `Бустер +${Math.round(res.boosterXpHonorMs / 86_400_000)} дн.`
              : '';
            if (statusTxt.active) statusTxt.setText(`✓ Зачислено ${doneStr}`);
            this.time.delayedCall(1600, () => this._closeDepositModal());
          }).catch(() => {
            if (statusTxt.active) statusTxt.setText('Оплачено — не удалось забрать начисление, попробуйте закрыть и открыть магазин снова');
          });
        } else if (st.status === 'expired') {
          this._depositPollEvent?.remove(); this._depositTickEvent?.remove();
          statusTxt.setColor('#ff8a80').setText('Заказ истёк — создайте новый');
          timerTxt.setText('');
        }
      }).catch(() => { /* временная сетевая ошибка — просто ждём следующий тик */ });
    };
    this._depositPollEvent = this.time.addEvent({ delay: 5000, loop: true, callback: poll });
  }

  _closeDepositModal() {
    this._depositPollEvent?.remove(); this._depositPollEvent = null;
    this._depositTickEvent?.remove(); this._depositTickEvent = null;
    (this._depositObjs || []).forEach(o => o?.destroy());
    this._depositObjs = [];
  }

}
