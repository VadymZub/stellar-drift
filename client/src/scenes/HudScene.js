import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { COLORS, UI_RES, BASE_SCAN_RADIUS, DPR, ARMORED_TRAIN_SECTORS } from '../constants.js';
import { i18n } from '../i18n.js';
import { levelInfo, MAX_LEVEL } from '../leveling.js';
import { minimapRect, fit } from '../systems/minimap.js';
import { SECTORS, galaxy } from '../galaxy.js';
import { getActiveMissionSectorTargets } from '../data/missions.js';
import { countConsumableInInventory, addConsumableToInventory } from '../items.js';
import { prerenderTex } from '../utils/prerenderTex.js';
import { loadSettings, saveSettings, getMinimapDims } from '../settings.js';
import { GroupSystem } from '../systems/GroupSystem.js';
import { PvpClient } from '../systems/PvpClient.js';
import { blacklistList, blacklistAdd, blacklistRemove } from '../api.js';
import { MailClient } from '../systems/MailClient.js';
import ArmoredTrain from '../entities/ArmoredTrain.js';

const BOOSTER_DEFS = [
  { key: 'boost_damage', icon: '⚔', label: 'Урон +10%',  color: '#ff8c40' },
  { key: 'boost_hull',   icon: '🛡', label: 'Броня +20%', color: '#4fc3f7' },
  { key: 'boost_shield', icon: '💠', label: 'Щит +20%',   color: '#4db6ac' },
  { key: 'boost_xp',    icon: '⚡', label: 'Опыт +25%',  color: '#ffd54f' },
];

const AB_TIPS = {
  'use:repair_pack':          { name: 'Ремонтный пакет',      desc: '+30% HP мгновенно\nКД 90с' },
  'use:speed_boost':          { name: 'Ускоритель',            desc: '+50% скорость на 15с\nКД 120с' },
  'use:scanner_pulse':        { name: 'Импульс сканера',       desc: 'Сканирует окружение в радиусе\nКД 180с' },
  'use:emergency_warp':       { name: 'Аварийный варп',        desc: 'Мгновенный варп на ближайшую базу\nКД 10 мин' },
  'use:ammo_plasma':          { name: 'Боеприпасы (плазма)',   desc: 'Стандартный боекомплект для пушек' },
  'use:ammo_plasma_elite':    { name: 'Боеприпасы (элита)',    desc: '+50% урон пушек' },
  'use:ammo_laser':           { name: 'Боеприпасы (лазер)',    desc: 'Боекомплект для лазеров' },
  'overcharge_shot':          { name: 'Перегрузочный выстрел', desc: '×2.0 урон следующим выстрелом\nКД 25с' },
  'salvo':                    { name: 'Залп',                  desc: '5 выстрелов подряд из всех орудий\nКД 55с' },
  'berserker':                { name: 'Берсерк',               desc: '+25–60% урон при низком HP\nКД 60–90с' },
  'emergency_repair':         { name: 'Аварийный ремонт',      desc: '+30% HP мгновенно\nКД 120с' },
  'shield_burst':             { name: 'Всплеск щита',          desc: '+120% щит мгновенно\nКД 85с' },
  'stealth_sprint':           { name: 'Скрытный рывок',        desc: '+35% скорость + стелс 8с\nКД 55с' },
  'ship:helion_volley':        { name: 'Залповый огонь',        desc: 'Один залп с ×1.25 уроном\nКД 40с' },
  'ship:argosy_repair':        { name: 'Аварийный ремонт',      desc: '+25% HP\nКД 55с' },
  'ship:drifter_jump':         { name: 'Фазовый прыжок',        desc: 'Телепорт вперёд по курсу\nКД 60с' },
  'ship:stiletto_afterburner': { name: 'Форсаж',                desc: '+100% скорость на 4с\nКД 50с' },
  'ship:aegis_dome':           { name: 'Щитовой купол',         desc: 'Непробиваемый щит на 5с\nКД 90с' },
  'ship:phantom_cloak':        { name: 'Маскировка',            desc: 'Стелс 10с, +30% скорость\nКД 3 мин' },
  'ship:wisp_recall':          { name: 'Телепорт на базу',      desc: 'Мгновенный возврат на базу\nКД 3 мин' },
  'argus:pulsar':              { name: 'Квантовый пульсар',     desc: '8 лучей · 900 урон/касание · 4с\nКД 25с' },
  'argus:cocoon':              { name: 'Фазовый кокон',         desc: '+30% HP и щит + неуязвимость 2с\nВо время кокона пульсар урон не наносит\nКД 60с' },
  'argus:missiles':            { name: 'Ракетный залп',         desc: '8 самонаводящихся ракет · 2000 урон/ракета\nЦели: все враги вокруг\nКД 35с' },
  'argus:phase_strike':        { name: 'Фазовый удар',          desc: 'Прицел врагов сбит на 3с\nТелепорт за спину цели · камера следует\nКД 50с' },
};

// Оверлей-сцена HUD. Читает статы из GameScene, слушает события лога.
export default class HudScene extends Phaser.Scene {
  constructor() { super({ key: 'HudScene', active: false }); }

  create() {
    this.gs = this.scene.get('GameScene');

    // Смена ширины/высоты окна (main.js: window resize → game.scale.resize())
    // меняет this.scale.width/height, но НЕ трогает уже созданные объекты —
    // все элементы HUD посчитаны от W/H ОДИН раз здесь, в create(), и застревают
    // на старых координатах (см. диалог со скриншотом: кнопка бустеров и
    // экшн-бар "плавают" не там, где должны, после изменения ширины окна).
    // Полный restart() пересчитывает всё заново от актуального this.scale.*,
    // включая позиции, восстановленные из localStorage (уже клэмпятся под
    // текущий W/H на месте создания) — надёжнее, чем point-fix каждого элемента.
    // ДЕБАУНС обязателен — активное перетаскивание края окна шлёт 'resize'
    // десятки раз/сек, а restart() рвёт и переоткрывает чат-WS (см. _connectChatWS)
    // на КАЖДЫЙ такой вызов; итог — модалка "Соединение потеряно" бешено мерцает
    // всё время перетаскивания (баг из диалога: "мерцает, глаза болят"), плюс
    // реальная гонка ("WebSocket is closed before the connection is established"
    // в консоли). Ждём 400мс тишины после ПОСЛЕДНЕГО resize, прежде чем реально
    // рестартовать — во время активного драга restart() не срабатывает вовсе.
    let _resizeTimer = null;
    const _onResize = () => {
      if (_resizeTimer) clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(() => this.scene.restart(), 400);
    };
    this.scale.on('resize', _onResize);
    this.events.once('shutdown', () => {
      this.scale.off('resize', _onResize);
      if (_resizeTimer) clearTimeout(_resizeTimer);
    });

    // Apply UI Scale from settings
    const _s = loadSettings();
    this.cameras.main.setZoom(_s.uiScale / 100);

    this.bars = this.add.graphics().setDepth(100);
    this.miniGfx = this.add.graphics().setDepth(101);   // миникарта — векторные блипы
    // Дёрти-чек кэш (см. update() ниже, "Graphics.clear()+перерисовка... дорогая
    // операция") — обычные поля сцены, ПЕРЕЖИВАЮТ scene.restart() (это тот же JS-объект,
    // restart() пересоздаёт только display-объекты типа this.bars выше). Без сброса —
    // свежий ПУСТОЙ Graphics после ресайза-рестарта (см. комментарий про 'resize' в
    // начале create()) сравнивался со СТАРЫМ закэшированным значением ширины/цвета,
    // "ничего не изменилось" → g.clear()+перерисовка не вызывались НИКОГДА, пока реально
    // не изменится HP — полосы щита/корпуса пропадали после ресайза (баг из диалога:
    // "после ресайза страницы пропадают бары прочности и щита").
    this._lastPSW = this._lastPHW = this._lastHullColor = undefined;
    this._lastTargetKind = this._lastTSW = this._lastTHW = undefined;

    // Счётчик FPS (SettingsScene → Графика → "Счётчик FPS") — раньше тумблер существовал
    // только в настройках/localStorage, счётчика не было вообще нигде в коде.
    this._fpsTxt = this.add.text(8, 2, '', {
      fontFamily: 'Orbitron, sans-serif', fontSize: '13px', color: '#4de8a0', resolution: UI_RES,
    }).setDepth(300).setScrollFactor(0).setVisible(_s.showFps === true);
    this._fpsAccum = 0;

    // Потребление ОЗУ (SettingsScene → Графика → "Потребление ОЗУ") — JS heap этой
    // вкладки через performance.memory (нестандартный Chrome/Chromium API, в
    // Firefox/Safari недоступен — скрываем тумблер-текст, если его вообще нет).
    // Та же строка, что FPS (правее) — раньше стояла ниже и перекрывала полоску щита.
    this._ramTxt = this.add.text(80, 2, '', {
      fontFamily: 'Orbitron, sans-serif', fontSize: '13px', color: '#7ec8ff', resolution: UI_RES,
    }).setDepth(300).setScrollFactor(0).setVisible(_s.showRam === true && !!performance.memory);

    const F = (size, color = '#cfe9ee', weight = '600') =>
      ({ fontFamily: 'Inter, sans-serif', fontSize: size, color, fontStyle: weight, resolution: UI_RES });
    const O = (size, color = '#4dd0e1') =>
      ({ fontFamily: 'Orbitron, sans-serif', fontSize: size, color, resolution: UI_RES });

    // Подписи под миникартой — позиция пересчитывается каждый кадр под текущий размер карты
    this._mmSectorTxt = this.add.text(0, 0, '', F('10px', '#c8dde4', '600')).setOrigin(0.5, 0).setDepth(102)
      .setStroke('#060f18', 4);
    this._mmCoordTxt  = this.add.text(0, 0, '', O('10px', '#4dd0e1')).setOrigin(0.5, 0).setDepth(102)
      .setStroke('#060f18', 4);
    // Обратный отсчёт до ивента (нашествие/бронепоезд) на ТЕКУЩЕЙ карте — см.
    // GameScene._initEventCountdown/_mmEventNotice, только если старт в пределах 15 мин.
    this._mmEventTxt  = this.add.text(0, 0, '', O('11px', '#ffb300')).setOrigin(0.5, 0).setDepth(102)
      .setStroke('#060f18', 4).setVisible(false);

    // Панель игрока (лев-верх) — фиксированный вертикальный layout
    // Bar rows: icon (left) + bar (center, 155px) + value (right of bar, white)
    this._icoShield = this.add.text(18, 20, '🛡', F('12px', '#4dd0e1')).setDepth(101);
    this._valShield = this.add.text(202, 28, '', F('11px', '#d0eeff')).setOrigin(0, 0.5).setDepth(102);
    this._icoHull   = this.add.text(18, 44, '⚙', F('12px', '#66bb6a')).setDepth(101);
    this._valHull   = this.add.text(202, 52, '', F('11px', '#c8f0d0')).setOrigin(0, 0.5).setDepth(102);
    this.pSpeed     = this.add.text(20, 68, '', F('12px', '#9fb3b8')).setDepth(101);
    // Info panel items — position managed by _buildInfoPanel
    this.pCredits  = this.add.text(0, 0, '', F('13px', '#ffb74d')).setDepth(101).setVisible(false);
    this.pStarGold = this.add.text(0, 0, '', F('13px', '#ffd54f')).setDepth(101).setVisible(false);
    this.pHonor    = this.add.text(0, 0, '', F('13px', '#ef9a9a')).setDepth(101).setVisible(false);
    this.pCorpRep  = this.add.text(0, 0, '', F('13px', '#80cbc4')).setDepth(101).setVisible(false);
    this.pPilot    = this.add.text(0, 0, '', O('12px', '#b39ddb')).setDepth(101).setVisible(false);
    this.pRank     = this.add.text(0, 0, '', O('12px', '#ffcc80')).setDepth(101).setVisible(false);
    this.pXpTxt    = this.add.text(0, 0, '', F('10px', '#9fb3b8')).setOrigin(1, 0).setDepth(101).setVisible(false);
    // Кэш "последнее показанное значение" (см. update() ниже — пропускает setText,
    // если статы не менялись) переживает scene.restart() как обычное поле сцены, а
    // сами Text-объекты выше — нет (Phaser уничтожает их при restart и создаёт заново
    // пустыми). Без сброса кэша здесь панель информации оставалась пустой после
    // ресайза до первого РЕАЛЬНОГО изменения кредитов/опыта/etc (баг из диалога).
    this._lastIpCredits = this._lastIpStarGold = this._lastIpHonor = undefined;
    this._lastIpCorpRepPct = this._lastIpXp = this._lastIpRankName = undefined;

    // Панель цели (центр-верх)
    this.tName = this.add.text(0, 16, '', O('16px', '#ef5350')).setOrigin(0.5, 0).setDepth(101);
    this.tHullTxt = this.add.text(0, 44, '', F('11px', '#ef9a9a')).setOrigin(0.5, 0).setDepth(101);

    // Безопасная зона (центр-верх под целью)
    this.safeTxt = this.add.text(0, 0, i18n.t('hud.safezone'), O('13px', '#4dd0e1'))
      .setOrigin(0.5, 0).setDepth(101).setVisible(false);

    // Подсказка управления (низ-центр)
    this.hint = this.add.text(0, 0, i18n.t('hud.controls'), F('11px', '#7e9398'))
      .setOrigin(0.5, 1).setDepth(101);

    // Лог событий (лев-низ) — logEntries хранит {t: Text, born} и Text-объекты не
    // переживают scene.restart() (Phaser уничтожает все display-объекты сцены), но сам
    // текст сообщений должен — иначе лог визуально пустел после ресайза (баг из диалога,
    // тот же класс проблемы, что и у инфо-панели выше). _logHistory — параллельное
    // хранилище только СЫРЫХ данных (текст+время), переживает restart через ||, как и
    // остальные поля этой сцены; отсюда пересобираем Text-объекты заново.
    this._logHistory = this._logHistory || [];
    this.logEntries = this._logHistory.map(e => ({
      t: this.add.text(0, 0, e.text, {
        fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#cfe9ee', resolution: UI_RES,
        wordWrap: { width: 276 },
      }).setDepth(101),
      born: e.born,
    }));
    this.game.events.on('hud-log', this.pushLog, this);
    this.events.once('shutdown', () => this.game.events.off('hud-log', this.pushLog, this));

    // Action bar (10 slots)
    this._abSlots = null;
    this._buildActionBarHUD();

    // Cargo indicator (always visible)
    this._cargoTxt = this.add.text(0, 0, '', F('11px', '#7e9398')).setOrigin(1, 0.5).setDepth(101);

    // Настройки — раньше отдельная перетаскиваемая кнопка здесь (см. диалог "прикрепи
    // настройки, сейчас это отдельная кнопка") — теперь часть общего ряда социальных
    // кнопок, см. _buildHudSocialButtons (вызывается ниже в create()).

    // Base nav bar (dynamic — built/destroyed on atBase change)
    this._navObjs = null;
    this._navBtnItems = null;
    this._lastAtBase = false;

    // DEV: кнопка Premium (правый нижний угол)
    if (this.gs.devMode) {
      const W = this.scale.width, H = this.scale.height;
      const BW = 110, BH = 26, BX = W - BW - 8, BY = H - BH - 8;
      const devBg = this.add.rectangle(BX, BY, BW, BH, 0x1a0d00, 0.92)
        .setOrigin(0, 0).setDepth(200).setInteractive({ useHandCursor: true })
        .setStrokeStyle(1, 0x554422, 0.8);
      this._devPremTxt = this.add.text(BX + BW / 2, BY + BH / 2, 'DEV  ⭐ premium',
        F('10px', '#ffb74d')).setOrigin(0.5).setDepth(201);
      devBg.on('pointerdown', () => {
        this.gs.premium = !this.gs.premium;
        this._devPremTxt.setText(this.gs.premium ? 'DEV  ⭐ PREMIUM ✓' : 'DEV  ⭐ premium');
        this._devPremTxt.setColor(this.gs.premium ? '#ffd54f' : '#ffb74d');
        devBg.setFillStyle(this.gs.premium ? 0x2a1a00 : 0x1a0d00, 0.92);
      });
      devBg.on('pointerover', () => devBg.setAlpha(0.75));
      devBg.on('pointerout',  () => devBg.setAlpha(1));
    }

    this._buildInfoPanel();
    this._buildLogPanel();
    this._buildChatPanel();

    // Social windows (group + friends)
    this._groupBossHpRatio  = 0;
    this._groupWinVisible   = false;
    this._friendsWinVisible = false;
    this._friendsList       = [];
    this._blacklist         = [];
    this._frWinTab          = 'friends'; // 'friends' | 'blacklist'
    this._lastSectorSent    = null;
    this._grpWinCollapsed   = _s.grpWinCollapsed  ?? false;
    this._frWinCollapsed    = _s.frWinCollapsed   ?? false;
    this._grpWinDrag         = { active: false, ox: 0, oy: 0 };
    this._frWinDrag          = { active: false, ox: 0, oy: 0 };
    this._groupInviteTarget  = null;
    this._groupPendingInvites = new Map();
    this._groupEventLog      = [];
    // Входящее приглашение (кто-то позвал МЕНЯ) — раньше единственным способом принять
    // было набрать команду "/принять <ник>" в чат, а сама подсказка тонула мелким
    // текстом в логе (баг из диалога: "текст о том что пригласили очень мелко и не
    // влазит в окно", "не понятно как принять приглашение"). Теперь — отдельная
    // заметная строка в окне ГРУППА с кнопками Принять/Отклонить, см. _rebuildGroupWin.
    this._incomingInvite     = null; // {from, dungeon} | null
    this._buildHudSocialButtons();
    this._buildGroupWin();
    this._buildFriendsWin();
    this._loadBlacklist();
    this._initSocialWinDrag();
    this._createBoosterWidget();

    // F key → toggle friends window (работает и на базе, и в космосе)
    this.input.keyboard?.on('keydown-F', () => {
      this._toggleFriendsWin();
    });
  }

  _buildActionBarHUD() {
    const W = this.scale.width, H = this.scale.height;
    const SW = 52, SH = 52, GAP = 4, N = 10;
    const R = 5;
    const startX = Math.round((W - (N * SW + (N - 1) * GAP)) / 2);
    const barY   = H - SH - 10;

    this._barEditMode  = false;
    this._barPickedIdx = null;

    this._abSlots = Array.from({ length: N }, (_, i) => {
      const sx = startX + i * (SW + GAP);

      const bg = this.add.graphics().setDepth(101);
      bg.fillStyle(0x0a1828, 0.92);
      bg.fillRoundedRect(sx, barY, SW, SH, R);
      bg.lineStyle(1, 0x1e4060, 1);
      bg.strokeRoundedRect(sx, barY, SW, SH, R);

      // Hit zone: ЛКМ = активация / ПКМ = удалить / режим ↔ = перестановка
      const hitZone = this.add.rectangle(sx + SW / 2, barY + SH / 2, SW, SH)
        .setInteractive({ useHandCursor: true }).setDepth(106).setAlpha(0.001);
      hitZone.on('pointerdown', (p) => {
        this._cancelAbTip();
        const gs = this.gs;
        if (p.button === 2) {
          // ПКМ: удалить слот только в режиме редактирования
          if (!this._barEditMode) return;
          const bar = gs.actionBar ? [...gs.actionBar] : Array(10).fill(null);
          if (!bar[i]) return;
          bar[i] = null;
          gs.actionBar = bar;
          gs._saveState?.();
          this._rebuildActionBarIcons();
          return;
        }
        if (!this._barEditMode) {
          // ЛКМ: активировать скилл / расходник
          if (!gs.atBase) gs._activateSkillSlot(i);
          return;
        }
        // Режим ↔: перестановка слотов
        if (this._barPickedIdx === null) {
          this._barPickedIdx = i;
          this._setBarPickHighlight(i, true);
        } else if (this._barPickedIdx === i) {
          this._setBarPickHighlight(i, false);
          this._barPickedIdx = null;
        } else {
          const bar = [...(gs.actionBar || Array(10).fill(null))];
          [bar[i], bar[this._barPickedIdx]] = [bar[this._barPickedIdx], bar[i]];
          gs.actionBar = bar;
          gs._saveState?.();
          this._setBarPickHighlight(this._barPickedIdx, false);
          this._barPickedIdx = null;
          this._rebuildActionBarIcons();
        }
      });

      const cdGfx = this.add.graphics().setDepth(103);
      const hkStyle = { fontFamily: 'Inter, sans-serif', fontSize: '9px', color: '#4a6680', resolution: UI_RES };
      const hk = this.add.text(sx + 3, barY + 2, i < 9 ? `${i + 1}` : '0', hkStyle).setDepth(104);
      const cdStyle = { fontFamily: 'Orbitron, sans-serif', fontSize: '12px', color: '#ffffff', resolution: UI_RES };
      const cdTxt = this.add.text(sx + SW / 2, barY + SH / 2, '', cdStyle).setOrigin(0.5).setDepth(104);

      hitZone.on('pointerover', () => {
        this._cancelAbTip();
        this._abTipTimer = this.time.delayedCall(1200, () => this._showAbTip(i));
      });
      hitZone.on('pointerout',  () => this._cancelAbTip());

      return { sx, sy: barY, SW, SH, R, bg, cdGfx, hk, cdTxt, iconImg: null, _key: null, _pickGfx: null };
    });

    // Edit mode toggle button — right of bar
    const ebX = startX + N * (SW + GAP) + 6;
    const ebW = 30, ebH = 30;
    this._editBtn = this.add.rectangle(ebX, barY + (SH - ebH) / 2, ebW, ebH, 0x0a1828, 0.88)
      .setOrigin(0, 0).setStrokeStyle(1, 0x2a4060).setInteractive({ useHandCursor: true }).setDepth(105);
    this._editBtnTxt = this.add.text(ebX + ebW / 2, barY + SH / 2, '↔',
      { fontFamily: 'Inter, sans-serif', fontSize: '17px', color: '#3a5a70', resolution: UI_RES })
      .setOrigin(0.5).setDepth(106);
    this._editBtn.on('pointerover', () => { if (!this._barEditMode) this._editBtn.setFillStyle(0x142030, 0.95); });
    this._editBtn.on('pointerout',  () => { if (!this._barEditMode) this._editBtn.setFillStyle(0x0a1828, 0.88); });
    this._editBtn.on('pointerdown', () => this._toggleBarEditMode());

    this._rebuildActionBarIcons();

    // Tooltip panel (hidden by default)
    this._abTipTimer = null;
    this._abTipBg   = this.add.graphics().setDepth(120).setVisible(false);
    this._abTipName = this.add.text(0, 0, '', {
      fontFamily: 'Orbitron, sans-serif', fontSize: '11px', color: '#e0f4ff',
      fontStyle: 'bold', resolution: UI_RES,
    }).setDepth(121).setVisible(false);
    this._abTipDesc = this.add.text(0, 0, '', {
      fontFamily: 'Inter, sans-serif', fontSize: '10px', color: '#7aacbc',
      resolution: UI_RES, wordWrap: { width: 165 },
    }).setDepth(121).setVisible(false);
  }

  _cancelAbTip() {
    if (this._abTipTimer) { this._abTipTimer.remove(); this._abTipTimer = null; }
    this._abTipBg?.setVisible(false);
    this._abTipName?.setVisible(false);
    this._abTipDesc?.setVisible(false);
  }

  _showAbTip(i) {
    const key = ((this.gs?.actionBar) || [])[i];
    if (!key) return;
    const tip = AB_TIPS[key];
    if (!tip) return;

    const slot = this._abSlots?.[i];
    if (!slot) return;

    const PAD = 8, W_TIP = 180;
    this._abTipName.setText(tip.name);
    this._abTipDesc.setText(tip.desc);

    const nameH = this._abTipName.height;
    const descH = this._abTipDesc.height;
    const tipH  = PAD * 2 + nameH + (tip.desc ? 4 + descH : 0);

    const cx = slot.sx + slot.SW / 2;
    let tx = cx - W_TIP / 2;
    const W = this.scale.width;
    if (tx < 4) tx = 4;
    if (tx + W_TIP > W - 4) tx = W - 4 - W_TIP;

    const ty = slot.sy - tipH - 6;

    this._abTipBg.clear();
    this._abTipBg.fillStyle(0x060e18, 0.94);
    this._abTipBg.fillRoundedRect(tx, ty, W_TIP, tipH, 5);
    this._abTipBg.lineStyle(1, 0x2a5070, 1);
    this._abTipBg.strokeRoundedRect(tx, ty, W_TIP, tipH, 5);
    this._abTipBg.setVisible(true);

    this._abTipName.setPosition(tx + PAD, ty + PAD).setVisible(true);
    if (tip.desc) {
      this._abTipDesc.setPosition(tx + PAD, ty + PAD + nameH + 4).setVisible(true);
    } else {
      this._abTipDesc.setVisible(false);
    }
  }

  _toggleBarEditMode() {
    this._barEditMode = !this._barEditMode;
    if (!this._barEditMode && this._barPickedIdx !== null) {
      this._setBarPickHighlight(this._barPickedIdx, false);
      this._barPickedIdx = null;
    }
    this._editBtn.setFillStyle(this._barEditMode ? 0x251000 : 0x0a1828, this._barEditMode ? 0.95 : 0.88);
    this._editBtnTxt.setColor(this._barEditMode ? '#ffb74d' : '#3a5a70');
    this._editBtn.setStrokeStyle(1, this._barEditMode ? 0xffb74d : 0x2a4060);
  }

  _setBarPickHighlight(idx, on) {
    const slot = this._abSlots?.[idx];
    if (!slot) return;
    slot._pickGfx?.destroy();
    slot._pickGfx = null;
    if (on) {
      slot._pickGfx = this.add.graphics().setDepth(108);
      slot._pickGfx.lineStyle(Math.round(2.5 * DPR), 0xffb74d, 1);
      slot._pickGfx.strokeRoundedRect(slot.sx, slot.sy, slot.SW, slot.SH, slot.R ?? Math.round(5 * DPR));
      slot.iconImg?.setAlpha(0.45);
    } else {
      slot.iconImg?.setAlpha(1.0);
    }
  }

  _rebuildActionBarIcons() {
    if (!this._abSlots) return;
    const gs = this.gs;
    const SHIP_ACCENT = {
      'ship:helion_volley':        0xffb74d,
      'ship:argosy_repair':        0x4fc3f7,
      'ship:drifter_jump':         0x4db6ac,
      'ship:stiletto_afterburner': 0x29b6f6,
      'ship:anvil_lockdown':       0x90a4ae,
      'ship:drover_scan':          0xab47bc,
      'ship:aegis_dome':           0x42a5f5,
      'ship:phantom_cloak':        0x9575cd,
      'ship:wisp_recall':          0x66bb6a,
      'argus:pulsar':              0x00d4ff,
      'argus:cocoon':              0xe0f7fa,
      'argus:missiles':            0xff8c00,
      'argus:phase_strike':        0xce93d8,
    };
    this._abSlots.forEach((slot, i) => {
      const key = (gs.actionBar || [])[i] || null;
      slot._key = key;
      slot._lastCdBarH = undefined; // force a fresh cdGfx redraw decision post-rebuild
      if (slot.iconImg) { slot.iconImg.destroy(); slot.iconImg = null; }
      if (slot._pickGfx) { slot._pickGfx.destroy(); slot._pickGfx = null; }

      // Redraw slot border: accent color for ship abilities, default otherwise
      slot.bg.clear();
      slot.bg.fillStyle(0x0a1828, 0.92);
      const R = slot.R ?? Math.round(5 * DPR);
      slot.bg.fillRoundedRect(slot.sx, slot.sy, slot.SW, slot.SH, R);
      const accent = (key?.startsWith('ship:') || key?.startsWith('argus:')) ? (SHIP_ACCENT[key] ?? 0x4a7090) : null;
      if (accent) {
        slot.bg.lineStyle(Math.round(2 * DPR), accent, 0.85);
      } else {
        slot.bg.lineStyle(Math.max(1, Math.round(DPR)), 0x1e4060, 1);
      }
      slot.bg.strokeRoundedRect(slot.sx, slot.sy, slot.SW, slot.SH, R);

      const isConsumable = !!key?.startsWith('use:');
      if (isConsumable) {
        slot.cdTxt.setPosition(slot.sx + slot.SW / 2, slot.sy + slot.SH - Math.round(2 * DPR)).setOrigin(0.5, 1);
        try { slot.cdTxt.setFontSize(`${Math.round(10 * DPR)}px`); } catch (_) {}
      } else {
        slot.cdTxt.setPosition(slot.sx + slot.SW / 2, slot.sy + slot.SH / 2).setOrigin(0.5, 0.5);
        try { slot.cdTxt.setFontSize(`${Math.round(12 * DPR)}px`); } catch (_) {}
      }

      if (!key) return;
      if (key.startsWith('ship:') || key.startsWith('argus:')) {
        const srcKey = this._ensureShipSkillTex(key);
        const iconSz = slot.SW;
        slot.iconImg = this.add.image(slot.sx + slot.SW / 2, slot.sy + slot.SH / 2,
            prerenderTex(this, srcKey, iconSz, iconSz))
          .setDisplaySize(iconSz, iconSz).setDepth(102);
        return;
      }
      const texKey = isConsumable ? `consumable_${key.slice(4)}` : `skill_${key}`;
      if (!this.textures.exists(texKey)) return;
      const iconSz  = isConsumable ? Math.round(40 * DPR) : slot.SW;
      const iconY   = isConsumable ? slot.sy + slot.SH / 2 - Math.round(5 * DPR) : slot.sy + slot.SH / 2;
      slot.iconImg = this.add.image(slot.sx + slot.SW / 2, iconY,
          prerenderTex(this, texKey, iconSz, iconSz))
        .setDisplaySize(iconSz, iconSz).setDepth(102);
    });
  }

  _ensureShipSkillTex(key) {
    const pngKey = key.replace(':', '_');
    if (this.textures.exists(pngKey)) return pngKey;

    // Procedural fallback for missing PNGs
    const cacheKey = `__ss_${pngKey}`;
    if (this.textures.exists(cacheKey)) return cacheKey;
    const INFO = {
      'ship:helion_volley':         { label: 'ЗП', bg: '#2a1508', fg: '#ffb74d', border: '#ffb74d' },
      'ship:argosy_repair':         { label: 'РМ', bg: '#081624', fg: '#4fc3f7', border: '#4fc3f7' },
      'ship:drifter_jump':          { label: 'ПР', bg: '#071a18', fg: '#4db6ac', border: '#4db6ac' },
      'ship:stiletto_afterburner':  { label: 'ФС', bg: '#071420', fg: '#29b6f6', border: '#29b6f6' },
      'ship:anvil_lockdown':        { label: 'УП', bg: '#141418', fg: '#90a4ae', border: '#90a4ae' },
      'ship:drover_scan':           { label: 'СК', bg: '#140d1a', fg: '#ab47bc', border: '#ab47bc' },
      'ship:aegis_dome':            { label: 'ЩК', bg: '#071020', fg: '#42a5f5', border: '#42a5f5' },
      'ship:phantom_cloak':         { label: 'МС', bg: '#0d0a18', fg: '#7e57c2', border: '#7e57c2' },
      'ship:wisp_recall':           { label: 'БЗ', bg: '#081408', fg: '#66bb6a', border: '#66bb6a' },
      'argus:pulsar':               { label: 'КП', bg: '#00141e', fg: '#00d4ff', border: '#00d4ff' },
      'argus:cocoon':               { label: 'ФК', bg: '#0a1218', fg: '#e0f7fa', border: '#e0f7fa' },
      'argus:missiles':             { label: 'РЗ', bg: '#1a0c00', fg: '#ff8c00', border: '#ff8c00' },
      'argus:phase_strike':         { label: 'ФУ', bg: '#130a1a', fg: '#ce93d8', border: '#ce93d8' },
    };
    const info = INFO[key] || { label: '??', bg: '#0a0a14', fg: '#7e9398', border: '#7e9398' };
    const sz = Math.round(104 * DPR); // 2× physical slot size
    const sw = Math.max(2, Math.round(4 * DPR));
    const ct = this.textures.createCanvas(cacheKey, sz, sz);
    const ctx = ct.getContext();
    ctx.fillStyle = info.bg;
    ctx.fillRect(0, 0, sz, sz);
    ctx.strokeStyle = info.border;
    ctx.lineWidth = sw;
    ctx.strokeRect(sw / 2, sw / 2, sz - sw, sz - sw);
    ctx.fillStyle = info.fg;
    ctx.font = `bold ${Math.round(32 * DPR)}px Orbitron, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(info.label, sz / 2, sz / 2);
    ct.refresh();
    return cacheKey;
  }

  _updateActionBarHUD(time) {
    if (!this._abSlots) return;
    const gs  = this.gs;
    const bar = gs.actionBar || [];
    if (this._abSlots.some((s, i) => s._key !== (bar[i] || null))) this._rebuildActionBarIcons();

    for (let i = 0; i < 10; i++) {
      const slot  = this._abSlots[i];
      const key   = bar[i] || null;

      // Прогресс-полоска (cdGfx) перерисовывается только когда её высота реально
      // изменилась — Graphics.clear()+redraw на все 10 слотов КАЖДЫЙ кадр, включая
      // пустые/неактивные слоты без кулдауна, заметно грузило рендер (см.
      // профилировку). null = полоска не нужна (нет кулдауна прямо сейчас).
      const setCdBar = (barH) => {
        if (barH === slot._lastCdBarH) return;
        slot._lastCdBarH = barH;
        slot.cdGfx.clear();
        if (barH !== null) {
          slot.cdGfx.fillStyle(0x000000, 0.68);
          slot.cdGfx.fillRoundedRect(slot.sx, slot.sy, slot.SW, barH, slot.R ?? Math.round(5 * DPR));
        }
      };

      if (key?.startsWith('use:')) {
        const buffEnd = (gs._consBuffEndTimes || {})[key] || 0;
        const buffRem = Math.max(0, buffEnd - time);
        const cdEnd   = gs.skillCooldowns[key] || 0;
        const cdMs    = gs._skillCooldownMs(key);
        const cdRem   = Math.max(0, cdEnd - time);
        const type    = key.slice(4);
        const invCount  = countConsumableInInventory(gs.inventory || [], type);
        const ammoCount = (gs.ammoSlots || []).reduce((s, sl) => s + (sl.type === type ? sl.count : 0), 0);
        const total     = invCount + ammoCount;
        if (buffRem > 0) {
          setCdBar(null);
          slot.cdTxt.setPosition(slot.sx + slot.SW / 2, slot.sy + slot.SH / 2).setOrigin(0.5, 0.5).setColor('#4de8a0');
          this._setText(slot.cdTxt, `${Math.ceil(buffRem / 1000)}`);
          if (slot.iconImg) slot.iconImg.setAlpha(1.0);
        } else if (cdRem > 0) {
          setCdBar(Math.ceil(slot.SH * (cdRem / cdMs)));
          slot.cdTxt.setPosition(slot.sx + slot.SW / 2, slot.sy + slot.SH / 2).setOrigin(0.5, 0.5).setColor('#ffffff');
          this._setText(slot.cdTxt, `${Math.ceil(cdRem / 1000)}`);
          if (slot.iconImg) slot.iconImg.setAlpha(0.3);
        } else {
          setCdBar(null);
          slot.cdTxt.setPosition(slot.sx + slot.SW / 2, slot.sy + slot.SH - Math.round(2 * DPR)).setOrigin(0.5, 1).setColor('#ffffff');
          this._setText(slot.cdTxt, total > 0 ? `${total}` : '');
          if (slot.iconImg) slot.iconImg.setAlpha(total > 0 ? 1.0 : 0.3);
        }
        continue;
      }

      const buffEnd = (gs._consBuffEndTimes || {})[key] || 0;
      const buffRem = Math.max(0, buffEnd - time);
      const cdEnd   = key ? (gs.skillCooldowns[key] || 0) : 0;
      const cdMs    = key ? gs._skillCooldownMs(key) : 1;
      const cdRem   = Math.max(0, cdEnd - time);
      const lv      = (key?.startsWith('ship:') || key?.startsWith('argus:')) ? 1 : (gs.skillLevels?.[key] || 0);

      if (key && buffRem > 0) {
        setCdBar(null);
        slot.cdTxt.setColor('#4de8a0');
        this._setText(slot.cdTxt, `${Math.ceil(buffRem / 1000)}`);
        if (slot.iconImg) slot.iconImg.setAlpha(1.0);
      } else if (key && cdRem > 0) {
        setCdBar(Math.ceil(slot.SH * (cdRem / cdMs)));
        slot.cdTxt.setColor('#ffffff');
        this._setText(slot.cdTxt, `${Math.ceil(cdRem / 1000)}`);
        if (slot.iconImg) slot.iconImg.setAlpha(lv === 0 ? 0.25 : 0.45);
      } else {
        setCdBar(null);
        slot.cdTxt.setColor('#ffffff');
        this._setText(slot.cdTxt, '');
        if (slot.iconImg) slot.iconImg.setAlpha(lv === 0 ? 0.25 : 1.0);
      }
    }
  }

  _showBaseNav() {
    if (this._navObjs) return;
    if (this.scene.isActive('MapScene')) this.scene.stop('MapScene');
    this.scene.bringToTop('HudScene');
    const W = this.scale.width, H = this.scale.height;
    const BTN_W = 124, BTN_H = 36, GAP = 6;
    const EXIT_W = 160;
    const O = (s, c) => ({ fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES });

    const ITEMS = [
      { label: 'ГАРАЖ  G',   key: 'GarageScene' },
      { label: 'ГИЛЬДИЯ  N', key: 'ClanScene'   },
      { label: 'КОРП  H',    key: 'CorpScene'   },
      { label: 'МИССИИ  O',  key: 'MissionsScene' },
      { label: 'МАГАЗИН  P', key: 'ShopScene'   },
      { label: 'СКИЛЛЫ  K',  key: 'SkillScene'  },
      { label: 'СКЛАД  C',   key: 'CargoScene'  },
      { label: 'БОЙ С ТЕНЬЮ', key: 'ShadowBattleScene' },
    ];

    const totalW = ITEMS.length * BTN_W + (ITEMS.length - 1) * GAP + GAP + EXIT_W;
    const startX = Math.round((W - totalW) / 2);
    const barY   = 5;
    this._navObjs = [];
    this._navBtnItems = [];

    const navBg = this.add.rectangle(W / 2, barY + BTN_H / 2 + 2, W, BTN_H + 10, 0x020508, 1.0).setDepth(105);
    this._navObjs.push(navBg);

    ITEMS.forEach(({ label, key }, i) => {
      const bx = startX + i * (BTN_W + GAP) + BTN_W / 2;
      const btn = this.add.rectangle(bx, barY + BTN_H / 2, BTN_W, BTN_H, 0x081420, 0.95)
        .setDepth(106).setStrokeStyle(1, 0x1e3a50, 1).setInteractive({ useHandCursor: true });
      const txt = this.add.bitmapText(bx, barY + BTN_H / 2, 'bmf_orb12', label, 12)
        .setOrigin(0.5, 0.5).setDepth(107).setTint(0x3a8aaa);

      btn.on('pointerover',  () => { if (!this.scene.isActive(key)) { btn.setFillStyle(0x0f2535); txt.setTint(0x4dd0e1); this.tweens.add({ targets: [btn, txt], scaleY: 1.06, duration: 80, ease: 'Sine.easeOut' }); } });
      btn.on('pointerout',   () => { if (!this.scene.isActive(key)) { btn.setFillStyle(0x081420); txt.setTint(0x3a8aaa); this.tweens.add({ targets: [btn, txt], scaleY: 1.0, duration: 80, ease: 'Sine.easeOut' }); } });
      btn.on('pointerdown',  () => {
        if (this.scene.isActive('DonateScene')) this.scene.stop('DonateScene');
        if (this.scene.isActive(key)) this.gs._exitToSpace();
        else this.gs.toggleOverlay(key);
      });
      this._navObjs.push(btn, txt);
      this._navBtnItems.push({ btn, txt, key });
    });

    const exitX = startX + ITEMS.length * (BTN_W + GAP) + GAP + EXIT_W / 2;
    const exitBtn = this.add.rectangle(exitX, barY + BTN_H / 2, EXIT_W, BTN_H, 0x1a0808, 0.95)
      .setDepth(106).setStrokeStyle(1, 0x883333, 0.9).setInteractive({ useHandCursor: true });
    const exitTxt = this.add.bitmapText(exitX, barY + BTN_H / 2, 'bmf_orb12', 'ВЫХОД В КОСМОС', 12)
      .setOrigin(0.5, 0.5).setDepth(107).setTint(0xaa4444);
    exitBtn.on('pointerover',  () => { exitBtn.setFillStyle(0x2a1010); exitTxt.setTint(0xef5350); });
    exitBtn.on('pointerout',   () => { exitBtn.setFillStyle(0x1a0808); exitTxt.setTint(0xaa4444); });
    exitBtn.on('pointerdown', () => {
      if (this.scene.isActive('DonateScene')) this.scene.stop('DonateScene');
      this.gs._exitToSpace();
    });
    this._navObjs.push(exitBtn, exitTxt);
  }

  _hideBaseNav() {
    if (!this._navObjs) return;
    this._navObjs.forEach(o => o?.destroy());
    this._navObjs = null;
    this._navBtnItems = null;
  }

  pushLog(text) {
    const born = this.time.now;
    const t = this.add.text(0, 0, text, {
      fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#cfe9ee', resolution: UI_RES,
      wordWrap: { width: 276 },
    }).setDepth(101);
    this.logEntries.push({ t, born });
    this._logHistory.push({ text, born });
    while (this.logEntries.length > 7) this.logEntries.shift().t.destroy();
    while (this._logHistory.length > 7) this._logHistory.shift();
    this._refreshLogPanel();
  }

  _logContentH() {
    let h = 0;
    for (const e of this.logEntries) h += Math.max(16, Math.ceil(e.t.height)) + 2;
    return h;
  }

  update(time, delta) {
    // Обновляем счётчик независимо от того, есть ли уже игрок (полезен и на базе/в
    // меню) — раз в ~0.5с, а не каждый кадр: и число дороже читать при 60 обновлениях/
    // сек, и не нужно платить текстовую аллокацию (см. тот же принцип у info panel выше).
    this._fpsAccum = (this._fpsAccum ?? 0) + (delta ?? 16.7);
    if (this._fpsTxt.visible && this._fpsAccum >= 500) {
      this._fpsAccum = 0;
      this._setText(this._fpsTxt, `FPS: ${Math.round(this.game.loop.actualFps)}`);
    }
    // Раз в ~2с — heap колеблется на 1-2МБ почти каждый кадр (обычный GC-шум), при
    // обновлении каждый кадр цифра "мельтешила" визуально без какой-либо пользы.
    this._ramAccum = (this._ramAccum ?? 0) + (delta ?? 16.7);
    if (this._ramTxt.visible && this._ramAccum >= 2000) {
      this._ramAccum = 0;
      this._setText(this._ramTxt, `RAM: ${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB`);
    }

    const W = this.scale.width, H = this.scale.height;
    const g = this.bars;
    const p = this.gs.player;
    if (!p) return;

    const atBase = this.gs.atBase;

    if (!atBase) {
      // ── Игрок ── (горизонтальные бары с иконкой и значением)
      const sFrac = p.shield / p.maxShield, hFrac = p.hull / p.maxHull;
      this._icoShield.setVisible(true);
      this._setText(this._valShield, `${Math.ceil(p.shield)} / ${p.maxShield}`).setVisible(true);
      this._icoHull.setVisible(true);
      this._setText(this._valHull, `${Math.ceil(p.hull)} / ${p.maxHull}`).setVisible(true);
      const hullColor = hFrac > 0.5 ? COLORS.emerald : (hFrac > 0.25 ? COLORS.amber : COLORS.danger);
      const boostTag = p.boosting ? `  ⚡${i18n.t('hud.boost')}` : '';
      this._setText(this.pSpeed, `${i18n.t('hud.speed')}  ${Math.round(p.speed)}${boostTag}`)
        .setColor(p.boosting ? '#ffb74d' : '#9fb3b8').setVisible(true);

      // ── Цель ── (щит — cyan-полоска над корпусом, если у цели есть щит)
      const t = this.gs.target;
      let targetBottom = 16;
      // Числа для решения "перерисовывать ли Graphics-бары" ниже — округлённая ШИРИНА
      // ЗАЛИВКИ (то, что реально видно), а не сырая доля, чтобы не пропустить визуально
      // значимое изменение и не перерисовывать на суб-пиксельный шум регена. Именно
      // числа, не строка-сигнатура — конкатенация была бы новой аллокацией каждый
      // кадр просто для сравнения (см. Mob.js:drawBar за тем же фиксом и почему это
      // важно: см. Memory-график в профилировке, "пила" JS heap от частых GC-пауз).
      // targetKind: 0=нет цели, 1=есть щит, 2=только корпус.
      let targetKind = 0, tsW = 0, thW = 0;
      if (t && t.alive) {
        // Мобы несут .tpl (имя/уровень); база/турель/другой игрок — нет, у них
        // общая PvP-цепочка (_onPvpMobHitResult и т.п.) не требует .tpl вовсе, так
        // что t.tpl.nameKey тут раньше падал при выборе базы/турели/RemotePlayer.
        let label;
        if (t.isMiningBase) label = i18n.t('hud.mining_base');
        else if (t.isTurretTarget) label = i18n.t(t.type === 'cannon2' ? 'hud.turret_cannon2' : 'hud.turret_cannon1');
        else if (t.isRemotePlayer) label = t.name;
        else if (t.tpl) {
          const enrageTag = (t.isBoss && t.phase >= 2) ? `  ⚠${i18n.t('hud.enraged')}` : '';
          label = `${i18n.t(t.tpl.nameKey)}  ${i18n.t('mob.level')}${t.level}${enrageTag}`;
        } else {
          label = t.name || '';
        }
        this.tName.setX(W / 2);
        this._setText(this.tName, label).setVisible(true);
        if (t.maxShield > 0) {
          tsW = Math.ceil(220 * Phaser.Math.Clamp(t.shield / t.maxShield, 0, 1));
          thW = Math.ceil(220 * Phaser.Math.Clamp(t.hull / t.maxHull, 0, 1));
          targetKind = 1;
          this.tHullTxt.setY(64);
          this._setText(this.tHullTxt, `${i18n.t('hud.shield')} ${Math.ceil(t.shield)}  ·  ${i18n.t('hud.hull')} ${Math.ceil(t.hull)}/${t.maxHull}`);
        } else {
          thW = Math.ceil(220 * Phaser.Math.Clamp(t.hull / t.maxHull, 0, 1));
          targetKind = 2;
          this.tHullTxt.setY(58);
          this._setText(this.tHullTxt, `${i18n.t('hud.hull')} ${Math.ceil(t.hull)} / ${t.maxHull}`);
        }
        this.tHullTxt.setX(W / 2).setVisible(true);
        targetBottom = 86;
      } else {
        this.tName.setVisible(false); this.tHullTxt.setVisible(false);
      }

      // ── Безопасная зона ──
      this.safeTxt.setX(W / 2).setY(targetBottom).setVisible(!!this.gs.safeProtected);

      // Graphics.clear()+перерисовка пересобирает геометрию и заливает её в GPU —
      // дорогая операция (см. профилировку: GraphicsWebGLRenderer). Полосы щита/
      // корпуса игрока и цели визуально не меняются большую часть времени (полное
      // здоровье, статичная/отсутствующая цель), так что трогаем Graphics только
      // когда реальная ширина заливки или цвет действительно изменились.
      const sW = Math.ceil(160 * Phaser.Math.Clamp(sFrac, 0, 1));
      const hW = Math.ceil(160 * Phaser.Math.Clamp(hFrac, 0, 1));
      const changed = sW !== this._lastPSW || hW !== this._lastPHW || hullColor !== this._lastHullColor
        || targetKind !== this._lastTargetKind || tsW !== this._lastTSW || thW !== this._lastTHW;
      if (changed) {
        this._lastPSW = sW; this._lastPHW = hW; this._lastHullColor = hullColor;
        this._lastTargetKind = targetKind; this._lastTSW = tsW; this._lastTHW = thW;
        g.clear();
        this.bar(g, 38, 20, 160, 16, sFrac, COLORS.primary);
        this.bar(g, 38, 44, 160, 16, hFrac, hullColor);
        if (t && t.alive) {
          const bx = W / 2 - 110;
          if (t.maxShield > 0) {
            this.bar(g, bx, 40, 220, 6, t.shield / t.maxShield, COLORS.primary);
            this.bar(g, bx, 50, 220, 8, t.hull / t.maxHull, COLORS.danger);
          } else {
            this.bar(g, bx, 44, 220, 8, t.hull / t.maxHull, COLORS.danger);
          }
        }
      }
    } else {
      // At base: hide all combat/flight stats
      [this._icoShield, this._valShield, this._icoHull, this._valHull, this.pSpeed,
       this.tName, this.tHullTxt, this.safeTxt].forEach(o => o.setVisible(false));
      if (this._lastTargetKind !== -1) { this._lastTargetKind = -1; g.clear(); }
    }

    // ── Info panel: always update (stays current at base + in space) ──
    // Раньше строился набор ФРЕШ-строк (шаблонные литералы + toLocaleString() —
    // не самый дешёвый built-in) КАЖДЫЙ кадр безусловно, даже когда кредиты/честь/
    // реп/опыт не менялись между кадрами вообще (99% времени) — на любой карте,
    // независимо от боя/движения. _setText уже сравнивает готовую строку перед
    // setText(), но сама СБОРКА строки — это аллокация, которую он не предотвращал.
    // Сравниваем исходные значения ДО форматирования, чтобы не собирать строку зря.
    const credits = this.gs.credits || 0, starGold = this.gs.starGold || 0,
          honor = this.gs.pilotHonor || 0, corpRepPct = Math.round((this.gs.corpRep || 0) * 100),
          xp = this.gs.pilotXp || 0, rankName = this.gs.pilotRank?.name || '';
    if (credits !== this._lastIpCredits || starGold !== this._lastIpStarGold
        || honor !== this._lastIpHonor || corpRepPct !== this._lastIpCorpRepPct
        || xp !== this._lastIpXp || rankName !== this._lastIpRankName) {
      this._lastIpCredits = credits; this._lastIpStarGold = starGold; this._lastIpHonor = honor;
      this._lastIpCorpRepPct = corpRepPct; this._lastIpXp = xp; this._lastIpRankName = rankName;
      this._setText(this.pCredits, `💰 ${credits.toLocaleString()}`);
      this._setText(this.pStarGold, `⭐ ${starGold}`);
      this._setText(this.pHonor, `⚔️ ${honor.toLocaleString()}`);
      this._setText(this.pCorpRep, `🛡 ${corpRepPct}%`);
      const info = levelInfo(xp);
      this._setText(this.pPilot, `${i18n.t('hud.pilot')}  ${i18n.t('mob.level')}${info.level}`);
      this._setText(this.pRank, rankName ? rankName.toUpperCase() : '');
      this._ipXpFrac = info.level >= MAX_LEVEL ? 1 : info.frac;
      this._setText(this.pXpTxt, info.level >= MAX_LEVEL ? 'MAX' : `${Math.floor(info.into)} / ${info.need}`);
    }
    this._updateInfoPanelContent();

    // ── Миникарта (векторные блипы) ──
    // Graphics.clear()+полная перерисовка (стены/базы/мобы/лут/гейты — десятки draw
    // call'ов) — дорогая операция (см. комментарий у bar() выше: GraphicsWebGLRenderer),
    // а тут её раньше гоняли безусловно КАЖДЫЙ кадр на любой карте, даже когда на миникарте
    // физически нечему было измениться за 16мс. Точки на миникарте не нужно двигать с
    // точностью до кадра — 15Hz визуально неотличимо от 60Hz на объекте такого размера.
    this._minimapAccum = (this._minimapAccum || 0) + (delta ?? 16.7);
    if (this._minimapAccum >= 66) {
      this._minimapAccum = 0;
      this.drawMinimap();
    }

    // ── Подписи под миникартой: название сектора + координаты ──
    {
      const _r = minimapRect(this, getMinimapDims(loadSettings().minimapSize));
      const _cx = _r.x + _r.w / 2;
      const _labelY = _r.y + _r.h + 4;
      if (!atBase && p.alive) {
        const gs = this.gs;
        const _cx2 = Math.round(p.x);
        const _cy2 = Math.round(gs.worldHeight - p.y);
        this._mmSectorTxt.setPosition(_cx, _labelY).setVisible(true);
        this._setText(this._mmSectorTxt, SECTORS[galaxy.current]?.name ?? '');
        this._mmCoordTxt.setPosition(_cx, _labelY + 14).setVisible(true);
        this._setText(this._mmCoordTxt, `${_cx2}  ·  ${_cy2}`);

        const ev = gs._mmEventNotice;
        const evLeftMs = ev ? ev.startAt - Date.now() : -1;
        if (ev && evLeftMs > 0) {
          const secLeft = Math.ceil(evLeftMs / 1000);
          const mm = String(Math.floor(secLeft / 60)).padStart(2, '0');
          const ss = String(secLeft % 60).padStart(2, '0');
          this._mmEventTxt.setPosition(_cx, _labelY + 28).setVisible(true);
          this._setText(this._mmEventTxt, `⚠ ${ev.label} через ${mm}:${ss}`);
        } else {
          this._mmEventTxt.setVisible(false);
        }
      } else {
        this._mmSectorTxt.setVisible(false);
        this._mmCoordTxt.setVisible(false);
        this._mmEventTxt.setVisible(false);
      }
    }

    // ── Активна підсвітка nav-кнопок ──
    if (this._navBtnItems) {
      for (const item of this._navBtnItems) {
        const active = this.scene.isActive(item.key);
        if (active === item._lastActive) continue; // меняется редко — не трогаем Shape/tint зря
        item._lastActive = active;
        item.btn.setFillStyle(active ? 0x0f3040 : 0x081420);
        item.btn.setStrokeStyle(1, active ? 0x4dd0e1 : 0x1e3a50, 1);
        item.txt.setTint(active ? 0x7ee8f0 : 0x3a8aaa);
      }
    }

    // ── Base nav bar + auto-collapse panels on base enter/exit ──
    if (this.gs.atBase !== this._lastAtBase) {
      this._lastAtBase = this.gs.atBase;
      if (this.gs.atBase) {
        this._savedIpCollapsed  = this._ipCollapsed;
        this._savedLogCollapsed = this._logCollapsed;
        if (!this._ipCollapsed)  { this._ipCollapsed  = true; this._refreshInfoPanel(); }
        if (!this._logCollapsed) { this._logCollapsed = true; this._refreshLogPanel();  }
        this._showBaseNav();
      } else {
        if (this._savedIpCollapsed  === false) { this._ipCollapsed  = false; this._refreshInfoPanel(); }
        if (this._savedLogCollapsed === false) { this._logCollapsed = false; this._refreshLogPanel();  }
        this._hideBaseNav();
      }
    }

    // ── Cargo indicator ──
    const cargoCount = this.gs.inventory?.length || 0;
    const cargoMax   = this.gs._cargoMax();
    this._cargoTxt.setPosition(W - 16, H - 80)
      .setColor(cargoCount >= cargoMax ? '#ef5350' : '#4a6678')
      .setVisible(!atBase);
    this._setText(this._cargoTxt, `ТРЮМ  ${cargoCount}/${cargoMax}`);

    const inMap = this.scene.isActive('MapScene');

    // ── Подсказка (выше action bar) ──
    this.hint.setPosition(W / 2, H - 66).setVisible(!atBase && !inMap);

    // ── Action bar ──
    if (!atBase && !inMap) {
      this._updateActionBarHUD(this.time.now);
    }
    if (this._abSlots) {
      this._abSlots.forEach(slot => {
        slot.bg.setVisible(!atBase && !inMap);
        slot.cdGfx.setVisible(!atBase && !inMap);
        slot.hk.setVisible(!atBase && !inMap);
        slot.cdTxt.setVisible(!atBase && !inMap);
        if (slot.iconImg) slot.iconImg.setVisible(!atBase && !inMap);
      });
    }
    this._editBtn?.setVisible(!atBase && !inMap);
    this._editBtnTxt?.setVisible(!atBase && !inMap);

    // ── Лог (внутри панели, снизу вверх) ──
    // logBottom = нижняя граница контентной области (Y куда упирается низ самого нового элемента).
    const LOG_PH = Math.max(24 + 7 * 18 + 10, 24 + this._logContentH() + 10);
    const logBottom = this._logY + LOG_PH - 8;
    const logVisible = !this._logCollapsed;
    this._logBtn?.setVisible(true);
    this._logBtnTxt?.setVisible(true);
    let yOff = 0;
    for (let i = this.logEntries.length - 1; i >= 0; i--) {
      const e = this.logEntries[i];
      const h = Math.max(16, Math.ceil(e.t.height));
      yOff += h + 2;
      // setY ставит верхний край текста; низ = Y + h = logBottom - yOff + 2 + h = logBottom - (gap)
      e.t.setX(this._logX + 10).setY(logBottom - yOff + 2).setVisible(logVisible).setAlpha(1);
    }

    // ── Sector tracking for friends online status ──
    const _curSec = galaxy.current;
    if (_curSec !== this._lastSectorSent && this.groupSystem) {
      this._lastSectorSent = _curSec;
      this.groupSystem.sectorUpdate(_curSec);
    }

    this._updateBoosterWidget();
  }

  // Phaser регенерирует текстуру текста при КАЖДОМ setText(), даже если строка не
  // изменилась — вызов на каждый кадр ради статичных величин (кредиты, ранг, уровень
  // пилота меняются раз в несколько секунд, не 60 раз в секунду) впустую грузил
  // рендер (см. профилировку: updateText/syncFont съедали ~13% времени кадра).
  // Кэш висит прямо на самом game-object'е — по одному текстовому полю на кадр,
  // а не на общей карте, так что новые поля просто получают undefined→строка один раз.
  _setText(obj, str) {
    if (obj && obj._lastSetText !== str) { obj._lastSetText = str; obj.setText(str); }
    return obj;
  }

  bar(g, x, y, w, h, frac, color) {
    frac = Phaser.Math.Clamp(frac, 0, 1);
    g.fillStyle(0x050c12, 0.9); g.fillRoundedRect(x - 2, y - 2, w + 4, h + 4, 4);
    g.fillStyle(0x0e1e26, 1); g.fillRect(x, y, w, h);
    if (frac > 0) {
      g.fillStyle(color, 1); g.fillRect(x, y, Math.ceil(w * frac), h);
      g.fillStyle(0xffffff, 0.13); g.fillRect(x, y, Math.ceil(w * frac), Math.ceil(h * 0.38));
    }
  }

  // Миникарта векторными блипами: панель + база/safe-зона + лут + мобы + игрок + waypoint.
  // Всё геометрией (не камера) → резко при любом DPR. Позиции мира → миникарты через worldToMinimap.
  // fit() once per frame (not per blip) — worldToMinimap() used to be called once per
  // entity (mobs/loot/plasmate can be dozens on the expanded home map), each call both
  // recomputing the same fit division AND allocating a fresh {x,y} object; inlining
  // "f.ox + x*f.s" below avoids both, cutting a real source of per-frame GC pressure
  // (see profilировка — intermittent stutter matched periodic Minor GC, not a steady
  // per-frame drain).
  drawMinimap() {
    const g = this.miniGfx; g.clear();
    if (this.gs.atBase) return;
    const gs = this.gs;
    const r = minimapRect(this, getMinimapDims(loadSettings().minimapSize));
    const ww = gs.worldWidth, wh = gs.worldHeight;
    const f = fit(r, ww, wh);

    // Панель + рамка с техно-углами
    g.fillStyle(0x03090f, 0.9); g.fillRect(r.x, r.y, r.w, r.h);
    g.lineStyle(1, COLORS.primary, 0.25); g.strokeRect(r.x, r.y, r.w, r.h);
    const cr = 7;
    g.lineStyle(2, COLORS.primary, 0.9);
    g.strokeLineShape(new Phaser.Geom.Line(r.x, r.y + cr, r.x, r.y));
    g.strokeLineShape(new Phaser.Geom.Line(r.x, r.y, r.x + cr, r.y));
    g.strokeLineShape(new Phaser.Geom.Line(r.x + r.w - cr, r.y, r.x + r.w, r.y));
    g.strokeLineShape(new Phaser.Geom.Line(r.x + r.w, r.y, r.x + r.w, r.y + cr));
    g.strokeLineShape(new Phaser.Geom.Line(r.x + r.w, r.y + r.h - cr, r.x + r.w, r.y + r.h));
    g.strokeLineShape(new Phaser.Geom.Line(r.x + r.w, r.y + r.h, r.x + r.w - cr, r.y + r.h));
    g.strokeLineShape(new Phaser.Geom.Line(r.x + cr, r.y + r.h, r.x, r.y + r.h));
    g.strokeLineShape(new Phaser.Geom.Line(r.x, r.y + r.h, r.x, r.y + r.h - cr));

    // База + кольцо безопасной зоны (центр мира)
    const sec = SECTORS[galaxy.current];
    if (!sec.isDungeon && !sec.pvp && !sec.personal) {
      const bx = f.ox + (ww / 2) * f.s, by = f.oy + (wh / 2) * f.s;
      g.lineStyle(1, COLORS.safezone, 0.5);
      g.strokeCircle(bx, by, gs.safeZoneRadius * f.s);
      g.fillStyle(COLORS.primary, 0.9); g.fillCircle(bx, by, 3);
    }

    // Стены данжа на миникарте — всегда видны, цвет по типу
    if (sec.isDungeon && gs.walls) {
      const DUNGEON_WALL_COLOR = {
        dungeon_1: 0x8b3a1a, dungeon_2: 0x3a6a3a, dungeon_3: 0x505080,
        dungeon_4: 0x3a5a3a, dungeon_5: 0x4dd0e1, dungeon_prem: 0x00c853, 'R-1-boss': 0xc8a800,
      };
      const wc = DUNGEON_WALL_COLOR[galaxy.current] ?? 0x4dd0e1;
      g.fillStyle(wc, 0.35);
      g.lineStyle(0.5, wc, 0.7);
      for (const wall of gs.walls.getChildren()) {
        const wx = f.ox + wall.x * f.s, wy = f.oy + wall.y * f.s;
        const sw = Math.max(1, wall.width * f.s);
        const sh = Math.max(1, wall.height * f.s);
        g.fillRect(wx - sw / 2, wy - sh / 2, sw, sh);
        g.strokeRect(wx - sw / 2, wy - sh / 2, sw, sh);
      }
    }

    // Домашні бази — завжди видні (без обмеження scan radius)
    if (gs.homeBases) {
      const CORP_HUE = { helios: 0xffb74d, karax: 0xef5350, tides: 0x4dd0e1 };
      for (const hb of gs.homeBases) {
        const hx = f.ox + hb.x * f.s, hy = f.oy + hb.y * f.s;
        const isOwn = hb.corp === gs.playerCorp;
        const c = isOwn ? 0xffffff : (CORP_HUE[hb.corp] || 0x888888);
        g.lineStyle(2, c, isOwn ? 0.95 : 0.65);
        g.strokeCircle(hx, hy, 5);
        g.fillStyle(c, isOwn ? 1.0 : 0.75);
        g.fillCircle(hx, hy, 2.5);
      }
    }

    // Добувальні бази (тільки PvP, завжди видні)
    if (sec.pvp && gs.miningBases) {
      for (const mb of gs.miningBases) {
        const mx = f.ox + mb.x * f.s, my = f.oy + mb.y * f.s;
        const isOwn = mb.corp === gs.playerCorp;
        const isNeutral = !mb.corp || mb.corp === 'neutral';
        const c = isOwn ? 0x66ff88 : isNeutral ? 0x778899 : 0xff5555;
        const a = mb.state === 'destroyed' ? 0.3 : 0.85;
        const sz = 3;
        g.lineStyle(1.5, c, a);
        g.strokeRect(mx - sz, my - sz, sz * 2, sz * 2);
        g.fillStyle(c, a * 0.5);
        g.fillRect(mx - sz + 1, my - sz + 1, sz * 2 - 2, sz * 2 - 2);
      }
    }

    // Бронепоезд (только PvP, всегда видим — как база/эскорт, не зависит от скан-радиуса,
    // это заявленная угроза всему сектору, не спрятанный объект). startPos/endPos лежат
    // ДАЛЕКО за границей сектора (EDGE_BUFFER, см. ArmoredTrain.js) — рисовать пунктир до
    // них рисовало бы поезд/маршрут далеко за рамкой миникарты. Вместо этого: пунктир
    // только между mapEnterPos/mapExitPos (реальные точки пересечения маршрута с границей
    // сектора, всегда внутри миникарты по построению) + стрелка на точке входа, куда
    // поезд едет — направление, откуда он появится, даже пока сам ещё не доехал.
    if (sec.pvp && gs.armoredTrain) {
      const tr = gs.armoredTrain;
      const ax = f.ox + tr.mapEnterPos.x * f.s, ay = f.oy + tr.mapEnterPos.y * f.s;
      const bx = f.ox + tr.mapExitPos.x * f.s, by = f.oy + tr.mapExitPos.y * f.s;
      g.lineStyle(1, 0xffb74d, 0.35);
      const steps = 24;
      for (let i = 0; i < steps; i += 2) {
        const t0 = i / steps, t1 = (i + 1) / steps;
        g.lineBetween(
          Phaser.Math.Linear(ax, bx, t0), Phaser.Math.Linear(ay, by, t0),
          Phaser.Math.Linear(ax, bx, t1), Phaser.Math.Linear(ay, by, t1),
        );
      }
      // Стрелка на точке входа — направление движения (dirX/dirY), не зависит от того,
      // доехал ли уже поезд до этой точки.
      const dirX = f.s * tr._dirX, dirY = f.s * tr._dirY; // масштаб не важен, только направление
      const dlen = Math.hypot(dirX, dirY) || 1;
      const ndx = dirX / dlen, ndy = dirY / dlen;
      const ARROW = 7;
      const tipX = ax + ndx * ARROW, tipY = ay + ndy * ARROW;
      const perpX = -ndy * ARROW * 0.55, perpY = ndx * ARROW * 0.55;
      g.fillStyle(0xffee44, 0.9);
      g.fillPoints([
        { x: tipX, y: tipY },
        { x: ax - ndx * ARROW * 0.4 + perpX, y: ay - ndy * ARROW * 0.4 + perpY },
        { x: ax - ndx * ARROW * 0.4 - perpX, y: ay - ndy * ARROW * 0.4 - perpY },
      ], true);
      // Вагоны — ромбиком, ТОЛЬКО пока реально в границах сектора (не за EDGE_BUFFER) —
      // за пределами карты их и не должно быть видно, маршрут+стрелка выше уже сообщают
      // "оттуда, в эту сторону".
      for (const w of tr.wagons) {
        if (!w.alive) continue;
        if (w.x < 0 || w.x > ww || w.y < 0 || w.y > wh) continue;
        const wx = f.ox + w.x * f.s, wy = f.oy + w.y * f.s;
        const c = w.isHead ? 0xffee44 : 0xffb74d;
        const sz = w.isHead ? 4 : 3;
        g.fillStyle(c, 0.9);
        g.fillPoints([{ x: wx, y: wy - sz }, { x: wx + sz, y: wy }, { x: wx, y: wy + sz }, { x: wx - sz, y: wy }], true);
      }
    }

    // Скан-радиус: враги/лут видны только в радиусе сканирования
    const sr = gs.scanRadius ?? BASE_SCAN_RADIUS;
    const px2 = gs.player?.x ?? ww / 2, py2 = gs.player?.y ?? wh / 2;
    const fullScan = gs._scannerActive === true;
    // Кольцо радиуса сканирования (не рисуем, когда полный скан — видно всё)
    const pcx = f.ox + px2 * f.s, pcy = f.oy + py2 * f.s;
    if (!fullScan) {
      g.lineStyle(1, 0x4de1aa, 0.3);
      g.strokeCircle(pcx, pcy, sr * f.s);
    } else {
      // Лёгкое фиолетовое кольцо — индикатор активного сканера
      g.lineStyle(1.5, 0xab47bc, 0.55);
      g.strokeCircle(pcx, pcy, r.w * 0.46);
    }

    // Плазмит и данж-ресурсы — точки, только в радиусе сканирования
    if (gs.plasmateDeposits) {
      for (const d of gs.plasmateDeposits) {
        if (!d.alive) continue;
        if (!fullScan && Phaser.Math.Distance.Between(px2, py2, d.x, d.y) > sr) continue;
        const dpx = f.ox + d.x * f.s, dpy = f.oy + d.y * f.s;
        if (d.isDungeonResource) {
          const DTINT = { biomech_fragment: 0xb39ddb, quantum_shard: 0x80ffff, plasma_strand: 0xff8c00 };
          g.fillStyle(DTINT[d.resourceType] || 0xffffff, 0.9);
          g.fillCircle(dpx, dpy, 2.2);
        } else {
          g.fillStyle(0xaa66ff, 0.85);
          g.fillCircle(dpx, dpy, 1.8);
        }
      }
    }

    // Аномалия — всегда видна на миникарте (не гейтится сканом), мигающая метка
    if (gs.anomaly?.alive) {
      const apx = f.ox + gs.anomaly.x * f.s, apy = f.oy + gs.anomaly.y * f.s;
      const pulse = 0.5 + 0.5 * Math.abs(Math.sin(this.time.now / 260));
      g.fillStyle(0x9c6bff, 0.5 + 0.4 * pulse); g.fillCircle(apx, apy, 2.5);
      g.lineStyle(1.5, 0x9c6bff, 0.4 + 0.4 * pulse); g.strokeCircle(apx, apy, 5 + 2 * pulse);
    }

    // Лут — только в радиусе скана (или везде при fullScan); jackpot — cyan с кольцом
    for (const l of gs.loot) {
      if (!l.alive) continue;
      if (!fullScan && Phaser.Math.Distance.Between(px2, py2, l.x, l.y) > sr) continue;
      const lx = f.ox + l.x * f.s, ly = f.oy + l.y * f.s;
      if (l.tier === 'jackpot') {
        g.fillStyle(0x00e5ff, 1); g.fillCircle(lx, ly, 2.5);
        g.lineStyle(1, 0x00e5ff, 0.7); g.strokeCircle(lx, ly, 4.5);
      } else {
        g.fillStyle(COLORS.amber, 0.9); g.fillCircle(lx, ly, 1.6);
      }
    }

    // Мобы (красные; боссы крупнее/оранжевые) — только в радиусе скана
    for (const m of gs.mobs) {
      if (!m.alive) continue;
      if (!fullScan && Phaser.Math.Distance.Between(px2, py2, m.x, m.y) > sr) continue;
      const mpx = f.ox + m.x * f.s, mpy = f.oy + m.y * f.s;
      if (m.isBoss) { g.fillStyle(0xff7a6b, 1); g.fillCircle(mpx, mpy, 3.4); }
      else { g.fillStyle(COLORS.danger, 0.95); g.fillCircle(mpx, mpy, 2); }
    }

    // Бот (арена теней) — отдельная красная точка
    if (gs.botPilot?.alive) {
      const bpx = f.ox + gs.botPilot.x * f.s, bpy = f.oy + gs.botPilot.y * f.s;
      g.fillStyle(0xff4444, 1); g.fillCircle(bpx, bpy, 3);
    }

    // Джапгейты (порталы) — cyan-кольца, чтобы видеть, куда лететь для прыжка
    const missionTargets = getActiveMissionSectorTargets(gs.missionState, gs.playerCorp ?? 'helios');
    if (gs.gates) {
      for (const ga of gs.gates) {
        const gx = f.ox + ga.x * f.s, gy = f.oy + ga.y * f.s;
        const isMissionGate = missionTargets.has(ga.target);
        if (isMissionGate) {
          // Amber outer ring for mission target gate
          g.lineStyle(2, COLORS.amber, 0.7); g.strokeCircle(gx, gy, 8);
        }
        g.lineStyle(2, COLORS.primary, 0.95); g.strokeCircle(gx, gy, 4.5);
        g.fillStyle(0x9fe6ff, 0.9); g.fillCircle(gx, gy, 1.8);
        if (isMissionGate) {
          // Amber star above gate marker
          g.fillStyle(COLORS.amber, 0.95);
          const sx = gx, sy = gy - 12, starR = 4;
          for (let i = 0; i < 5; i++) {
            const aOuter = (i * 4 * Math.PI / 5) - Math.PI / 2;
            const aInner = aOuter + 2 * Math.PI / 10;
            const ox = sx + Math.cos(aOuter) * starR, oy = sy + Math.sin(aOuter) * starR;
            const ix = sx + Math.cos(aInner) * starR * 0.45, iy = sy + Math.sin(aInner) * starR * 0.45;
            if (i === 0) g.beginPath(), g.moveTo(ox, oy);
            else g.lineTo(ox, oy);
            g.lineTo(ix, iy);
          }
          g.closePath(); g.fillPath();
        }
      }
    }

    // Escort transport — amber diamond (visually distinct from cyan gate circles)
    const et = gs.escortTransport;
    if (et?.alive) {
      const epx = f.ox + et.x * f.s, epy = f.oy + et.y * f.s;
      const ds = 5.5;
      g.fillStyle(0xffb74d, 0.92);
      g.beginPath();
      g.moveTo(epx,      epy - ds);
      g.lineTo(epx + ds, epy);
      g.lineTo(epx,      epy + ds);
      g.lineTo(epx - ds, epy);
      g.closePath(); g.fillPath();
      g.lineStyle(1.5, 0xffe082, 0.85);
      g.beginPath();
      g.moveTo(epx,      epy - ds);
      g.lineTo(epx + ds, epy);
      g.lineTo(epx,      epy + ds);
      g.lineTo(epx - ds, epy);
      g.closePath(); g.strokePath();
    }

    // Waypoint (если задан курс)
    const pl = gs.player;
    if (pl && pl.waypoint) {
      const wpx = f.ox + pl.waypoint.x * f.s, wpy = f.oy + pl.waypoint.y * f.s;
      g.lineStyle(1, COLORS.amber, 0.9); g.strokeCircle(wpx, wpy, 3);
    }

    // Игрок — треугольник по курсу (heading)
    if (pl && pl.alive) {
      const px3 = f.ox + pl.x * f.s, py3 = f.oy + pl.y * f.s;
      const h = pl.heading, sz = 5.5;
      g.fillStyle(0xffffff, 1);
      g.beginPath();
      g.moveTo(px3 + Math.cos(h) * sz, py3 + Math.sin(h) * sz);
      g.lineTo(px3 + Math.cos(h + 2.6) * sz * 0.75, py3 + Math.sin(h + 2.6) * sz * 0.75);
      g.lineTo(px3 + Math.cos(h - 2.6) * sz * 0.75, py3 + Math.sin(h - 2.6) * sz * 0.75);
      g.closePath(); g.fillPath();
    }

    // Тёмная плашка под миникартой — фон для подписей сектора/координат
    if (!this.gs.atBase && this.gs.player?.alive) {
      g.fillStyle(0x03090f, 0.82);
      g.fillRect(r.x, r.y + r.h + 1, r.w, 31);
      g.lineStyle(1, COLORS.primary, 0.12);
      g.strokeRect(r.x, r.y + r.h + 1, r.w, 31);
    }
  }

  _buildLogPanel() {
    const F = (s, c) => ({ fontFamily: 'Inter, sans-serif', fontSize: s, color: c, resolution: UI_RES });
    const SH = this.scale.height;

    const SW = this.scale.width;
    let lpx = 10, lpy = SH - 185;
    try {
      const s = JSON.parse(localStorage.getItem('sd_hud_log_pos') || 'null');
      if (s) { lpx = s.x; lpy = s.y; }
    } catch {}
    this._logX = Math.max(0, Math.min(SW - 310, lpx));
    this._logY = Math.max(0, Math.min(SH - 185, lpy));
    this._logCollapsed = false;

    this._logBg = this.add.graphics().setDepth(100);

    const BW = 52, BH = 24;
    this._logBtn = this.add.rectangle(0, 0, BW, BH, 0x000000, 0)
      .setOrigin(0).setStrokeStyle(1, 0x4dd0e1, 0.45).setInteractive({ useHandCursor: true }).setDepth(102);
    this._logBtnTxt = this.add.text(BW / 2, BH / 2, 'L ◀', F('11px', '#4dd0e1')).setOrigin(0.5).setDepth(103);

    let dragging = false, dox = 0, doy = 0, moved = false;
    this._logBtn.on('pointerdown', ptr => {
      dragging = true; moved = false;
      dox = ptr.x - this._logX; doy = ptr.y - this._logY;
    });
    this.input.on('pointermove', ptr => {
      if (!dragging) return;
      const nx = Math.max(0, Math.min(this.scale.width - 310, ptr.x - dox));
      const ny = Math.max(0, Math.min(this.scale.height - 185, ptr.y - doy));
      if (Math.abs(nx - this._logX) > 3 || Math.abs(ny - this._logY) > 3) moved = true;
      this._logX = nx; this._logY = ny;
      this._refreshLogPanel();
    });
    this.input.on('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      if (!moved) {
        this._logCollapsed = !this._logCollapsed;
        this._refreshLogPanel();
      }
      try { localStorage.setItem('sd_hud_log_pos', JSON.stringify({ x: this._logX, y: this._logY })); } catch {}
    });

    this._refreshLogPanel();
  }

  _refreshLogPanel() {
    const x = this._logX, y = this._logY;
    const BW = 52, BH = 24, PW = 300;
    const PH = Math.max(BH + 7 * 18 + 10, BH + this._logContentH() + 10);

    this._logBtn.setPosition(x, y);
    this._logBtnTxt.setPosition(x + BW / 2, y + BH / 2).setText(this._logCollapsed ? 'L ▶' : 'L ◀');

    this._logBg.clear();
    if (!this._logCollapsed) {
      if (loadSettings().logBg !== false) {
        this._logBg.fillStyle(0x03080f, 0.88);
        this._logBg.fillRoundedRect(x, y, PW, PH, 8);
      }
      this._logBg.lineStyle(1.5, 0x4dd0e1, 0.65);
      this._logBg.strokeRoundedRect(x, y, PW, PH, 8);
    }
  }

  _buildInfoPanel() {
    const F = (s, c) => ({ fontFamily: 'Inter, sans-serif', fontSize: s, color: c, resolution: UI_RES });
    const O = (s, c) => ({ fontFamily: 'Orbitron, sans-serif', fontSize: s, color: c, resolution: UI_RES });

    const SW = this.scale.width, SH = this.scale.height;
    let ipx = 10, ipy = 90;
    try {
      const s = JSON.parse(localStorage.getItem('sd_hud_info_pos') || 'null');
      if (s) { ipx = s.x; ipy = s.y; }
    } catch {}
    this._ipx = Math.max(0, Math.min(SW - 160, ipx));
    this._ipy = Math.max(0, Math.min(SH - 200, ipy));
    this._ipCollapsed = false;
    this._ipXpFrac = 0;

    // Panel background (persistent graphics, cleared when collapsed)
    this._ipBg = this.add.graphics().setDepth(100);

    // XP bar graphics (redrawn every frame)
    this._ipXpGfx = this.add.graphics().setDepth(100);
    // Тот же сброс кэша, что и у _lastIpCredits выше — _updateInfoPanelContent
    // пропускает перерисовку Graphics, если barX/barY/fillW не изменились с
    // прошлого раза, а после restart() эта Graphics пустая (см. этот же баг).
    this._lastIpCollapsed = this._lastIpBarX = this._lastIpBarY = this._lastIpFillW = undefined;

    // Toggle/drag button (always visible)
    const BW = 52, BH = 24;
    this._ipBtn = this.add.rectangle(0, 0, BW, BH, 0x000000, 0)
      .setOrigin(0).setStrokeStyle(1, 0x4dd0e1, 0.45).setInteractive({ useHandCursor: true }).setDepth(102);
    this._ipBtnTxt = this.add.text(BW / 2, BH / 2, 'i ◀', F('11px', '#4dd0e1')).setOrigin(0.5).setDepth(103);

    let dragging = false, dox = 0, doy = 0, moved = false;
    this._ipBtn.on('pointerdown', ptr => {
      dragging = true; moved = false;
      dox = ptr.x - this._ipx; doy = ptr.y - this._ipy;
    });
    this.input.on('pointermove', ptr => {
      if (!dragging) return;
      const nx = Math.max(0, Math.min(this.scale.width - 160, ptr.x - dox));
      const ny = Math.max(0, Math.min(this.scale.height - 200, ptr.y - doy));
      if (Math.abs(nx - this._ipx) > 3 || Math.abs(ny - this._ipy) > 3) moved = true;
      this._ipx = nx; this._ipy = ny;
      this._refreshInfoPanel();
    });
    this.input.on('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      if (!moved) {
        this._ipCollapsed = !this._ipCollapsed;
        this._refreshInfoPanel();
      }
      try { localStorage.setItem('sd_hud_info_pos', JSON.stringify({ x: this._ipx, y: this._ipy })); } catch {}
    });

    this._refreshInfoPanel();
  }

  _refreshInfoPanel() {
    const x = this._ipx, y = this._ipy;
    const TB = 22, PW = 148, LH = 21;
    const ITEMS = [this.pCredits, this.pStarGold, this.pHonor, this.pCorpRep, this.pPilot, this.pRank, this.pXpTxt];

    const BW = 52, BH = 24;
    this._ipBtn.setPosition(x, y);
    this._ipBtnTxt.setPosition(x + BW / 2, y + BH / 2).setText(this._ipCollapsed ? 'i ▶' : 'i ◀');

    if (this._ipCollapsed) {
      this._ipBg.clear();
      this._ipXpGfx.clear();
      ITEMS.forEach(o => o.setVisible(false));
      return;
    }

    // 6 text lines + XP bar (6px) + XP fraction text (14px) + padding
    const pH = BH + 6 * LH + 38;
    this._ipBg.clear();
    if (loadSettings().infoBg !== false) {
      this._ipBg.fillStyle(0x03080f, 0.88);
      this._ipBg.fillRoundedRect(x, y, PW, pH, 8);
    }
    this._ipBg.lineStyle(1.5, 0x4dd0e1, 0.65);
    this._ipBg.strokeRoundedRect(x, y, PW, pH, 8);

    const tx = x + 10, ty0 = y + BH + 4;
    this.pCredits.setPosition(tx, ty0).setVisible(true);
    this.pStarGold.setPosition(tx, ty0 + LH).setVisible(true);
    this.pHonor.setPosition(tx, ty0 + LH * 2).setVisible(true);
    this.pCorpRep.setPosition(tx, ty0 + LH * 3).setVisible(true);
    this.pPilot.setPosition(tx, ty0 + LH * 4).setVisible(true);
    this.pRank.setPosition(tx + 2, ty0 + LH * 5).setVisible(true);
    // XP fraction text: centered under XP bar (positioned in _updateInfoPanelContent)
    this.pXpTxt.setOrigin(0.5, 0).setPosition(x + PW / 2, ty0 + LH * 6 + 10).setVisible(true);
  }

  _updateInfoPanelContent() {
    const xg = this._ipXpGfx;
    if (!xg) return;
    if (this._ipCollapsed) {
      // XP меняется только по убийствам/миссиям, не каждый кадр — не трогаем Graphics
      // (clear+redraw) пока картинка реально не изменилась. Числа, не строка — см.
      // тот же фикс в Mob.js:drawBar (аллокация строки на сравнение = мусор каждый
      // кадр даже когда ничего не рисуем).
      if (!this._lastIpCollapsed) { this._lastIpCollapsed = true; xg.clear(); }
      return;
    }
    this._lastIpCollapsed = false;
    const BH = 24, LH = 21, PW = 148;
    const barX = this._ipx + 10;
    const barY = this._ipy + BH + 4 + 6 * LH + 2;  // below rank line
    const barW = PW - 20;
    const fillW = Math.round(barW * (this._ipXpFrac || 0));
    if (barX === this._lastIpBarX && barY === this._lastIpBarY && fillW === this._lastIpFillW) return;
    this._lastIpBarX = barX; this._lastIpBarY = barY; this._lastIpFillW = fillW;
    xg.clear();
    xg.fillStyle(0x1a1030, 0.6); xg.fillRect(barX, barY, barW, 6);
    xg.fillStyle(0x7c4dff, 0.9); xg.fillRect(barX, barY, fillW, 6);
  }

  // ══════════════════════════════════════════════════════════
  // ЧАТ — перетаскиваемое/масштабируемое окно, 3 вкладки, ЛС
  // ══════════════════════════════════════════════════════════

  _buildChatPanel() {
    const W = this.scale.width, H = this.scale.height;
    this._chatMessages = { general: [], corp: [], clan: [] };
    this._chatTab = 'general';
    this._chatPmTarget = null;
    this._chatVisible = true;
    // Отдельно от _chatVisible/_chatCollapsed (те переключают "полное окно" ⇄ "маленькая
    // свёрнутая таблетка", см. _rebuildChatPanel) — кнопка ЧАТ на общей панели убирает
    // чат ПОЛНОСТЬЮ, даже без таблетки (правка по просьбе: "при нажатии на иконку чата
    // на панели - убирать полностью чат, даже маленькое свёрнутое окошко").
    this._chatHidden = false;
    this._chatDragging  = false;
    this._chatResizing  = false;
    this._chatCollapsed = false;
    this._chatDragMoved = false;
    this._chatRzOx = 0; this._chatRzOy = 0;

    const BAR_TOP = H - 62; // action bar: H - 52 - 10
    let cx = W - 380, cy = BAR_TOP - 234, cw = 360, ch = 230;
    try {
      const s = JSON.parse(localStorage.getItem('sd_chat_state') || 'null');
      if (s) { cx = s.x; cy = s.y; cw = s.w; ch = s.h; }
      // Сброс если позиция из старого дефолта (верхняя зона < 100px)
      if (s && s.y < 100) { cx = W - 380; cy = BAR_TOP - 234; }
    } catch {}
    // Ширина/высота ДО клэмпа X/Y — крестик закрытия сидит у ПРАВОГО края окна
    // (chatX + chatW - 6), клэмп по фиксированным "260" (а не реальной ширине, которая
    // может доходить до 600) оставлял его за пределами экрана после ресайза в меньшее
    // окно (баг из диалога: "после ресайза страницы не могу попасть по крестику").
    this._chatW = Math.max(260, Math.min(600, cw));
    this._chatH = Math.max(150, Math.min(480, ch));
    this._chatX = Math.max(0, Math.min(W - this._chatW, cx));
    this._chatY = Math.max(0, Math.min(BAR_TOP - 50, cy));

    // Контейнер — всё содержимое в нём, при drag просто двигаем контейнер
    this._chatC = this.add.container(this._chatX, this._chatY).setDepth(205);

    // HTML input — поверх канваса
    const inp = document.createElement('input');
    inp.type = 'text'; inp.maxLength = 200;
    inp.placeholder = 'Написать сообщение…';
    Object.assign(inp.style, {
      position: 'fixed', background: '#050d15', border: '1px solid #1e3a50',
      color: '#cfe9ee', fontFamily: 'Inter, sans-serif',
      padding: '0 6px', outline: 'none', zIndex: '1000',
      boxSizing: 'border-box', display: 'none',
      pointerEvents: 'none', // не перехватывает клики — активируется только через focus()
    });
    inp.addEventListener('focus', () => { inp.style.pointerEvents = 'auto'; });
    inp.addEventListener('blur',  () => { inp.style.pointerEvents = 'none'; });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const v = inp.value.trim(); if (v) this._sendChatMessage(v); inp.value = '';
        inp.blur();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        this._chatPmTarget = null;
        inp.placeholder = 'Написать сообщение…';
        inp.blur(); this._rebuildChatPanel();
      }
      e.stopPropagation(); e.stopImmediatePropagation();
    });
    document.body.appendChild(inp);
    this._chatInputEl = inp;

    // Глобальные drag/resize — один раз
    this.input.on('pointermove', ptr => {
      if (this._chatDragging) {
        const W2 = this.scale.width, H2 = this.scale.height;
        const maxX = this._chatCollapsed ? W2 - 72        : W2 - this._chatW;
        const maxY = this._chatCollapsed ? H2 - 22        : H2 - this._chatH;
        const nx = Math.max(0, Math.min(maxX, ptr.x - this._chatDragOx));
        const ny = Math.max(0, Math.min(maxY, ptr.y - this._chatDragOy));
        if (Math.abs(nx - this._chatX) > 3 || Math.abs(ny - this._chatY) > 3) this._chatDragMoved = true;
        this._chatX = nx; this._chatY = ny;
        this._chatC.setPosition(nx, ny);
        if (!this._chatCollapsed) this._posChatInput();
      }
      if (this._chatResizing) {
        const dx = ptr.x - this._chatRzOx, dy = ptr.y - this._chatRzOy;
        this._chatRzOx = ptr.x; this._chatRzOy = ptr.y;
        this._chatW = Math.max(260, Math.min(600, this._chatW + dx));
        this._chatH = Math.max(150, Math.min(480, this._chatH + dy));
        this._rebuildChatPanel();
      }
    });
    this.input.on('pointerup', () => {
      if (this._chatDragging) {
        if (this._chatCollapsed && !this._chatDragMoved) {
          this._chatVisible = true;
          this._rebuildChatPanel();
          this._updateSocialBtnStyles();
        }
        this._chatDragging = false;
        this._chatCollapsed = false;
        this._saveChatState();
      }
      if (this._chatResizing) {
        this._chatResizing = false;
        this._saveChatState();
      }
    });

    // Стартовые mock-сообщения
    this.pushChatMessage('general', 'AceShooter', 'Всем привет!');
    this.pushChatMessage('general', 'StarWolf', 'Кто идёт в D3?');
    this.pushChatMessage('corp', 'DarkWanderer', 'Защищаем базу на PvP-3');
    this.pushChatMessage('clan', 'AceShooter', 'Собираемся на R1 в 20:00');
    this._rebuildChatPanel();

    this.game.events.on('chat-message', ({ channel, from, text, opts = {} }) => {
      this.pushChatMessage(channel, from, text, opts);
    }, this);
    this.events.once('shutdown', () => {
      this._chatWsDestroyed = true;
      this._chatWS?.close();
      if (this._chatReconnectTimer) { clearTimeout(this._chatReconnectTimer); this._chatReconnectTimer = null; }
      this._hideConnectionLostModal();
      this.game.events.off('chat-message', null, this);
      this._chatInputEl?.parentNode?.removeChild(this._chatInputEl);
    });

    this._connectChatWS();
  }

  _rebuildChatPanel() {
    this._chatC.removeAll(true);
    this._chatC.setPosition(this._chatX, this._chatY);

    // Полностью убрано кнопкой ЧАТ на общей панели (см. _toggleChatWin) — ни окна, ни
    // свёрнутой таблетки, в отличие от "просто свёрнуто" ниже.
    if (this._chatHidden) {
      this._chatInputEl.style.display = 'none';
      return;
    }

    const HDR = 22, TAB = 24, INP = 26;
    const w = this._chatW, h = this._chatH;
    const F = (sz, c) => ({ fontFamily: 'Inter, sans-serif', fontSize: sz, color: c, resolution: UI_RES });
    const O = (sz, c) => ({ fontFamily: 'Orbitron, sans-serif', fontSize: sz, color: c, resolution: UI_RES });
    const mk = o => { this._chatC.add(o); return o; };

    // Свёрнуто — только кнопка-тоггл (перетаскивается, клик открывает)
    if (!this._chatVisible) {
      this._chatInputEl.style.display = 'none';
      const tbg = mk(this.add.rectangle(0, 0, 72, 22, 0x050e18, 0.95).setOrigin(0)
        .setStrokeStyle(1, 0x1a4060, 0.8).setInteractive({ useHandCursor: true }));
      mk(this.add.text(36, 11, '💬 ЧАТ', F('10px', '#4dd0e1')).setOrigin(0.5));
      tbg.on('pointerdown', ptr => {
        this._chatDragging  = true;
        this._chatCollapsed = true;
        this._chatDragMoved = false;
        this._chatDragOx = ptr.x - this._chatX;
        this._chatDragOy = ptr.y - this._chatY;
      });
      return;
    }

    // Фон
    const bg = this.add.graphics();
    if (loadSettings().chatBg !== false) {
      bg.fillStyle(0x03080f, 0.93); bg.fillRoundedRect(0, 0, w, h, 6);
    }
    bg.lineStyle(1.5, 0x1a4060, 0.85); bg.strokeRoundedRect(0, 0, w, h, 6);
    mk(bg);
    const hg = this.add.graphics();
    hg.fillStyle(0x081422, 1); hg.fillRoundedRect(0, 0, w, HDR, { tl: 6, tr: 6, bl: 0, br: 0 });
    mk(hg);
    mk(this.add.text(w / 2, HDR / 2, 'ЧАТ', O('11px', '#4dd0e1')).setOrigin(0.5));
    const xBtn = mk(this.add.text(w - 6, HDR / 2, '✕', F('11px', '#335566')).setOrigin(1, 0.5).setInteractive({ useHandCursor: true }));
    xBtn.on('pointerover', () => xBtn.setColor('#ef5350'));
    xBtn.on('pointerout',  () => xBtn.setColor('#335566'));
    xBtn.on('pointerdown', () => { this._chatVisible = false; this._rebuildChatPanel(); this._updateSocialBtnStyles(); });

    // Drag-зона (заголовок)
    mk(this.add.rectangle(0, 0, w - 20, HDR, 0, 0).setOrigin(0).setInteractive({ useHandCursor: true }))
      .on('pointerdown', ptr => {
        this._chatDragging = true;
        this._chatDragOx = ptr.x - this._chatX;
        this._chatDragOy = ptr.y - this._chatY;
      });

    // Вкладки
    const CTABS = [{ key: 'general', label: 'ОБЩИЙ' }, { key: 'corp', label: 'КОРП' }, { key: 'clan', label: 'ГИЛЬДИЯ' }];
    const tabW = Math.floor(w / 3);
    CTABS.forEach((tab, i) => {
      const active = tab.key === this._chatTab;
      const tx = i * tabW, tW = i < 2 ? tabW : w - 2 * tabW;
      mk(this.add.rectangle(tx, HDR, tW, TAB, active ? 0x0a1e2e : 0x040b14).setOrigin(0)
        .setStrokeStyle(0.5, active ? 0x2a5060 : 0x0e1e2a, 0.6).setInteractive({ useHandCursor: true }))
        .on('pointerdown', () => { this._chatTab = tab.key; this._rebuildChatPanel(); });
      mk(this.add.text(tx + tW / 2, HDR + TAB / 2, tab.label, F('11px', active ? '#4dd0e1' : '#2a5060')).setOrigin(0.5));
      if (active) {
        const ag = this.add.graphics();
        ag.lineStyle(2, 0x4dd0e1, 0.9);
        ag.strokeLineShape(new Phaser.Geom.Line(tx + 2, HDR + TAB - 1, tx + tW - 2, HDR + TAB - 1));
        mk(ag);
      }
    });

    // Сообщения
    const msgY0 = HDR + TAB + 3;
    const msgAreaH = h - HDR - TAB - INP - 5;
    const fSz = Math.max(10, Math.min(13, Math.round(msgAreaH / 14)));
    const lineH = Math.round(fSz * 1.45);
    const msgs = (this._chatMessages[this._chatTab] || []).slice(-Math.floor(msgAreaH / lineH));
    msgs.forEach((msg, i) => {
      const my = msgY0 + i * lineH;
      if (msg.isPm) mk(this.add.rectangle(1, my - 1, w - 2, lineH, 0x1a0e00, 0.65).setOrigin(0));
      const tmT = mk(this.add.text(6, my, `[${msg.time}] `, F(`${fSz - 1}px`, '#1a4a5a')).setOrigin(0, 0));
      const nc = msg.isPm ? '#ffd54f' : (msg.from === (this.gs?.playerName || '') ? '#80cbc4' : '#66aacc');
      const nT = mk(this.add.text(6 + tmT.width, my, `${msg.from}:`, F(`${fSz}px`, nc)).setOrigin(0, 0).setInteractive({ useHandCursor: true }));
      nT.on('pointerdown', ptr => {
        if (msg.from === (this.gs?.playerName || '')) return;
        const ctrl = ptr.event?.ctrlKey || false;
        if (ctrl) {
          this._chatPmTarget = msg.from;
          this._chatInputEl.placeholder = `→ ${msg.from}: `;
          this._chatInputEl.focus(); this._rebuildChatPanel();
        } else {
          // Обычный клик по нику → заполняем поле приглашения в окне группы
          this._setGroupInviteTarget(msg.from);
        }
      });
      nT.on('pointerover', () => nT.setAlpha(0.7));
      nT.on('pointerout',  () => nT.setAlpha(1));
      const txX = 6 + tmT.width + nT.width + 3;
      const disp = msg.pmTo ? `→${msg.pmTo}: ${msg.text}` : msg.text;
      mk(this.add.text(txX, my, disp, { ...F(`${fSz}px`, msg.isPm ? '#ffe082' : '#aacce0'), wordWrap: { width: Math.max(30, w - txX - 8) } }).setOrigin(0, 0));
    });

    // Разделитель + PM-индикатор
    const sg = this.add.graphics();
    sg.lineStyle(1, 0x1a3a50, 0.5); sg.strokeLineShape(new Phaser.Geom.Line(1, h - INP - 1, w - 1, h - INP - 1));
    mk(sg);
    if (this._chatPmTarget) mk(this.add.text(4, h - INP + 4, `→ ${this._chatPmTarget}`, F('10px', '#ffd54f')).setOrigin(0, 0));

    // Ручка ресайза — правый край нижней строки (не перекрытой HTML-инпутом)
    const RZ = 20;

    // Кликабельная зона инпута — фокусирует HTML-поле (само поле pointer-events:none)
    mk(this.add.rectangle(1, h - INP, w - RZ - 1, INP - 1, 0, 0).setOrigin(0).setInteractive({ useHandCursor: true }))
      .on('pointerdown', () => this._chatInputEl?.focus());
    const rg = this.add.graphics();
    rg.fillStyle(0x081422, 1); rg.fillRect(w - RZ, h - INP, RZ, INP);
    rg.lineStyle(1.5, 0x2a5070, 0.7);
    [1, 2, 3].forEach(k => rg.strokeLineShape(new Phaser.Geom.Line(w - 2 - k * 4, h - 2, w - 2, h - 2 - k * 4)));
    mk(rg);
    mk(this.add.rectangle(w - RZ, h - INP, RZ, INP, 0, 0).setOrigin(0).setInteractive({ useHandCursor: true }))
      .on('pointerdown', ptr => { this._chatResizing = true; this._chatRzOx = ptr.x; this._chatRzOy = ptr.y; });

    this._posChatInput(fSz);
  }

  // Позиционирует HTML-инпут поверх канваса
  _posChatInput(fSz = 12) {
    const inp = this._chatInputEl;
    if (!inp) return;
    if (!this._chatVisible) { inp.style.display = 'none'; return; }
    const r = this.game.canvas.getBoundingClientRect();
    const sx = r.width / this.scale.width, sy = r.height / this.scale.height;
    const INP = 26;
    Object.assign(inp.style, {
      display:  'block',
      left:     `${Math.round(r.left + (this._chatX + 1) * sx)}px`,
      top:      `${Math.round(r.top  + (this._chatY + this._chatH - INP + 1) * sy)}px`,
      width:    `${Math.round((this._chatW - 22) * sx)}px`,
      height:   `${Math.round((INP - 2) * sy)}px`,
      fontSize: `${Math.round(fSz * sy)}px`,
    });
  }

  pushChatMessage(channel, from, text, opts = {}) {
    const d = new Date();
    const fallbackTime = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    const time = opts._time || fallbackTime;
    const isPm = !!(opts.pmTo || opts.pmFrom);
    const msg = { from, text, time, isPm, pmTo: opts.pmTo };
    const push = ch => { const a = this._chatMessages[ch]; a.push(msg); if (a.length > 80) a.shift(); };
    if (isPm) ['general', 'corp', 'clan'].forEach(push);
    else push(['general', 'corp', 'clan'].includes(channel) ? channel : 'general');
    if (this._chatVisible) this._rebuildChatPanel();
  }

  _sendChatMessage(text) {
    // Group commands — handled locally, not sent to chat
    if (this.groupSystem) {
      if (text.startsWith('/принять ')) {
        const leader = text.slice(9).trim();
        if (leader) { this.groupSystem.join(leader); this._groupLog(`Запрос вступления к ${leader}…`); }
        return;
      }
      if (text.startsWith('/пригласить ')) {
        const name = text.slice(12).trim();
        if (name) {
          if (!this.groupSystem.inGroup) { this.groupSystem.create(galaxy.current, false); this._groupLog('Группа создана'); }
          this.groupSystem.invite(name, galaxy.current);
          this._groupPendingInvites?.set(name, 'pending');
          this._groupLog(`Приглашение → ${name}`);
          this._rebuildGroupWin();
        }
        return;
      }
      if (text === '/группа') {
        this.groupSystem.create(galaxy.current, false);
        this._groupLog('Группа создана');
        return;
      }
      if (text === '/выйти') {
        this.groupSystem.leave();
        this._groupPendingInvites?.clear();
        this._groupLog('Вы вышли из группы');
        this._rebuildGroupWin();
        this._updateSocialBtnStyles();
        return;
      }
      if (text.startsWith('/добавить ')) {
        const name = text.slice(9).trim();
        if (name) { this.groupSystem.friendAdd(name); this.pushChatMessage('general', 'System', `[Друзья] Запрос отправлен: ${name}`, {}); }
        return;
      }
      if (text.startsWith('/чс ')) {
        const name = text.slice(4).trim();
        if (name) this._addToBlacklist(name);
        return;
      }
    }
    if (this._chatWS?.readyState === WebSocket.OPEN) {
      if (this._chatPmTarget) {
        this._chatWS.send(JSON.stringify({ type: 'pm', to: this._chatPmTarget, text }));
      } else {
        this._chatWS.send(JSON.stringify({ type: 'msg', channel: this._chatTab, text }));
      }
      // Server will echo/broadcast — don't push locally to avoid duplicates
    } else {
      // Fallback: local only (no server)
      const from = this.gs?.playerName || 'Пилот';
      if (this._chatPmTarget) {
        this.pushChatMessage(this._chatTab, from, text, { pmTo: this._chatPmTarget });
      } else {
        this.pushChatMessage(this._chatTab, from, text);
      }
    }
    this._chatPmTarget = null;
    this._chatInputEl.placeholder = 'Написать сообщение…';
  }

  _connectChatWS() {
    const token = sessionStorage.getItem('sd_token');
    if (!token) return;
    this._chatWsDestroyed = false;
    let ws;
    try {
      // location.hostname — тот же принцип, что в api.js API_BASE (см. комментарий там)
      ws = new WebSocket(`ws://${location.hostname}:8000/ws/chat?token=${encodeURIComponent(token)}`);
    } catch { return; }
    this._chatWS = ws;

    // GroupSystem, PvpClient и MailClient используют этот же WS (см. header-комментарии модулей)
    this.groupSystem = new GroupSystem(this.scene.get('GameScene'), ws);
    this.pvpClient   = new PvpClient(this.scene.get('GameScene'), ws);
    this.mailClient  = new MailClient(this.scene.get('GameScene'), ws);
    this.mailClient.onUnreadSummary = (_byUser, total) => {
      this._mailUnread = total;
      this._updateSocialBtnStyles();
    };
    this.mailClient.onNewMail = (msg) => {
      this.pushChatMessage('general', 'System', `[Почта] Новое сообщение от ${msg.from} — B открыть почту`, {});
      if (this.scene.isActive('MailScene')) this.scene.get('MailScene').onLiveMessage?.(msg);
    };
    this.mailClient.onError = (text) => {
      if (this.scene.isActive('MailScene')) this.scene.get('MailScene').onMailError?.(text);
      else this.pushChatMessage('general', 'System', `[Почта] ${text}`, {});
    };
    this.pvpClient.onHitResult = (msg) => {
      this.scene.get('GameScene')?._onPvpHitResult(msg);
    };
    this.pvpClient.onMobHitResult = (msg) => {
      this.scene.get('GameScene')?._onPvpMobHitResult(msg);
    };
    this.pvpClient.onLootSpawned = (msg) => {
      this.scene.get('GameScene')?._onPvpLootSpawned(msg);
    };
    this.pvpClient.onLootResult = (msg) => {
      this.scene.get('GameScene')?._onPvpLootResult(msg);
    };
    this.pvpClient.onLootRemoved = (lootId) => {
      this.scene.get('GameScene')?._onPvpLootRemoved(lootId);
    };
    this.pvpClient.onResourceResult = (msg) => {
      this.scene.get('GameScene')?._onPvpResourceResult(msg);
    };
    this.pvpClient.onResourceCollected = (resourceId) => {
      this.scene.get('GameScene')?._onPvpResourceCollected(resourceId);
    };
    this.pvpClient.onResourceRespawned = (msg) => {
      this.scene.get('GameScene')?._onPvpResourceRespawned(msg);
    };
    this.pvpClient.onEscortStarted = () => {
      const gs = this.scene.get('GameScene');
      if (gs) gs._escortRoomLockUntil = Date.now() + 30000;
    };
    this.pvpClient.onBountyPosted = (msg) => {
      const gs = this.scene.get('GameScene');
      if (gs) { gs.wantedPlayers = gs.wantedPlayers || new Map(); gs.wantedPlayers.set(msg.userId, msg.name); }
    };
    this.pvpClient.onBountyCleared = (msg) => {
      this.scene.get('GameScene')?.wantedPlayers?.delete(msg.userId);
    };
    this.pvpClient.onBountySnapshot = (msg) => {
      const gs = this.scene.get('GameScene');
      if (!gs) return;
      const list = msg.bounties ?? [];
      gs.wantedPlayers = new Map(list.map(b => [b.userId, b.name]));
      // Полный список с online/sector — только для доски розыска в CorpScene
      // (нейм-плейты используют только gs.wantedPlayers выше).
      gs.bountyBoard = list;
      const corpScene = this.scene.get('CorpScene');
      if (corpScene?.scene.isActive() && corpScene._tab === 2) corpScene._refreshBountyTab(gs);
    };
    // Доля пропорциональной награды за уничтоженный вагон бронепоезда (топ-5 по
    // урону, см. ArmoredTrainManager/_split_reward_top5 в server/main.py) — сервер
    // шлёт это ТОЛЬКО получателю, не бродкастом, поэтому просто применяем как есть.
    this.pvpClient.onWagonReward = (msg) => {
      const gs = this.scene.get('GameScene');
      if (!gs) return;
      const { credits = 0, xp = 0, gold = 0, biomech_fragment = 0, quantum_shard = 0, plasma_strand = 0 } = msg;
      if (credits > 0) gs.credits = (gs.credits || 0) + credits;
      if (xp > 0) gs.gainXp(xp);
      if (gold > 0) gs.starGold = (gs.starGold || 0) + gold;
      const cargoMax = gs._cargoMax?.() ?? 999;
      if (biomech_fragment > 0) addConsumableToInventory(gs.inventory, 'biomech_fragment', biomech_fragment, cargoMax);
      if (quantum_shard > 0) addConsumableToInventory(gs.inventory, 'quantum_shard', quantum_shard, cargoMax);
      if (plasma_strand > 0) addConsumableToInventory(gs.inventory, 'plasma_strand', plasma_strand, cargoMax);
      gs.log?.(i18n.t('log.wagon_reward', { credits, xp }));
      // Раньше эта ветка не сохраняла состояние (в отличие от каждого другого reward-пути
      // в этом файле — лут-пикап/карго) — держалось только на 60с автосейве
      // (GameScene._saveState тик). Реконнект/краш/закрытие вкладки в этом окне тихо
      // терял награду, хотя она на миг мелькала в HUD (см. диалог "не вижу наград").
      gs._saveState?.();
    };
    // Игрок зашёл в PvP-сектор ПОСЛЕ начала события бронепоезда (или переподключился
    // посреди него) — без этого его клиент показал бы поезд с полным HP вместо
    // реального состояния (см. ArmoredTrain.applySnapshot / pvp_train_query в main.py).
    this.pvpClient.onTrainSnapshot = (msg) => {
      this.scene.get('GameScene')?.armoredTrain?.applySnapshot(msg);
    };
    // DEV-хоткей T (GameScene): другой игрок в секторе принудительно запустил бронепоезд
    // с произвольным startAt (не детерминированным wall-clock расписанием) — раньше это
    // видел только тот, кто нажал T, т.к. остальные клиенты сами до такого startAt не
    // додумаются. Сервер (main.py pvp_train_force_spawn) ретранслирует startAt — строим
    // тот же ArmoredTrain локально, детерминированный маршрут совпадёт у всех.
    // Сервер-авторитетный таргетинг дронов бронепоезда (План, Фаза 2) — раз в тик
    // сообщает, какого игрока в комнате КАЖДЫЙ дрон сейчас атакует (круговое
    // распределение по игрокам, см. server _tick_room), чинит "оба видят, что рой
    // бьёт именно меня", даже когда рядом двое.
    this.pvpClient.onMobRoomUpdate = (msg) => {
      this.scene.get('GameScene')?._onPvpMobRoomUpdate(msg);
    };
    // Моб/турель бьёт ДРУГОГО игрока комнаты — чисто визуальный relay (см. main.py
    // pvp_mob_attack_vfx), сам урон/HP тут не при делах, только чтобы наблюдатели видели
    // выстрел, а не тишину (баг из диалога: "турель 1 бьёт игрока 1, игрок 2 не видит").
    this.pvpClient.onMobAttackVfx = (msg) => {
      this.scene.get('GameScene')?._onPvpMobAttackVfx(msg);
    };
    // Реальные цифры урона от моба/турели по другому игроку (отдельно от VFX выше —
    // приходит в момент попадания, не выстрела) — обновляет HP-полоску RemotePlayer и
    // показывает цифру урона наблюдателям (баг из диалога: "не видно урона", "прочность
    // и щит другого игрока не уменьшается").
    this.pvpClient.onMobAttackResult = (msg) => {
      this.scene.get('GameScene')?._onPvpMobAttackResult(msg);
    };
    // Бронепоезд: ракетный залп/поворотная турель — server-authoritative (сервер сам
    // решил, посчитал и уже применил урон, см. server _train_weapon_tick_loop). Клиент
    // только синкает HP (если цель — я) и рисует визуал залпа для всех наблюдателей.
    this.pvpClient.onTrainWeaponFire = (msg) => {
      this.scene.get('GameScene')?._onTrainWeaponFire(msg);
    };
    // Моя доля пропорциональной награды за расчистку волны нашествия (см.
    // GameScene._updateWorldEvent/worldEventClearClaim) — сервер сам решил сплит по
    // накопленному вкладу, раньше каждый клиент выдавал себе полную награду локально.
    this.pvpClient.onWorldEventReward = (msg) => {
      this.scene.get('GameScene')?._onWorldEventReward(msg);
    };
    this.pvpClient.onTrainForceSpawn = (msg) => {
      const gs = this.scene.get('GameScene');
      if (!gs || !gs.scene.isActive()) return;
      const sec = SECTORS[galaxy.current];
      if (!sec?.pvp || !ARMORED_TRAIN_SECTORS[galaxy.current]) return;
      gs.armoredTrain?.destroy();
      gs.armoredTrain = new ArmoredTrain(gs, galaxy.current, msg.startAt);
      this.pvpClient.trainQuery(gs.armoredTrain.trainKey);
      gs.log?.(`🚂 ${sec.name}: бронепоезд на маршруте (запущен другим игроком)!`);
    };
    this.groupSystem.onGoldReward = (gold, credits, xp) => {
      const gs = this.scene.get('GameScene');
      if (!gs) return;
      if (gold > 0) gs.starGold = (gs.starGold || 0) + gold;
      if (credits > 0) gs.credits = (gs.credits || 0) + credits;
      if (xp > 0) gs.gainXp(xp);
      if (credits > 0 || xp > 0) gs.log?.(i18n.t('log.reward', { credits, xp }));
    };
    this.groupSystem.onError = (text) => {
      this.pushChatMessage('general', 'System', text, {});
    };
    this.groupSystem.onInvite = ({ from, dungeon }) => {
      this._incomingInvite = { from, dungeon };
      this._groupLog(`${from} зовёт в группу`);
      // Auto-show (и разворачиваем, если было свёрнуто) окно группы, чтобы приглашение
      // сразу увиделось, а не потерялось в свёрнутом заголовке.
      this._groupWinVisible = true;
      this._grpWinCollapsed = false;
      this._rebuildGroupWin();
      this._updateSocialBtnStyles();
    };
    this.groupSystem.onUpdate = (members) => {
      const gs = this.scene.get('GameScene');
      if (gs) gs.groupSize = members.length;
      // Mark accepted invites when the invited player appears in members
      for (const [name, status] of (this._groupPendingInvites || new Map())) {
        if (status === 'pending' && members.includes(name)) {
          this._groupPendingInvites.set(name, 'accepted');
          this._groupLog(`${name} принял приглашение`);
        }
      }
      this._rebuildGroupWin();
      this._updateSocialBtnStyles();
    };
    this.groupSystem.onBossHp = (ratio) => {
      this._groupBossHpRatio = ratio;
      this._rebuildGroupWin();
      // Обновляем HP призрака-босса у не-лидеров
      if (!this.groupSystem.isLeader) {
        const gs = this.scene.get('GameScene');
        const ghost = gs?.mobs?.find(m => m.ghostBoss);
        if (ghost) ghost.hull = Math.max(1, ratio * ghost.maxHull);
      }
    };
    // Лидер получает урон от участников → применяет к своему боссу
    this.groupSystem.onMemberDamage = (amount) => {
      const gs = this.scene.get('GameScene');
      if (!gs || !this.groupSystem.isLeader) return;
      const boss = gs._apophisBoss || gs.mobs?.find(m => m.isDungeonBoss && m.alive);
      if (!boss) return;
      const res = boss.takeDamage(amount, 0.5, {});
      gs.hitFlash(boss.x, boss.y, (res.hullHit || 0) > 0);
      gs.showDamage(boss.x, boss.y, res);
      if (res.killed) gs.onMobKilled(boss);
    };
    // Не-лидер: сервер сообщил что ГЛАВНЫЙ босс убит → чистим призрака
    this.groupSystem.onBossKilled = () => {
      const gs = this.scene.get('GameScene');
      if (!gs) return;
      const ghost = gs.mobs?.find(m => m.ghostBoss && m.isDungeonBoss);
      if (!ghost) return;
      gs.explosion(ghost.x, ghost.y, 1.6);
      ghost.hull = 0; ghost.alive = false;
      ghost.sprite?.destroy();
      gs.mobs = gs.mobs.filter(m => m !== ghost);
      gs.log('Босс побеждён группой!');
    };
    // Не-лидер: охранник/минибосс убит лидером → даём участнику награды и чистим призрака
    this.groupSystem.onMobDied = (id) => {
      const gs = this.scene.get('GameScene');
      if (!gs) return;
      const ghost = gs.mobs?.find(m => m.ghostBoss && m._groupMobId === id);
      if (!ghost) return;
      ghost.ghostBoss = false; // снимаем флаг — onMobKilled отработает нормально
      gs.onMobKilled(ghost);   // участник получает свои XP / кредиты / лут
    };

    // ── Friends callbacks ──────────────────────────────────────────────
    this.groupSystem.onFriendList = (friends) => {
      this._friendsList = friends;
      this._rebuildFriendsWin();
      this._updateSocialBtnStyles();
    };
    this.groupSystem.onFriendUpdate = ({ name, online, sector }) => {
      const f = this._friendsList.find(f => f.name === name);
      if (f) { f.online = online; if (sector !== undefined) f.sector = sector; }
      this._rebuildFriendsWin();
    };
    this.groupSystem.onFriendRequest = ({ from }) => {
      if (!this._friendsList.find(f => f.name === from)) {
        this._friendsList.push({ name: from, status: 'pending', dir: 'in', online: true, sector: '' });
      }
      this._rebuildFriendsWin();
      this._updateSocialBtnStyles();
      this.pushChatMessage('general', 'System', `[Друзья] ${from} хочет добавить вас в друзья — откройте окно Друзья.`, {});
    };

    ws.onopen = () => {
      this._hideConnectionLostModal();
      this.groupSystem?.sectorUpdate(galaxy.current);
      // Самолечащаяся регистрация в realtime-комнате: GameScene.create() уже пытается
      // вызвать pvpClient.enterSector() при входе в сектор, но если в этот момент WS
      // ещё переподключается (реконнект после разрыва/рестарта сервера), pvpClient
      // временно null — enterSector тихо не срабатывает, и повторной попытки без
      // этого не будет до следующей смены сектора. Раз уж сокет только что открылся —
      // сразу проверяем текущую комнату тем же методом, что и GameScene.create().
      const gs = this.scene.get('GameScene');
      const roomKey = gs?.player?.alive ? gs._currentRealtimeRoomKey?.() : null;
      if (roomKey) {
        this.pvpClient?.enterSector(roomKey, gs.player.x, gs.player.y, gs._pvpLoadoutSnapshot(), gs._pendingResourceProposal ?? []);
      }
      // Та же самолечащаяся логика — бронепоезд мог быть построен локально ДО того,
      // как pvpClient/WS были готовы (см. GameScene._initArmoredTrain), без этого
      // запрос состояния (pvp_train_query) терялся бы навсегда для этой сессии.
      if (gs?.armoredTrain) this.pvpClient?.trainQuery(gs.armoredTrain.trainKey);
    };

    ws.onmessage = evt => {
      let d;
      try { d = JSON.parse(evt.data); } catch { return; }

      if (d.type === 'session_info') {
        const gs = this.scene.get('GameScene');
        if (gs) gs.myUserId = d.userId;
        return;
      }

      // Группо- и friend-сообщения роутим в GroupSystem
      if (d.type?.startsWith('group_') || d.type?.startsWith('friend_')) {
        this.groupSystem?.handleMessage(d);
        return;
      }
      // PvP-сообщения (присутствие/позиции/бой) роутим в PvpClient
      if (d.type?.startsWith('pvp_')) {
        this.pvpClient?.handleMessage(d);
        return;
      }

      if (d.type === 'history') {
        const arr = this._chatMessages[d.channel];
        if (arr) {
          arr.length = 0;
          (d.messages || []).forEach(m => arr.push({ from: m.from, text: m.text, time: m.time, isPm: false }));
          if (this._chatVisible) this._rebuildChatPanel();
        }
      } else if (d.type === 'msg') {
        this.pushChatMessage(d.channel, d.from, d.text, { _time: d.time });
      } else if (d.type === 'pm') {
        const myName = this.gs?.playerName || '';
        if (d.from === myName) {
          this.pushChatMessage('general', d.from, d.text, { pmTo: d.to, _time: d.time });
        } else {
          this.pushChatMessage('general', d.from, d.text, { pmFrom: d.from, _time: d.time });
        }
        this.mailClient?.handleMessage(d);
      } else if (d.type === 'pm_unread_summary') {
        this.mailClient?.handleMessage(d);
      } else if (d.type === 'pm_error') {
        this.mailClient?.handleMessage(d);
      }
    };

    ws.onclose = (evt) => {
      // Защита от гонки: если этот сокет уже был заменён более новым (см. _connectChatWS
      // вызванный повторно, напр. из-за resize-рестарта HudScene выше) — его onclose может
      // сработать ПОЗЖЕ, чем this._chatWS уже указывает на новый, живой сокет. Без этой
      // проверки устаревший onclose затирал бы ссылку на новый сокет null'ом и показывал
      // модалку "соединение потеряно" поверх реально работающего соединения.
      if (this._chatWS !== ws) return;
      this._chatWS = null;
      this.groupSystem = null;
      this.pvpClient?.leaveSector(); // destroy any RemotePlayer sprites before dropping the reference
      this.pvpClient = null;
      this.mailClient = null;
      this._friendsList = [];
      this._rebuildFriendsWin();
      this._rebuildGroupWin();
      this._updateSocialBtnStyles();
      if (this._chatWsDestroyed) return; // осознанное закрытие (logout/shutdown сцены) — без модалки и без реконнекта
      // 4003 — сервер на пределе бета-лимита одновременных игроков (см. server/main.py
      // ChatManager.is_full/MAX_CONCURRENT_USERS). Реконнект всё равно продолжаем —
      // слот освобождается, как только кто-то выйдет.
      const subtitle = evt?.code === 4003
        ? 'Сервер сейчас заполнен (бета, лимит игроков)'
        : 'Связь с сервером прервана';
      this._showConnectionLostModal(subtitle);
      this._chatReconnectTimer = setTimeout(() => this._connectChatWS(), 5000);
    };
    ws.onerror = () => {};
  }

  // ── Модалка "соединение потеряно" — любая причина закрытия WS (обрыв сети,
  // рестарт/падение сервера, бета-лимит игроков и т.п.) заканчивается тут:
  // фоновый реконнект и так уже был (см. ws.onclose), но раньше это было
  // незаметно игроку — теперь явное сообщение + кнопка немедленного повтора.
  _showConnectionLostModal(subtitle) {
    const wasShowing = !!this._connLostObjs;
    if (this._connLostObjs) { this._connLostObjs.forEach(o => o?.destroy()); this._connLostObjs = null; }
    const gs = this.scene.get('GameScene');
    if (!wasShowing && gs) gs._modalBlockingClicks = true; // см. паттерн в GameScene — иначе клик по кнопке ниже двигает корабль
    const W = this.scale.width, H = this.scale.height;
    const objs = [];
    objs.push(this.add.rectangle(0, 0, W, H, 0x000000, 0.55).setOrigin(0, 0).setDepth(500).setScrollFactor(0).setInteractive());
    const OW = 340, OH = 150, ox = (W - OW) / 2, oy = (H - OH) / 2;
    objs.push(this.add.rectangle(ox, oy, OW, OH, 0x0e0608, 0.97)
      .setOrigin(0, 0).setStrokeStyle(1.5, 0xef5350, 0.8).setDepth(501).setScrollFactor(0));
    objs.push(this.add.text(ox + OW / 2, oy + 28, '⚠ Соединение потеряно', {
      fontFamily: 'Orbitron, sans-serif', fontSize: '15px', color: '#ef5350', resolution: UI_RES,
    }).setOrigin(0.5).setDepth(502).setScrollFactor(0));
    objs.push(this.add.text(ox + OW / 2, oy + 62, subtitle, {
      fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#ccaaaa', resolution: UI_RES,
      wordWrap: { width: OW - 40 }, align: 'center',
    }).setOrigin(0.5).setDepth(502).setScrollFactor(0));
    const btnY = oy + OH - 32;
    const btn = this.add.rectangle(ox + OW / 2, btnY, 170, 32, 0x1a0808, 1)
      .setStrokeStyle(1, 0xef5350, 0.8).setDepth(502).setScrollFactor(0).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => this._retryConnectionNow());
    objs.push(btn);
    objs.push(this.add.text(ox + OW / 2, btnY, 'ПОВТОРИТЬ СЕЙЧАС', {
      fontFamily: 'Orbitron, sans-serif', fontSize: '11px', color: '#ef9a9a', resolution: UI_RES,
    }).setOrigin(0.5).setDepth(503).setScrollFactor(0));
    this._connLostObjs = objs;
  }

  _hideConnectionLostModal() {
    if (!this._connLostObjs) return;
    this._connLostObjs.forEach(o => o?.destroy());
    this._connLostObjs = null;
    const gs = this.scene.get('GameScene');
    if (gs) this.time.delayedCall(0, () => { gs._modalBlockingClicks = false; });
  }

  _retryConnectionNow() {
    if (this._chatReconnectTimer) { clearTimeout(this._chatReconnectTimer); this._chatReconnectTimer = null; }
    this._hideConnectionLostModal();
    this._connectChatWS();
  }

  _saveChatState() {
    try { localStorage.setItem('sd_chat_state', JSON.stringify({ x: this._chatX, y: this._chatY, w: this._chatW, h: this._chatH })); } catch {}
  }

  // ── HUD кнопки: ГРУППА/ДРУЗЬЯ/ПОЧТА/ПРОФИЛЬ/НАСТРОЙКИ ──────────────────────
  // Крупнее (было 26×22) и с более крупными иконками — читались слишком мелко (баг из
  // диалога: "сделай кнопки крупнее и картинки на них читабельнее"). НАСТРОЙКИ — раньше
  // отдельная перетаскиваемая кнопка в другом месте HUD, теперь 5-й слот этого же ряда,
  // сразу после профиля ("после профиля прикрепи настройки, сейчас это отдельная
  // кнопка"). Ряд можно разворачивать и горизонтально, и вертикально — клик по ручке
  // (без перетаскивания) переключает ориентацию, см. pointerup ниже ("сделай возможность
  // кнопки и по вертикали и по горизонтали").
  _buildHudSocialButtons() {
    const F = (sz, c) => ({ fontFamily: 'Inter, sans-serif', fontSize: sz, color: c, resolution: UI_RES });
    const W = this.scale.width, H = this.scale.height;
    const BH = 36, BW = 40;   // button size
    const GAP = 3, GRIP = 18; // gap between buttons + grip thickness

    // ЧАТ — перед настройками (правка по просьбе): клик открывает/сворачивает то же
    // окно, что и крестик/сворачивание-перетаскиванием внутри самого чата (см.
    // _rebuildChatPanel — this._chatVisible уже управляет ровно этим же состоянием).
    const BTN_DEFS = [
      { key: 'grp',  icon: '⚔', tip: 'ГРУППА',       badgeColor: '#4dd0e1', action: () => this._toggleGroupWin() },
      { key: 'fr',   icon: '★', tip: 'ДРУЗЬЯ  [F]',  badgeColor: '#ef5350', action: () => this._toggleFriendsWin() },
      { key: 'mail', icon: '✉', tip: 'ПОЧТА  [B]',   badgeColor: '#ef5350', action: () => this.scene.get('GameScene').toggleOverlay('MailScene') },
      { key: 'prof', icon: '🪪', tip: 'ПРОФИЛЬ  [U]', badgeColor: null,      action: () => this.scene.get('GameScene').toggleOverlay('ProfileScene') },
      { key: 'chat', icon: '💬', tip: 'ЧАТ',          badgeColor: null,      action: () => this._toggleChatWin() },
      { key: 'set',  icon: '⚙', tip: 'НАСТРОЙКИ',    badgeColor: null,      action: () => this.gs.toggleOverlay('SettingsScene') },
    ];

    // Restore saved position/orientation (та же localStorage-запись, что и раньше,
    // просто с добавленным полем orient — старые сохранённые {x,y} без orient молча
    // трактуются как горизонтальные, обратной совместимости ради).
    let bx = 8, by = 92, orient = 'h';
    try {
      const s = JSON.parse(localStorage.getItem('sd_social_btns') || 'null');
      if (s) { bx = s.x; by = s.y; orient = s.orient === 'v' ? 'v' : 'h'; }
    } catch {}
    this._socialOrient = orient;
    const isV = orient === 'v';
    const barW = isV ? BW : GRIP + BTN_DEFS.length * (BW + GAP) - GAP;
    const barH = isV ? GRIP + BTN_DEFS.length * (BH + GAP) - GAP : BH;
    this._socialBarW = barW; this._socialBarH = barH;

    bx = Math.max(0, Math.min(W - barW - 2, bx));
    by = Math.max(0, Math.min(H - barH - 2, by));

    this._socialBtnC = this.add.container(bx, by).setDepth(104);
    const mk = o => { this._socialBtnC.add(o); return o; };

    // ── Grip ──────────────────────────────────────────────────────────────
    const gripW = isV ? BW : GRIP - 2;
    const gripH = isV ? GRIP - 2 : BH;
    const grip = mk(this.add.rectangle(0, 0, gripW, gripH, 0x060f1c, 0.9)
      .setOrigin(0).setStrokeStyle(1, 0x1e3050, 0.6).setInteractive({ useHandCursor: true, cursor: 'grab' }));
    mk(this.add.text(gripW / 2, gripH / 2, '⠿', F('10px', '#263a50')).setOrigin(0.5));

    // ── Tooltip (outside _socialBtnC so it's not clipped) ───────────────────
    this._socialTooltip    = this.add.container(0, 0).setDepth(210).setVisible(false);
    const ttBg  = this.add.rectangle(0, 0, 110, 20, 0x030c18, 0.97)
      .setOrigin(0.5).setStrokeStyle(1, 0x1a4060, 0.9);
    const ttTxt = this.add.text(0, 0, '', F('10px', '#4dd0e1')).setOrigin(0.5);
    this._socialTooltip.add([ttBg, ttTxt]);
    this._socialTooltipTxt = ttTxt;
    this._hideTip = () => this._socialTooltip.setVisible(false);

    const showTip = (lx, ly, label) => {
      const cx = this._socialBtnC.x + lx + BW / 2;
      const cy = this._socialBtnC.y + ly + BH / 2;
      let tx, ty;
      if (isV) {
        // Слева/справа от кнопки, смотря куда есть место — вертикальный ряд обычно
        // стоит у одного из боковых краёв экрана.
        tx = cx < W / 2 ? cx + BW / 2 + 62 : cx - BW / 2 - 62;
        ty = cy;
      } else {
        tx = cx;
        ty = cy < 44 ? cy + BH / 2 + 12 : cy - BH / 2 - 12;
      }
      this._socialTooltipTxt.setText(label);
      this._socialTooltip.setPosition(tx, ty).setVisible(true);
    };

    // ── Buttons ───────────────────────────────────────────────────────────
    this._socialBtns = {};
    BTN_DEFS.forEach((def, i) => {
      const lx = isV ? 0 : GRIP + i * (BW + GAP);
      const ly = isV ? GRIP + i * (BH + GAP) : 0;
      const btn = mk(this.add.rectangle(lx, ly, BW, BH, 0x0a1828, 0.92)
        .setOrigin(0).setStrokeStyle(1, 0x1e4060, 0.8).setInteractive({ useHandCursor: true }));
      const txt = mk(this.add.text(lx + BW / 2, ly + BH / 2, def.icon, F('20px', '#3a7090')).setOrigin(0.5));
      const badge = def.badgeColor ? mk(this.add.text(lx + BW - 2, ly + 1, '', F('8px', def.badgeColor)).setOrigin(1, 0)) : null;
      this._socialBtns[def.key] = { btn, txt, badge, lx, ly };

      btn.on('pointerdown', () => { this._hideTip(); def.action(); });
      btn.on('pointerover', () => { btn.setFillStyle(0x102840); showTip(lx, ly, def.tip); });
      btn.on('pointerout',  () => { this._hideTip(); this._updateSocialBtnStyles(); });
    });

    // ── Drag (grip) — клик без перетаскивания переключает ориентацию,
    // см. pointerup-обработчик рядом с this._socialBtnDrag ниже ────────────
    this._socialBtnDrag = { active: false, moved: false, ox: 0, oy: 0 };
    grip.on('pointerdown', (p) => {
      this._socialBtnDrag.active = true;
      this._socialBtnDrag.moved  = false;
      this._socialBtnDrag.ox = p.x - this._socialBtnC.x;
      this._socialBtnDrag.oy = p.y - this._socialBtnC.y;
    });

    this._socialBtnC.setVisible(loadSettings().showSocialBtns !== false);
    this._updateSocialBtnStyles();
  }

  // Полностью пересобирает ряд (проще, чем на лету переставлять уже созданные объекты
  // под другую ориентацию) — вызывается кликом по ручке без перетаскивания, см. pointerup.
  _rebuildSocialButtons(newOrient, keepPos) {
    const x = keepPos ? this._socialBtnC?.x : 8;
    const y = keepPos ? this._socialBtnC?.y : 92;
    this._socialBtnC?.destroy();
    this._socialTooltip?.destroy();
    try {
      localStorage.setItem('sd_social_btns', JSON.stringify({ x: Math.round(x ?? 8), y: Math.round(y ?? 92), orient: newOrient }));
    } catch {}
    this._buildHudSocialButtons();
  }

  _updateSocialBtnStyles() {
    if (!this._socialBtnC || !this._socialBtns) return;
    const show = loadSettings().showSocialBtns !== false;
    this._socialBtnC.setVisible(show);
    if (!show) return;

    const grp     = this.groupSystem;
    const grpOn   = this._groupWinVisible;
    const frOn    = this._friendsWinVisible;
    const pending = (this._friendsList || []).filter(f => f.status === 'pending' && f.dir === 'in').length;

    // warnStroke — цвет обводки в "не активна, но что-то требует внимания" состоянии:
    // группа использует другой (нейтрально-синий "я в группе"), остальные — жёлто-
    // оранжевый "есть непрочитанное/ожидающее" — тот же контраст, что и раньше.
    const setBtn = (key, on, warn, badgeText, warnStroke = 0x806020) => {
      const b = this._socialBtns[key];
      if (!b) return;
      b.btn.setFillStyle(on ? 0x0f3040 : 0x0a1828);
      b.btn.setStrokeStyle(1, on ? 0x4dd0e1 : (warn ? warnStroke : 0x1e4060), 1);
      b.txt.setColor(on || (warn && key === 'grp') ? '#4dd0e1' : (warn ? '#ffb74d' : '#3a7090'));
      b.badge?.setText(badgeText ?? '');
    };

    setBtn('grp', grpOn, grp?.inGroup, grp?.inGroup && grp.memberCount > 1 ? `${grp.memberCount}` : '', 0x2a6080);
    setBtn('fr', frOn, pending > 0, pending > 0 ? `${pending}` : '');

    const mailOn = this.scene.isActive('MailScene');
    const unread = this._mailUnread || 0;
    setBtn('mail', mailOn, unread > 0, unread > 0 ? `${unread}` : '');

    const profOn = this.scene.isActive('ProfileScene');
    setBtn('prof', profOn, false);

    // Подсвечена, пока чат виден в ЛЮБОМ виде (окно или свёрнутая таблетка) — гаснет
    // только когда убран полностью этой же кнопкой (см. _toggleChatWin/_chatHidden).
    setBtn('chat', !this._chatHidden, false);

    const setOn = this.scene.isActive('SettingsScene');
    setBtn('set', setOn, false);
  }

  _toggleGroupWin()   { this._groupWinVisible   = !this._groupWinVisible;   this._rebuildGroupWin();   this._updateSocialBtnStyles(); }
  _toggleFriendsWin() { this._friendsWinVisible = !this._friendsWinVisible; this._rebuildFriendsWin(); this._updateSocialBtnStyles(); }
  // Отдельное от крестика/сворачивания-перетаскиванием (те дают маленькую таблетку,
  // см. _rebuildChatPanel) состояние — кнопка на общей панели убирает чат ПОЛНОСТЬЮ,
  // без остатка в виде таблетки (правка по просьбе: "убирать полностью чат, даже
  // маленькое свёрнутое окошко"), и восстанавливает в виде полного окна при повторном клике.
  _toggleChatWin() {
    this._chatHidden = !this._chatHidden;
    if (this._chatHidden) {
      this._chatVisible = false;
    } else {
      this._chatVisible = true;
      this._chatCollapsed = false;
    }
    this._rebuildChatPanel();
    this._updateSocialBtnStyles();
  }

  // ── Окно ГРУППА ──────────────────────────────────────────────────────────

  _buildGroupWin() {
    const _ws = loadSettings();
    const x = _ws.grpWinX ?? 8, y = _ws.grpWinY ?? 118;
    this._grpWin = this.add.container(x, y).setDepth(102);

    // HTML invite input — positioned over the invite field inside the group window
    const invInp = document.createElement('input');
    invInp.type = 'text'; invInp.maxLength = 50;
    invInp.placeholder = 'ник игрока...';
    Object.assign(invInp.style, {
      position: 'fixed', background: '#040e1c', border: '1px solid #1e3a54',
      color: '#4dd0e1', fontFamily: 'Inter, sans-serif',
      padding: '0 6px', outline: 'none', zIndex: '1001',
      boxSizing: 'border-box', display: 'none',
      pointerEvents: 'none',
    });
    invInp.addEventListener('focus', () => { invInp.style.pointerEvents = 'auto'; });
    invInp.addEventListener('blur',  () => { invInp.style.pointerEvents = 'none'; });
    invInp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const v = invInp.value.trim();
        this._groupInviteTarget = v || null;
        invInp.blur();
        if (this._groupWinVisible) this._rebuildGroupWin();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        this._groupInviteTarget = null;
        invInp.value = '';
        invInp.blur();
        if (this._groupWinVisible) this._rebuildGroupWin();
      }
      e.stopPropagation(); e.stopImmediatePropagation();
    });
    document.body.appendChild(invInp);
    this._grpInviteInputEl   = invInp;
    this._grpInviteFieldRect = null;

    this.events.once('shutdown', () => {
      this._grpInviteInputEl?.parentNode?.removeChild(this._grpInviteInputEl);
      this._grpInviteInputEl = null;
    });

    this._rebuildGroupWin();
  }

  _rebuildGroupWin() {
    this._grpWin?.removeAll(true);
    if (!this._groupWinVisible) {
      this._grpWin?.setVisible(false);
      this._grpInviteFieldRect = null;
      this._posGrpInviteInput();
      return;
    }
    this._grpWin.setVisible(true);

    const grp      = this.groupSystem;
    const collapsed = this._grpWinCollapsed;
    const BG_ALPHA  = [0.93, 0.55, 0.22][loadSettings().grpWinAlphaIdx ?? 0];
    const PW = 248, PAD = 8, HDR = 28, INV_ROW = 30, INVITE_BANNER_H = 46;
    const F  = (sz, c) => ({ fontFamily: 'Inter, sans-serif',    fontSize: sz, color: c, resolution: UI_RES });
    const O  = (sz, c) => ({ fontFamily: 'Orbitron, sans-serif', fontSize: sz, color: c, resolution: UI_RES });
    const add = o => { this._grpWin.add(o); return o; };

    const members    = grp?.members ?? [];
    const myName     = this.gs?.playerName || '';
    const showInvRow = !grp?.isSolo;

    // Online friends in same sector, not yet in group
    const nearbyFriends = (this._friendsList || []).filter(f =>
      f.status === 'accepted' && f.online && f.sector === galaxy.current && !members.includes(f.name)
    ).slice(0, 4);

    // Pending invites not yet joined
    const pendingRows = [];
    for (const [name, status] of (this._groupPendingInvites || new Map())) {
      if (status === 'pending' && !members.includes(name)) pendingRows.push(name);
    }

    const showBossBar = this._groupBossHpRatio > 0 && this._groupBossHpRatio < 1;
    const logEntries  = (this._groupEventLog || []).slice(-4);

    // ── Calculate height ──────────────────────────────────────────────────────
    let contentH = 0;
    if (!collapsed) {
      contentH += 1;
      if (this._incomingInvite) contentH += INVITE_BANNER_H;
      if (showInvRow) contentH += INV_ROW;
      if (nearbyFriends.length > 0) contentH += 24;
      contentH += 1;
      const rowCount = members.length + pendingRows.length;
      if (!grp?.inGroup && rowCount === 0) contentH += 22;
      contentH += rowCount * 20;
      if (showBossBar) contentH += 28;
      if (grp?.inGroup) { contentH += 1; contentH += 26; }
      if (logEntries.length > 0) { contentH += 1; contentH += 14 + logEntries.length * 13; }
      contentH += 4;
    }
    const totalH = HDR + contentH;

    // ── Background ───────────────────────────────────────────────────────────
    add(this.add.rectangle(0, 0, PW, totalH, 0x020a14, BG_ALPHA).setOrigin(0).setStrokeStyle(1, 0x1a4060, 0.7));

    // ── Drag handle ──────────────────────────────────────────────────────────
    const dragHandle = add(this.add.rectangle(0, 0, PW - 46, HDR, 0x000000, 0.001)
      .setOrigin(0).setInteractive({ useHandCursor: true, cursor: 'grab' }));
    dragHandle.on('pointerdown', (p) => {
      this._grpWinDrag.active = true;
      this._grpWinDrag.ox = p.x - this._grpWin.x;
      this._grpWinDrag.oy = p.y - this._grpWin.y;
    });

    // ── Title ────────────────────────────────────────────────────────────────
    const titleStr = grp?.inGroup ? `ГРУППА  ${members.length}/8` : 'ГРУППА';
    add(this.add.text(PAD, 9, titleStr, O('10px', '#4dd0e1')));

    // ── Header buttons ───────────────────────────────────────────────────────
    const colBtn = add(this.add.text(PW - 36, 9, collapsed ? '+' : '−', F('13px', '#4dd0e1'))
      .setInteractive({ useHandCursor: true }));
    colBtn.on('pointerdown', () => {
      this._grpWinCollapsed = !this._grpWinCollapsed;
      const s = loadSettings(); s.grpWinCollapsed = this._grpWinCollapsed; saveSettings(s);
      this._rebuildGroupWin();
    });
    const closeBtn = add(this.add.text(PW - 16, 9, '✕', F('11px', '#ef5350'))
      .setInteractive({ useHandCursor: true }));
    closeBtn.on('pointerdown', () => this._toggleGroupWin());

    if (collapsed) {
      this._grpInviteFieldRect = null;
      this._posGrpInviteInput();
      return;
    }

    // ── Content ──────────────────────────────────────────────────────────────
    let y = HDR;
    add(this.add.rectangle(0, y, PW, 1, 0x1a4060, 0.4).setOrigin(0)); y += 1;

    // ── Входящее приглашение — раньше единственный способ принять был набрать команду
    // "/принять <ник>" в чат, а подсказка тонула мелким текстом в общем логе (баг из
    // диалога: "не понятно как принять приглашение"). Теперь — заметный баннер с
    // кнопками прямо здесь, первым, что видно при открытии окна.
    if (this._incomingInvite) {
      const inv = this._incomingInvite;
      add(this.add.rectangle(PAD / 2, y + 2, PW - PAD, INVITE_BANNER_H - 4, 0x0a2030, 0.9)
        .setOrigin(0).setStrokeStyle(1, 0x2a6040, 0.9));
      add(this.add.text(PAD, y + 7, `${inv.from} зовёт в группу`, F('11px', '#e0e0e0')));
      const btnY = y + 22;
      const acceptBtn = add(this.add.rectangle(PAD, btnY, 90, 20, 0x0d3020, 1)
        .setOrigin(0).setStrokeStyle(1, 0x2a8050, 1).setInteractive({ useHandCursor: true }));
      add(this.add.text(PAD + 45, btnY + 10, 'Принять', F('10px', '#66bb6a')).setOrigin(0.5));
      acceptBtn.on('pointerover', () => acceptBtn.setFillStyle(0x104028));
      acceptBtn.on('pointerout',  () => acceptBtn.setFillStyle(0x0d3020));
      acceptBtn.on('pointerdown', () => {
        this.groupSystem.join(inv.from);
        this._groupLog(`Вступление к ${inv.from}…`);
        this._incomingInvite = null;
        this._rebuildGroupWin();
      });
      const declineX = PAD + 96;
      const declineBtn = add(this.add.rectangle(declineX, btnY, 90, 20, 0x2a1010, 1)
        .setOrigin(0).setStrokeStyle(1, 0x703030, 1).setInteractive({ useHandCursor: true }));
      add(this.add.text(declineX + 45, btnY + 10, 'Отклонить', F('10px', '#ef5350')).setOrigin(0.5));
      declineBtn.on('pointerover', () => declineBtn.setFillStyle(0x381414));
      declineBtn.on('pointerout',  () => declineBtn.setFillStyle(0x2a1010));
      declineBtn.on('pointerdown', () => {
        this._incomingInvite = null;
        this._rebuildGroupWin();
      });
      y += INVITE_BANNER_H;
    }

    // ── Invite input row ─────────────────────────────────────────────────────
    if (showInvRow) {
      const FIELD_W = PW - PAD * 2 - 32;
      const PLUS_W  = 28;
      const FIELD_X = PAD, FIELD_Y = y + 4;

      // Visual bg (HTML input sits on top)
      add(this.add.rectangle(FIELD_X, FIELD_Y, FIELD_W, 22, 0x040e1c, 1)
        .setOrigin(0).setStrokeStyle(1, 0x1e3a54, 0.9)
        .setInteractive({ useHandCursor: true }))
        .on('pointerdown', () => this._grpInviteInputEl?.focus());

      this._grpInviteFieldRect = { x: FIELD_X, y: FIELD_Y, w: FIELD_W, h: 22 };

      // [+] button
      const plusX = PW - PAD - PLUS_W;
      const plusBg = add(this.add.rectangle(plusX, FIELD_Y, PLUS_W, 22, 0x0a2030, 1)
        .setOrigin(0).setStrokeStyle(1, 0x1a5040, 0.9)
        .setInteractive({ useHandCursor: true }));
      add(this.add.text(plusX + PLUS_W / 2, FIELD_Y + 11, '+', F('15px', '#66bb6a')).setOrigin(0.5));
      plusBg.on('pointerover', () => plusBg.setFillStyle(0x0d3020));
      plusBg.on('pointerout',  () => plusBg.setFillStyle(0x0a2030));
      plusBg.on('pointerdown', () => {
        const name = (this._grpInviteInputEl?.value.trim()) || this._groupInviteTarget;
        if (!name) return;
        const grp2 = this.groupSystem;
        if (!grp2) return;
        if (!grp2.inGroup) {
          grp2.create(galaxy.current, false);
          this._groupLog('Группа создана');
        }
        grp2.invite(name, galaxy.current);
        this._groupPendingInvites.set(name, 'pending');
        this._groupLog(`Приглашение → ${name}`);
        this._groupInviteTarget = null;
        if (this._grpInviteInputEl) this._grpInviteInputEl.value = '';
        this._rebuildGroupWin();
        this._updateSocialBtnStyles();
      });
      y += INV_ROW;
    } else {
      this._grpInviteFieldRect = null;
    }

    // ── Nearby online friends (same sector) ──────────────────────────────────
    if (nearbyFriends.length > 0) {
      const gap    = 4;
      const chipW  = Math.floor((PW - PAD * 2 - gap * (nearbyFriends.length - 1)) / nearbyFriends.length);
      let cx = PAD;
      for (const f of nearbyFriends) {
        const chipBg = add(this.add.rectangle(cx, y + 2, chipW, 18, 0x0a2030, 1)
          .setOrigin(0).setStrokeStyle(1, 0x1a6040, 0.8).setInteractive({ useHandCursor: true }));
        const label = f.name.length > 7 ? f.name.slice(0, 6) + '…' : f.name;
        add(this.add.text(cx + chipW / 2, y + 11, '● ' + label, F('9px', '#4CAF50')).setOrigin(0.5));
        chipBg.on('pointerover', () => chipBg.setFillStyle(0x0d2e40));
        chipBg.on('pointerout',  () => chipBg.setFillStyle(0x0a2030));
        chipBg.on('pointerdown', () => this._setGroupInviteTarget(f.name));
        cx += chipW + gap;
      }
      y += 24;
    }

    // Separator before member list
    add(this.add.rectangle(0, y, PW, 1, 0x1a4060, 0.25).setOrigin(0)); y += 1;

    // ── Hint when no group and no pending ────────────────────────────────────
    if (!grp?.inGroup && members.length === 0 && pendingRows.length === 0) {
      add(this.add.text(PAD, y + 5, 'Введи ник выше и нажми +', F('10px', '#2a4a60')));
      y += 22;
    }

    // ── Current members ──────────────────────────────────────────────────────
    members.forEach((name, i) => {
      const isMe = name === myName, isLeader = i === 0;
      add(this.add.text(PAD, y + 4, `${isMe ? '●' : '○'} ${name}${isLeader ? '  ♛' : ''}`,
        F('11px', isMe ? '#80cbc4' : '#9fb3b8')));
      y += 20;
    });

    // ── Pending invites ──────────────────────────────────────────────────────
    pendingRows.forEach(name => {
      add(this.add.text(PAD, y + 4, `⌛ ${name}`, F('11px', '#7a9a6a')));
      add(this.add.text(PW - PAD, y + 4, 'ожидание', F('9px', '#4a5a3a')).setOrigin(1, 0));
      y += 20;
    });

    // ── Boss HP bar ──────────────────────────────────────────────────────────
    if (showBossBar) {
      const BW = PW - PAD * 2, BH = 7;
      add(this.add.text(PAD, y + 2, 'БОСС', O('8px', '#ef5350')));
      add(this.add.rectangle(PAD, y + 14, BW, BH, 0x1a0000, 1).setOrigin(0));
      const ratio = Math.max(0, Math.min(1, this._groupBossHpRatio));
      const bCol  = ratio > 0.5 ? 0xef5350 : ratio > 0.25 ? 0xff7043 : 0xffa726;
      add(this.add.rectangle(PAD, y + 14, Math.round(BW * ratio), BH, bCol, 1).setOrigin(0));
      add(this.add.text(PAD + BW, y + 12, `${Math.round(ratio * 100)}%`, F('9px', '#ef9a9a')).setOrigin(1, 0));
      y += 28;
    }

    // ── Leave button ─────────────────────────────────────────────────────────
    if (grp?.inGroup) {
      add(this.add.rectangle(0, y, PW, 1, 0x1a4060, 0.3).setOrigin(0)); y += 1;
      const leaveBtn = add(this.add.text(PAD, y + 5, '← Покинуть группу', F('10px', '#ef5350'))
        .setInteractive({ useHandCursor: true }));
      leaveBtn.on('pointerover', () => leaveBtn.setAlpha(0.7));
      leaveBtn.on('pointerout',  () => leaveBtn.setAlpha(1));
      leaveBtn.on('pointerdown', () => {
        this.groupSystem?.leave();
        this._groupPendingInvites?.clear();
        this._groupLog('Вы вышли из группы');
        const gs = this.scene.get('GameScene');
        if (gs) gs.groupSize = 0;
        this._rebuildGroupWin();
        this._updateSocialBtnStyles();
      });
      y += 26;
    }

    // ── Group event log ──────────────────────────────────────────────────────
    if (logEntries.length > 0) {
      add(this.add.rectangle(0, y, PW, 1, 0x1a4060, 0.25).setOrigin(0)); y += 1;
      add(this.add.text(PAD, y + 2, 'Лог:', F('9px', '#2a4a60'))); y += 14;
      // wordWrap — раньше длинные строки (напр. старая подсказка про приглашение)
      // просто вылезали за правый край панели вместо переноса (баг из диалога: "текст
      // очень мелко и не влазит в окно"). Высота панели (contentH выше) всё ещё
      // считает по 1 строке на запись — при переносе текст ниже НЕ вылезет за фон панели
      // (задний фон панели просто получится с небольшим запасом), это лучше, чем обрезка.
      logEntries.forEach(entry => {
        add(this.add.text(PAD, y, `• ${entry}`, { ...F('10px', '#3a6878'), wordWrap: { width: PW - PAD * 2 } }));
        y += 13;
      });
    }

    this._posGrpInviteInput();
  }

  // ── Helper: group log ─────────────────────────────────────────────────────

  _groupLog(text) {
    if (!this._groupEventLog) this._groupEventLog = [];
    const d = new Date();
    const t = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    this._groupEventLog.push(`${t} ${text}`);
    if (this._groupEventLog.length > 20) this._groupEventLog.shift();
    this.game.events.emit('hud-log', `[Группа] ${text}`);
  }

  /** Set invite target (from chat click or friend chip), auto-opens group window. */
  _setGroupInviteTarget(name) {
    this._groupInviteTarget = name || null;
    if (this._grpInviteInputEl) this._grpInviteInputEl.value = name || '';
    if (this._groupWinVisible && !this._grpWinCollapsed) {
      this._rebuildGroupWin();
    } else if (name) {
      this._groupWinVisible  = true;
      this._grpWinCollapsed  = false;
      this._rebuildGroupWin();
      this._updateSocialBtnStyles();
    }
  }

  /** Reposition the HTML invite input over the group window field. */
  _posGrpInviteInput() {
    const inp = this._grpInviteInputEl;
    if (!inp) return;
    const rect = this._grpInviteFieldRect;
    if (!rect || !this._groupWinVisible || this._grpWinCollapsed) {
      inp.style.display = 'none'; return;
    }
    const r  = this.game.canvas.getBoundingClientRect();
    const sx = r.width  / this.scale.width;
    const sy = r.height / this.scale.height;
    Object.assign(inp.style, {
      display:  'block',
      left:     `${Math.round(r.left + (this._grpWin.x + rect.x) * sx)}px`,
      top:      `${Math.round(r.top  + (this._grpWin.y + rect.y) * sy)}px`,
      width:    `${Math.round(rect.w * sx)}px`,
      height:   `${Math.round(rect.h * sy)}px`,
      fontSize: `${Math.round(11 * sy)}px`,
    });
  }

  // ── Окно ДРУЗЬЯ ──────────────────────────────────────────────────────────

  // ── Чёрный список ────────────────────────────────────────────────────
  // REST, не WS — блокировка однонаправленна и не должна уведомлять заблокированного
  // в реальном времени (см. server/main.py, комментарий у /player/blacklist).
  async _loadBlacklist() {
    try {
      const r = await blacklistList();
      this._blacklist = r.blocked || [];
      this._rebuildFriendsWin();
    } catch (_) { /* DEV-профиль без реальной сессии — молча оставляем пустым */ }
  }

  _isBlocked(name) { return (this._blacklist || []).some(b => b.username === name); }

  // ProfileViewScene должна каждый раз стартовать с чистыми данными для нового ника —
  // stop-then-launch, а не голый launch() поверх уже открытой (см. паттерн toggleOverlay).
  _openProfileView(name) {
    if (this.scene.isActive('ProfileViewScene')) this.scene.stop('ProfileViewScene');
    this.scene.launch('ProfileViewScene', { viewName: name });
  }

  async _addToBlacklist(name) {
    try {
      const r = await blacklistAdd(name);
      this._blacklist = r.blocked || [];
      this.pushChatMessage('general', 'System', `[ЧС] ${name} добавлен в чёрный список`, {});
      this._rebuildFriendsWin();
    } catch (e) { this.pushChatMessage('general', 'System', `[ЧС] Ошибка: ${e.message}`, {}); }
  }

  async _removeFromBlacklist(name) {
    try {
      const r = await blacklistRemove(name);
      this._blacklist = r.blocked || [];
      this._rebuildFriendsWin();
    } catch (_) {}
  }

  _buildFriendsWin() {
    const W = this.scale.width;
    const _ws = loadSettings();
    const x = _ws.frWinX ?? (W - 292), y = _ws.frWinY ?? 40;
    this._frWin = this.add.container(x, y).setDepth(103);
    this._rebuildFriendsWin();
  }

  _rebuildFriendsWin() {
    this._frWin?.removeAll(true);
    if (!this._friendsWinVisible) { this._frWin?.setVisible(false); return; }
    this._frWin.setVisible(true);

    const collapsed = this._frWinCollapsed;
    const BG_ALPHA  = [0.93, 0.55, 0.22][loadSettings().frWinAlphaIdx ?? 0];
    const PW = 284, PAD = 8, HDR = 28;
    const F  = (sz, c) => ({ fontFamily: 'Inter, sans-serif',    fontSize: sz, color: c, resolution: UI_RES });
    const O  = (sz, c) => ({ fontFamily: 'Orbitron, sans-serif', fontSize: sz, color: c, resolution: UI_RES });
    const add = o => { this._frWin.add(o); return o; };

    const friends   = this._friendsList || [];
    const pending   = friends.filter(f => f.status === 'pending' && f.dir === 'in');
    const accepted  = friends.filter(f => f.status === 'accepted');
    const online    = accepted.filter(f =>  f.online).sort((a, b) => a.name.localeCompare(b.name));
    const offline   = accepted.filter(f => !f.online).sort((a, b) => a.name.localeCompare(b.name));
    const onlineCnt = online.length;
    const blocked   = this._blacklist || [];
    const tab       = this._frWinTab || 'friends';
    const TAB_H     = 22;

    // ── Полная высота ──
    let contentH = 0;
    if (!collapsed) {
      if (tab === 'blacklist') {
        contentH = TAB_H + 1 + Math.max(blocked.length, 1) * 20 + 1 + 34;
      } else {
        const pendingH = pending.length > 0 ? 22 + pending.length * 24 + 1 : 0;
        contentH = TAB_H + 1 + pendingH + online.length * 24 + offline.length * 20 + 1 + 34;
      }
    }
    const totalH = HDR + contentH;

    // ── Фон ──
    add(this.add.rectangle(0, 0, PW, totalH, 0x020a14, BG_ALPHA).setOrigin(0).setStrokeStyle(1, 0x1a4060, 0.8));

    // ── Drag handle ──
    const dragHandle = add(this.add.rectangle(0, 0, PW - 46, HDR, 0x000000, 0.001)
      .setOrigin(0).setInteractive({ useHandCursor: true, cursor: 'grab' }));
    dragHandle.on('pointerdown', (p) => {
      this._frWinDrag.active = true;
      this._frWinDrag.ox = p.x - this._frWin.x;
      this._frWinDrag.oy = p.y - this._frWin.y;
    });

    // ── Заголовок ──
    const titleSuffix = onlineCnt > 0 ? `  •  ${onlineCnt} онлайн` : '';
    add(this.add.text(PAD, 9, `ДРУЗЬЯ${titleSuffix}`, O('10px', '#4dd0e1')));

    // ── Кнопки заголовка (− | ✕) ──
    const colBtn = add(this.add.text(PW - 36, 9, collapsed ? '+' : '−', F('13px', '#4dd0e1'))
      .setInteractive({ useHandCursor: true }));
    colBtn.on('pointerdown', () => {
      this._frWinCollapsed = !this._frWinCollapsed;
      const s = loadSettings(); s.frWinCollapsed = this._frWinCollapsed; saveSettings(s);
      this._rebuildFriendsWin();
    });

    const closeBtn = add(this.add.text(PW - 16, 9, '✕', F('11px', '#ef5350'))
      .setInteractive({ useHandCursor: true }));
    closeBtn.on('pointerdown', () => { this._friendsWinVisible = false; this._rebuildFriendsWin(); this._updateSocialBtnStyles(); });

    if (collapsed) return;

    // ── Табы: Друзья | ЧС ──
    let y = HDR;
    const tabW = PW / 2;
    const frTabBg = add(this.add.rectangle(0, y, tabW, TAB_H, tab === 'friends' ? 0x0d2035 : 0x050d18, 1)
      .setOrigin(0).setInteractive({ useHandCursor: true }));
    add(this.add.text(tabW / 2, y + TAB_H / 2, 'ДРУЗЬЯ', F('9px', tab === 'friends' ? '#4dd0e1' : '#4a8899')).setOrigin(0.5));
    frTabBg.on('pointerdown', () => { this._frWinTab = 'friends'; this._rebuildFriendsWin(); });
    const blTabBg = add(this.add.rectangle(tabW, y, tabW, TAB_H, tab === 'blacklist' ? 0x0d2035 : 0x050d18, 1)
      .setOrigin(0).setInteractive({ useHandCursor: true }));
    add(this.add.text(tabW + tabW / 2, y + TAB_H / 2, `🚫 ЧС${blocked.length ? ` (${blocked.length})` : ''}`, F('9px', tab === 'blacklist' ? '#4dd0e1' : '#4a8899')).setOrigin(0.5));
    blTabBg.on('pointerdown', () => { this._frWinTab = 'blacklist'; this._rebuildFriendsWin(); });
    y += TAB_H;
    add(this.add.rectangle(0, y, PW, 1, 0x1a4060, 0.5).setOrigin(0));
    y += 1;

    if (tab === 'blacklist') {
      if (blocked.length === 0) {
        add(this.add.text(PAD, y + 4, 'Чёрный список пуст', F('10px', '#607d8b')));
        y += 20;
      } else {
        for (const b of blocked) {
          add(this.add.text(PAD, y + 3, '🚫', F('10px', '#ef5350')));
          add(this.add.text(PAD + 16, y + 3, b.username, F('11px', '#cfd8dc')));
          const remBtn = add(this.add.rectangle(PW - PAD - 46, y + 1, 46, 16, 0x100008, 0.8).setOrigin(0)
            .setStrokeStyle(1, 0x280010, 0.6).setInteractive({ useHandCursor: true }));
          add(this.add.text(PW - PAD - 23, y + 9, 'убрать', F('9px', '#78909c')).setOrigin(0.5));
          remBtn.on('pointerdown', () => this._removeFromBlacklist(b.username));
          y += 20;
        }
      }

      add(this.add.rectangle(0, y, PW, 1, 0x1a4060, 0.4).setOrigin(0));
      y += 1;
      const addBlBtn = add(this.add.rectangle(PAD, y + 5, PW - PAD * 2, 24, 0x0a1828, 1).setOrigin(0)
        .setStrokeStyle(1, 0x1e4060, 0.5).setInteractive({ useHandCursor: true }));
      add(this.add.text(PW / 2, y + 17, '+ Добавить в ЧС  /чс [ник]', F('9px', '#4dd0e1')).setOrigin(0.5));
      addBlBtn.on('pointerover', () => addBlBtn.setFillStyle(0x0d2e40));
      addBlBtn.on('pointerout',  () => addBlBtn.setFillStyle(0x0a1828));
      addBlBtn.on('pointerdown', () => {
        if (this._chatInputEl) {
          this._chatInputEl.value = '/чс ';
          this._chatVisible = true;
          this._rebuildChatPanel();
          this._chatInputEl.focus();
        }
      });
      return;
    }

    // Входящие запросы
    if (pending.length > 0) {
      add(this.add.text(PAD, y + 4, `⚠  Запросы: ${pending.length}`, F('10px', '#ffb74d')));
      y += 22;
      for (const f of pending) {
        add(this.add.text(PAD, y + 4, `● ${f.name}`, F('11px', '#ffa726')));
        const accBtn = add(this.add.rectangle(PW - PAD - 58, y + 2, 28, 18, 0x0d2a1a, 1).setOrigin(0)
          .setStrokeStyle(1, 0x1a4a2a, 0.9).setInteractive({ useHandCursor: true }));
        add(this.add.text(PW - PAD - 44, y + 11, '✓', F('13px', '#66bb6a')).setOrigin(0.5));
        accBtn.on('pointerover', () => accBtn.setFillStyle(0x143520));
        accBtn.on('pointerout',  () => accBtn.setFillStyle(0x0d2a1a));
        accBtn.on('pointerdown', () => this.groupSystem?.friendAccept(f.name));
        const decBtn = add(this.add.rectangle(PW - PAD - 26, y + 2, 28, 18, 0x200010, 1).setOrigin(0)
          .setStrokeStyle(1, 0x400020, 0.9).setInteractive({ useHandCursor: true }));
        add(this.add.text(PW - PAD - 12, y + 11, '✗', F('13px', '#ef5350')).setOrigin(0.5));
        decBtn.on('pointerover', () => decBtn.setFillStyle(0x300015));
        decBtn.on('pointerout',  () => decBtn.setFillStyle(0x200010));
        decBtn.on('pointerdown', () => this.groupSystem?.friendDecline(f.name));
        y += 24;
      }
      add(this.add.rectangle(0, y, PW, 1, 0x1a4060, 0.3).setOrigin(0));
      y += 1;
    }

    // Онлайн-друзья
    for (const f of online) {
      const isBlocked = this._isBlocked(f.name);
      add(this.add.text(PAD,      y + 4, '●', F('10px', '#4CAF50')));
      const nameTxt = add(this.add.text(PAD + 14, y + 4, f.name, F('11px', '#c8f0d0'))
        .setInteractive({ useHandCursor: true }));
      nameTxt.on('pointerover', () => nameTxt.setColor('#4dd0e1'));
      nameTxt.on('pointerout',  () => nameTxt.setColor('#c8f0d0'));
      nameTxt.on('pointerdown', () => this._openProfileView(f.name));
      if (f.sector) add(this.add.text(PAD + 14, y + 15, f.sector, F('8px', '#3a6858')));

      const invBtn = add(this.add.rectangle(PW - PAD - 56, y + 2, 30, 18, 0x0a2030, isBlocked ? 0.4 : 1).setOrigin(0)
        .setStrokeStyle(1, 0x1a4060, isBlocked ? 0.3 : 0.8));
      add(this.add.text(PW - PAD - 41, y + 11, '→Гр', F('9px', isBlocked ? '#3a4a55' : '#4dd0e1')).setOrigin(0.5));
      if (!isBlocked) {
        invBtn.setInteractive({ useHandCursor: true });
        invBtn.on('pointerover', () => invBtn.setFillStyle(0x0d2e40));
        invBtn.on('pointerout',  () => invBtn.setFillStyle(0x0a2030));
        invBtn.on('pointerdown', () => {
          const grp = this.groupSystem;
          if (!grp) return;
          if (!grp.inGroup) {
            grp.create(galaxy.current, false);
            this._groupLog('Группа создана');
            this._updateSocialBtnStyles();
          }
          grp.invite(f.name, galaxy.current);
          this._groupPendingInvites?.set(f.name, 'pending');
          this._groupLog(`Приглашение → ${f.name}`);
          this._rebuildGroupWin();
        });
      }

      const remBtn = add(this.add.rectangle(PW - PAD - 22, y + 2, 24, 18, 0x180008, 0.9).setOrigin(0)
        .setStrokeStyle(1, 0x380015, 0.7).setInteractive({ useHandCursor: true }));
      add(this.add.text(PW - PAD - 10, y + 11, '✕', F('11px', '#ef5350')).setOrigin(0.5));
      remBtn.on('pointerdown', () => this.groupSystem?.friendRemove(f.name));
      y += 24;
    }

    // Офлайн-друзья
    for (const f of offline) {
      add(this.add.text(PAD,      y + 3, '○', F('10px', '#455a64')));
      const nameTxt = add(this.add.text(PAD + 14, y + 3, f.name, F('11px', '#607d8b'))
        .setInteractive({ useHandCursor: true }));
      nameTxt.on('pointerover', () => nameTxt.setColor('#4dd0e1'));
      nameTxt.on('pointerout',  () => nameTxt.setColor('#607d8b'));
      nameTxt.on('pointerdown', () => this._openProfileView(f.name));
      const remBtn = add(this.add.rectangle(PW - PAD - 22, y + 1, 24, 16, 0x100008, 0.8).setOrigin(0)
        .setStrokeStyle(1, 0x280010, 0.6).setInteractive({ useHandCursor: true }));
      add(this.add.text(PW - PAD - 10, y + 9, '✕', F('10px', '#78909c')).setOrigin(0.5));
      remBtn.on('pointerdown', () => this.groupSystem?.friendRemove(f.name));
      y += 20;
    }

    // Кнопка «Добавить друга»
    add(this.add.rectangle(0, y, PW, 1, 0x1a4060, 0.4).setOrigin(0));
    y += 1;
    const addBtn = add(this.add.rectangle(PAD, y + 5, PW - PAD * 2, 24, 0x0a1828, 1).setOrigin(0)
      .setStrokeStyle(1, 0x1e4060, 0.5).setInteractive({ useHandCursor: true }));
    add(this.add.text(PW / 2, y + 17, '+ Добавить друга  /добавить [ник]', F('9px', '#4dd0e1')).setOrigin(0.5));
    addBtn.on('pointerover', () => addBtn.setFillStyle(0x0d2e40));
    addBtn.on('pointerout',  () => addBtn.setFillStyle(0x0a1828));
    addBtn.on('pointerdown', () => {
      if (this._chatInputEl) {
        this._chatInputEl.value = '/добавить ';
        this._chatVisible = true;
        this._rebuildChatPanel();
        this._chatInputEl.focus();
      }
    });
  }

  // ── Booster widget ────────────────────────────────────────────────────────

  _createBoosterWidget() {
    const F = (size, color = '#cfe9ee', weight = '600') =>
      ({ fontFamily: 'Inter, sans-serif', fontSize: size, color, fontStyle: weight, resolution: UI_RES });
    const O = (size, color = '#4dd0e1') =>
      ({ fontFamily: 'Orbitron, sans-serif', fontSize: size, color, resolution: UI_RES });
    const W = this.scale.width;
    let saved = {}; try { saved = JSON.parse(localStorage.getItem('sd_booster_win') || '{}'); } catch {}
    const WW = 200, hdrH = 26, rowH = 22;
    const bx = saved.x ?? (W - WW - 12);
    const by = saved.y ?? 120;

    this._bstClosed    = saved.closed || false;
    this._bstForceOpen = false;
    this._bstDrag     = { active: false, ox: 0, oy: 0 };
    this._bstPrevActive = {};
    this._bstLastVisCount = -1;
    this._bstWW = WW; this._bstHdrH = hdrH; this._bstRowH = rowH;

    const c = this.add.container(bx, by).setDepth(105);
    this._bstCon = c;

    const bg = this.add.graphics();
    this._bstBg = bg;
    c.add(bg);

    // Drag zone — transparent header hit area
    const hdrHit = this.add.rectangle(WW / 2, hdrH / 2, WW, hdrH, 0x000000, 0).setInteractive();
    c.add(hdrHit);
    hdrHit.on('pointerdown', (ptr) => {
      this._bstDrag.active = true;
      this._bstDrag.ox = ptr.worldX - c.x;
      this._bstDrag.oy = ptr.worldY - c.y;
    });

    c.add(this.add.text(8, hdrH / 2, '⚡ БУСТЕРЫ', F('11px', '#ffd54f')).setOrigin(0, 0.5));

    const closeBtn = this.add.text(WW - 8, hdrH / 2, '✕', F('12px', '#557788')).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor('#aaccdd'));
    closeBtn.on('pointerout',  () => closeBtn.setColor('#557788'));
    closeBtn.on('pointerdown', () => {
      this._bstClosed = true;
      this._bstForceOpen = false;
      this._bstSavePos();
      c.setVisible(false);
    });
    c.add(closeBtn);

    this._bstRows = BOOSTER_DEFS.map((def, i) => {
      const ry = hdrH + i * rowH;
      const icon  = this.add.text(8,      ry + rowH / 2, def.icon,  F('12px', def.color)).setOrigin(0, 0.5);
      const label = this.add.text(26,     ry + rowH / 2, def.label, F('10px', '#7a9aaa')).setOrigin(0, 0.5);
      const timer = this.add.text(WW - 8, ry + rowH / 2, '',        O('11px', def.color)).setOrigin(1, 0.5);
      c.add([icon, label, timer]);
      return { key: def.key, icon, label, timer };
    });

    // Пустой ряд — показывается вместо перечня, когда плашку принудительно
    // вызвали (см. _bstToggleBtn), но активных бустеров нет: "всегда можно
    // вызвать и проверить" должно означать именно ПРОВЕРИТЬ (в т.ч. увидеть, что
    // ничего не активно), а не молчаливое отсутствие реакции на клик.
    this._bstEmptyTxt = this.add.text(8, hdrH + rowH / 2, 'нет активных бустеров', F('10px', '#5a7a8a'));
    c.add(this._bstEmptyTxt);

    c.setVisible(false);

    // Постоянная кнопка-раскрывашка — НЕ часть контейнера плашки (тот целиком
    // прячется при !anyActive/_bstClosed), живёт отдельно и видна всегда, иначе
    // закрытую крестиком (или свернувшуюся из-за отсутствия активных бустеров)
    // плашку было решительно нечем открыть обратно, кроме как ждать активации
    // НОВОГО бустера (см. диалог — раньше это был единственный путь).
    const tbSize = 26;
    const tbX = W - tbSize - 10, tbY = 10;
    this._bstToggleBtn = this.add.rectangle(tbX, tbY, tbSize, tbSize, 0x0c1a2e, 0.9)
      .setOrigin(0).setStrokeStyle(1.5, 0xffd54f, 0.7).setInteractive({ useHandCursor: true }).setDepth(106);
    this._bstToggleTxt = this.add.text(tbX + tbSize / 2, tbY + tbSize / 2, '⚡', { fontSize: '14px', resolution: UI_RES }).setOrigin(0.5).setDepth(107);
    this._bstToggleBtn.on('pointerover', () => this._bstToggleBtn.setFillStyle(0x1a2a3e, 0.95));
    this._bstToggleBtn.on('pointerout',  () => this._bstToggleBtn.setFillStyle(0x0c1a2e, 0.9));
    this._bstToggleBtn.on('pointerdown', () => {
      this._bstClosed = false;
      this._bstForceOpen = true;
      this._bstSavePos();
    });
  }

  _bstSavePos() {
    const c = this._bstCon;
    try { localStorage.setItem('sd_booster_win', JSON.stringify({ x: Math.round(c.x), y: Math.round(c.y), closed: this._bstClosed })); } catch {}
  }

  // Бегущая строка вверху экрана — важные ивенты (нашествие/бронепоезд) за 15/5
  // мин до старта, см. GameScene._checkEventNotices. Хорошо читаемый крупный
  // шрифт, умеренная скорость (TICKER_SPEED_PX_PER_SEC), 3 прохода насквозь
  // (repeat:2 = 1 первый + 2 повтора), затем самоуничтожается. Новый вызов во
  // время уже идущей бегущей строки обрывает предыдущую — новый алерт важнее.
  showEventTicker(text) {
    const TICKER_SPEED_PX_PER_SEC = 150;
    this._tickerObjs?.forEach(o => { try { o.destroy(); } catch (_) {} });
    this._tickerTween?.stop();
    const W = this.scale.width;
    const barH = 34;
    const bg = this.add.rectangle(W / 2, barH / 2, W, barH, 0x0a0a14, 0.88)
      .setDepth(400).setScrollFactor(0).setStrokeStyle(1, 0xffd54f, 0.5);
    const txt = this.add.text(W, barH / 2, text, {
      fontFamily: 'Orbitron, sans-serif', fontSize: '18px', color: '#ffd54f', resolution: UI_RES,
    }).setOrigin(0, 0.5).setDepth(401).setScrollFactor(0);
    this._tickerObjs = [bg, txt];
    const distance = W + txt.width;
    const duration = (distance / TICKER_SPEED_PX_PER_SEC) * 1000;
    this._tickerTween = this.tweens.add({
      targets: txt, x: -txt.width, duration, repeat: 2, ease: 'Linear',
      onComplete: () => {
        bg.destroy(); txt.destroy();
        this._tickerObjs = null; this._tickerTween = null;
      },
    });
  }

  // Раньше строило Set (map+filter) и разворачивало его в массив через [...] КАЖДЫЙ
  // кадр безусловно, даже когда нет ни одного активного бустера — 2-3 новых
  // коллекции/сек*60 просто чтобы решить "не открылся ли новый бустер". Тот же вклад
  // в GC-паузы, что и строковые сигнатуры баров (см. profилировку — "пила" JS heap
  // не сходила, пока не убрали ВСЕ такие безусловные аллокации, не только строки).
  _updateBoosterWidget() {
    const now = Date.now();
    const ab  = this.gs.activeBoosters || {};
    if (!this._bstPrevActive) this._bstPrevActive = {};

    let anyActive = false, newlyActivated = false;
    for (const d of BOOSTER_DEFS) {
      const active = (ab[d.key] || 0) > now;
      if (active) anyActive = true;
      if (active && !this._bstPrevActive[d.key]) newlyActivated = true;
      this._bstPrevActive[d.key] = active;
    }

    // Auto-reopen if a new booster was activated while widget was closed
    if (newlyActivated && this._bstClosed) {
      this._bstClosed = false;
      this._bstSavePos();
    }

    const c = this._bstCon;
    // _bstForceOpen — плашку вызвали кнопкой ⚡ (см. _createBoosterWidget) — держим
    // видимой, даже если активных бустеров нет (показываем пустое состояние ниже),
    // до тех пор, пока её явно не закроют крестиком (_bstClosed=true сбрасывает и
    // это). Без forceOpen поведение как раньше: видна только пока anyActive.
    if (this._bstClosed || (!anyActive && !this._bstForceOpen)) { c.setVisible(false); return; }
    c.setVisible(true);

    let visCount = 0;
    for (const row of this._bstRows) {
      const expiry = ab[row.key] || 0;
      const active = expiry > now;
      row.icon.setVisible(active); row.label.setVisible(active); row.timer.setVisible(active);
      if (active) {
        const rem = Math.ceil((expiry - now) / 1000);
        this._setText(row.timer, `${String(Math.floor(rem / 60)).padStart(2, '0')}:${String(rem % 60).padStart(2, '0')}`);
        visCount++;
      }
    }
    this._bstEmptyTxt.setVisible(visCount === 0);

    // Redraw background only when visible row count changes
    if (visCount !== this._bstLastVisCount) {
      this._bstLastVisCount = visCount;
      const WW = this._bstWW, hdrH = this._bstHdrH, rowH = this._bstRowH;
      const totalH = hdrH + (visCount || 1) * rowH;
      this._bstBg.clear();
      this._bstBg.fillStyle(0x060e1a, 0.93); this._bstBg.fillRoundedRect(0, 0, WW, totalH, 6);
      this._bstBg.lineStyle(1, 0x2a5a7a, 0.8); this._bstBg.strokeRoundedRect(0, 0, WW, totalH, 6);
      this._bstBg.lineStyle(1, 0x1a3a50, 0.6); this._bstBg.lineBetween(6, hdrH, WW - 6, hdrH);
    }

    // Drag handling
    if (this._bstDrag?.active) {
      const ptr = this.input.activePointer;
      if (ptr.isDown) {
        const W = this.scale.width, H = this.scale.height;
        c.setPosition(
          Math.max(0, Math.min(W - this._bstWW,   ptr.worldX - this._bstDrag.ox)),
          Math.max(0, Math.min(H - this._bstHdrH, ptr.worldY - this._bstDrag.oy))
        );
      } else {
        this._bstDrag.active = false;
        this._bstSavePos();
      }
    }
  }

  // ── Drag / поведение окон ─────────────────────────────────────────────────

  _initSocialWinDrag() {
    const W = this.scale.width, H = this.scale.height;
    this.input.on('pointermove', (pointer) => {
      if (this._grpWinDrag?.active && pointer.isDown) {
        const nx = Math.max(0, Math.min(W - 260, pointer.x - this._grpWinDrag.ox));
        const ny = Math.max(0, Math.min(H - 32,  pointer.y - this._grpWinDrag.oy));
        this._grpWin?.setPosition(nx, ny);
        this._posGrpInviteInput();
      }
      if (this._frWinDrag?.active && pointer.isDown) {
        const nx = Math.max(0, Math.min(W - 300, pointer.x - this._frWinDrag.ox));
        const ny = Math.max(0, Math.min(H - 32,  pointer.y - this._frWinDrag.oy));
        this._frWin?.setPosition(nx, ny);
      }
      if (this._socialBtnDrag?.active && pointer.isDown) {
        const barW = this._socialBarW ?? 68, barH = this._socialBarH ?? 24;
        const nx = Math.max(0, Math.min(W - barW, pointer.x - this._socialBtnDrag.ox));
        const ny = Math.max(0, Math.min(H - barH, pointer.y - this._socialBtnDrag.oy));
        if (Math.abs(nx - this._socialBtnC.x) > 3 || Math.abs(ny - this._socialBtnC.y) > 3)
          this._socialBtnDrag.moved = true;
        this._socialBtnC?.setPosition(nx, ny);
      }
    });
    this.input.on('pointerup', () => {
      if (this._grpWinDrag?.active) {
        this._grpWinDrag.active = false;
        const s = loadSettings();
        s.grpWinX = Math.round(this._grpWin.x);
        s.grpWinY = Math.round(this._grpWin.y);
        saveSettings(s);
      }
      if (this._frWinDrag?.active) {
        this._frWinDrag.active = false;
        const s = loadSettings();
        s.frWinX = Math.round(this._frWin.x);
        s.frWinY = Math.round(this._frWin.y);
        saveSettings(s);
      }
      if (this._socialBtnDrag?.active) {
        this._socialBtnDrag.active = false;
        if (this._socialBtnDrag.moved) {
          try {
            localStorage.setItem('sd_social_btns', JSON.stringify({
              x: Math.round(this._socialBtnC.x),
              y: Math.round(this._socialBtnC.y),
              orient: this._socialOrient ?? 'h',
            }));
          } catch {}
        } else {
          // Клик по ручке БЕЗ перетаскивания — переключить ориентацию ряда (правка по
          // просьбе: "сделай возможность кнопки и по вертикали и по горизонтали").
          this._rebuildSocialButtons(this._socialOrient === 'v' ? 'h' : 'v', true);
        }
      }
    });
  }
}
