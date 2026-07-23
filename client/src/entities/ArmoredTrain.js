import * as Phaser from 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.esm.js';
import { BASE_CONFIG, pvpTierMult, CORP_ASSETS, TURRET_ORIGIN } from '../bases.js';
import {
  MOBS, ARMORED_TRAIN_SECTORS, ARMORED_TRAIN_HEAD_MULT, ARMORED_TRAIN_WAGON_COUNT,
  ARMORED_TRAIN_WINDOW_MS, ARMORED_TRAIN_DRONE_WAVE_SIZE, ARMORED_TRAIN_HEAD_PHASES,
  ARMORED_TRAIN_WAGON_DAMAGED_AT, TURRET_REWARD,
} from '../constants.js';
import Mob, { applySeparation } from './Mob.js';
import { prerenderTex } from '../utils/prerenderTex.js';

/**
 * ArmoredTrain — раз в сутки на PvP-секторе (детерминированное wall-clock время,
 * тот же паттерн, что "нашествие" — см. GameScene._worldEventHash), проезжает сектор
 * насквозь за ARMORED_TRAIN_WINDOW_MS. 5 вагонов + голова, бьются СТРОГО с хвоста
 * (сервер — ArmoredTrainManager в main.py — авторитетен для порядка, здесь только
 * визуал/локальный gate повторяет то же самое для консистентного UX). Награда КАЖДОГО
 * вагона выплачивается независимо по факту его уничтожения (не только за весь поезд) —
 * топ-5 по урону делят пропорционально (см. _split_reward_top5 на сервере).
 *
 * Вагон реализован как лёгкий боевой прокси (см. TurretTarget в MiningBase.js для
 * идентичного паттерна) — НЕ полноценный Mob: x/y/hull/maxHull/shield/maxShield/alive/
 * pvpMobId этого достаточно, чтобы GameScene._fireCannon/_fireLaser/_onPvpMobHitResult
 * автоматически заработали без отдельного боевого кода (см. `if (t.pvpMobId)` в
 * _fireCannon) — нужны только клик-таргетинг (GameScene.trainWagonAt) и killed-ветка.
 *
 * Арт: client/assets/train/ (train1_1/2 — вагон 2 состояния, train2_1/2/3 — голова
 * 3 состояния, cable.png — трос). Все текстуры — портретные PNG (носом вниз, как и
 * остальной арт в игре — см. ART_ANGLE_OFFSET конвенцию), fit по высоте (аналог
 * MiningBase._fitSize), ширина считается из РЕАЛЬНОГО aspect ratio, не растягивается.
 */

const WAGON_TURRET_COUNT = 4;
// Размер вагона считается ОТ размера турели, а не наоборот (турели — те же ассеты и
// тот же BASE_CONFIG.turretSize=84px, что на нейтральной базе, см. _buildWagonVisual).
// Запечённое в арт октагональное турельное гнездо (train1_*/train2_*.png, 2×2 сетка)
// занимает ~10% высоты видимого корпуса (измерено по PNG: ~150px из ~1490px контента) —
// чтобы турель того же ассета физически легла в это гнездо 1:1, а не осталась мелкой
// точкой на фоне гигантского корпуса, вагон должен быть ~840px по высоте (84 / 0.10).
// let (не const) — измерение по PNG приблизительное, точную цифру удобнее подогнать
// вживую хоткеями DEV '[' / ']' (см. GameScene — ArmoredTrain.rescale()), а не гадать
// новое число, менять здесь и перезапускать сектор на каждую попытку.
// Финальные цифры — из живой DEV-калибровки (','/'.' + 'L', см. GameScene) 2026-07-13,
// не расчёт/угадывание.
export let WAGON_TARGET_LEN = 609; // fit-height цель для обычного вагона (train1_*.png)
export let HEAD_TARGET_LEN  = 609; // одинаковый масштаб с вагоном
// Между центрами соседних вагонов вдоль пути — раздвинуто хоткеями ';'/'\'' (adjustGap)
// 2026-07-13 под итоговую длину тросов (зазор край-в-край = 690-609 = 81px).
export let WAGON_GAP = 690;
// Прочность обычного вагона (прямая правка 2026-07-13) — фиксированная, не завязана на
// pvpTierMult/BASE_CONFIG базы (см. ArmoredTrainWagon constructor). Голова — ×2.5.
const WAGON_HULL = 150000;
const WAGON_SHIELD = 150000;

// cable.png — портретный канвас 1024×1536, сам светящийся трос — горизонтальная
// полоса шириной ~952px внутри этого канваса (см. проверку alpha-порогом при
// интеграции ассета). CABLE_SCALE_TO_CONTENT переводит "сколько должен быть виден
// трос" в "какой displayWidth задать всему канвасу", CABLE_ASPECT сохраняет
// пропорции канваса при масштабировании.
const CABLE_CONTENT_W = 952, CABLE_FULL_W = 1024, CABLE_FULL_H = 1536;
const CABLE_SCALE_TO_CONTENT = CABLE_FULL_W / CABLE_CONTENT_W;
const CABLE_ASPECT = CABLE_FULL_H / CABLE_FULL_W;
// Прямая правка (2026-07-13, схема с красными линиями от пользователя): ПАРА тросов на
// стык, не один по центру — из симметричных "утолщений"-креплений на арте (видны на
// train1_*/train2_*.png по обе стороны от центральной оси), не из геометрического
// центра сегмента. TETHER_L_FRAC/TETHER_R_FRAC — офсет левого/правого троса от оси
// (доля dispW сегмента) — ОТДЕЛЬНЫЕ (не зеркало одного числа), каждый трос двигается
// независимо. TETHER_LENGTH_MULT растягивает трос длиннее реального зазора между
// сегментами (стилизация, не физический стык — тот же приём, что и пульсация alpha
// ниже, канат не обязан быть физически точным). TETHER_THICKNESS_MULT — толще, чем
// нативная пропорция. let (не const) — калибруются вживую (перетаскивание троса мышью,
// хоткеи в GameScene — см. ArmoredTrain.adjustTetherLength); экспорт — для дампа по 'L'.
// TETHER_L_FRAC/TETHER_R_FRAC — из живой калибровки мышью 2026-07-13 (при
// WAGON_TARGET_LEN=HEAD_TARGET_LEN=609). TETHER_LENGTH_MULT подогнан под итоговый
// WAGON_GAP=690 (зазор край-в-край 81px) — было 3 (×243px, многовато при таком зазоре,
// трос глубоко влезал бы в оба соседних корпуса), снижено до 1.8 (×~146px, ~24% длины
// сегмента) — заметный "провисающий" трос, не протыкающий вагоны насквозь. Живая
// подгонка — хоткеи '-'/'=' в GameScene.
export let TETHER_L_FRAC = -0.11330645185762693;
export let TETHER_R_FRAC = 0.1798865086773164;
export let TETHER_LENGTH_MULT = 1.8;
const TETHER_THICKNESS_MULT = 2;

// 2×2-сетка турельных сокетов, запечённых в арт — доли от dispW/dispLen сегмента,
// локальные (до поворота спрайта, см. _wagonRot). ОТДЕЛЬНЫЕ массивы для вагона
// (train1_*.png) и головы (train2_*.png) — разные текстуры, разная компоновка сокетов,
// раньше был один общий массив на оба и калибровка одного двигала турели другого.
// export — нужен GameScene DEV-хоткею 'L' для дампа после ручной калибровки (см.
// _makeTurretSprite/_turretOffsetsFor).
// Финальные цифры — из живой DEV-калибровки (перетаскивание турелей мышью + 'L',
// см. GameScene) 2026-07-13, при WAGON_TARGET_LEN=HEAD_TARGET_LEN=615.
export const WAGON_TURRET_OFFSETS = [
  { lx: -0.08528850098878656, ly: -0.14157300115078117 },
  { lx:  0.08847222582697627, ly: -0.14369037786504635 },
  { lx: -0.09249405872981767, ly:  0.15842284684843194 },
  { lx:  0.0851592392503971,  ly:  0.16271732277017478 },
];
export const HEAD_TURRET_OFFSETS = [
  { lx: -0.0787553157021459,  ly: -0.1673200958846929 },
  { lx:  0.06882003212721294, ly: -0.17261122191795142 },
  { lx: -0.0757793226739378,  ly:  0.04619688066831848 },
  { lx:  0.06951063671573943, ly:  0.04756680329872318 },
];

function fitSize(scene, textureKey, targetH) {
  const src = scene.textures.get(textureKey)?.getSourceImage();
  if (!src?.width) return { w: targetH, h: targetH };
  return { w: Math.round(targetH * src.width / src.height), h: targetH };
}

// Турель поезда — независимая от вагона боевая цель (тот же паттерн, что TurretTarget
// в MiningBase.js): свой hull/shield/pvpMobId, killable без уничтожения самого вагона.
// x/y обновляет ArmoredTrain._updateTurrets() каждый кадр (та же позиция, что и визуал
// турели) — считать их тут самостоятельно (без ссылки на текущий player-target) незачем.
class TrainTurretTarget {
  constructor(wagon, idx) {
    this.wagon = wagon;
    this.idx = idx;
    this.isTrainTurretTarget = true;

    // Головной вагон — турели "2-го уровня" (cannon2 — вдвое прочнее cannon1 в
    // BASE_CONFIG, см. bases.js), обычные вагоны — cannon1, как и раньше.
    const mult = pvpTierMult(wagon.train.tier);
    const wKey = wagon.isHead ? 'cannon2' : 'cannon1';
    this.maxHull   = BASE_CONFIG.turretHullMax[wKey]   * mult;
    this.maxShield = BASE_CONFIG.turretShieldMax[wKey] * mult;
    this.hull   = this.maxHull;
    this.shield = this.maxShield;
    this.lastDamageAt = -1e9;
    this.alive = true;
    this.x = 0; this.y = 0;
  }

  // НЕ 'neutral' (было раньше) — GameScene._fireCannon/_fireLaser гейтят дружественный
  // огонь как `t.corp && t.corp === this.playerCorp`: строка 'neutral' — правдива, так что
  // ЛЮБОЙ игрок с playerCorp==='neutral' (обычное валидное состояние, не только у ботов)
  // читался как "своя база", и выстрелы по турели молча блокировались "Нельзя атаковать
  // свою базу" — для ВСЕХ его выстрелов, любым оружием. Вагон (см. ArmoredTrainWagon) не
  // имеет .corp вообще — undefined безопасно проваливает эту проверку в false, что и
  // нужно турели тоже (нейтральный ивент-объект атакуем для любого корпуса игрока).
  get corp() { return null; }
  // train._inBounds — маршрут поезда НАРОЧНО тянется за пределы worldWidth/worldHeight
  // на въезде/выезде (EDGE_BUFFER, см. ArmoredTrain constructor) — турель там физически
  // не видна и не должна ни стрелять (см. ArmoredTrain._updateTurrets), ни принимать
  // урон (баг из диалога: "если турели за границами карты - не стрелять в игроков,
  // игрокам тоже запретить наносить урон"). x/y обновляются каждый кадр в _updateTurrets.
  get canBeAttacked() { return this.alive && this.wagon.alive && this.wagon.train._inBounds(this.x, this.y); }
  // Часть 6 (не 4, как у самого вагона) — сервер гейтит "бить строго с хвоста" только
  // 4-частные id (см. main.py pvp_mob_fire_claim), турели вне этой очереди, как и дроны.
  get pvpMobId() { return `${this.wagon.pvpMobId}:turret:${this.idx}`; }
  // Небольшая награда за уничтожение турели поезда (см. TURRET_REWARD в constants.js) —
  // читается GameScene тем же generic-путём, что и у самого вагона (см. mobFireClaim,
  // GameScene.js: `t.wagonReward`) — раньше турель этого геттера не имела вообще, урон
  // доходил до сервера, но killed-ветка никого не награждала (баг из диалога).
  get wagonReward() { return TURRET_REWARD[this.wagon.train.tier] ?? TURRET_REWARD[1]; }

  // Локальный фоллбэк без сервера — см. GameScene._localPvpFireResolve. В обычной игре
  // урон турели идёт через сервер (mobFireClaim), это не вызывается.
  takeDamage(damage) {
    if (!this.canBeAttacked) return { hullHit: 0, shieldHit: 0, killed: false };
    this.lastDamageAt = Date.now();
    let dmg = Math.round(damage);
    let shieldHit = 0;
    if (this.shield > 0) { shieldHit = Math.min(dmg, this.shield); this.shield -= shieldHit; dmg -= shieldHit; }
    const hullHit = Math.min(dmg, this.hull);
    this.hull -= hullHit;
    const killed = this.hull <= 0;
    if (killed) { this.alive = false; this.wagon.onTurretDestroyed(this.idx); }
    return { hullHit, shieldHit, killed };
  }
}

// Центральная ротационная турель головы — "вырастает" в опустевшем гнезде между 4
// турелями головы, ТОЛЬКО когда все 4 уже уничтожены (см. ArmoredTrain._spawnHeadCoreTurret,
// диалог: "ротационная многонаправленная турель, вырастает из места посередине между
// турелями"). Отдельная от TrainTurretTarget цель (не входит в wagon.turrets[4] — тот
// массив жёстко индексирован под 4 сокета _updateTurrets), но помечена
// isTrainTurretTarget=true, чтобы бесплатно подхватить ВЕСЬ существующий боевой пайплайн
// GameScene (клик-таргетинг/канон-урон/DEV-фоллбэк/награда) без отдельных веток под неё.
class TrainCoreTurret {
  constructor(wagon) {
    this.wagon = wagon;
    this.isTrainTurretTarget = true;
    this.isTrainCoreTurret = true; // отличить от обычной турели там, где это важно (арт/лог)

    const mult = pvpTierMult(wagon.train.tier);
    // Прочнее обычной турели головы (cannon2 ×4) — это "последний рубеж", а не рядовой
    // сокет (прямая правка по просьбе — было ×1.5, мало для финальной структуры).
    this.maxHull   = BASE_CONFIG.turretHullMax.cannon2   * mult * 4;
    this.maxShield = BASE_CONFIG.turretShieldMax.cannon2 * mult * 4;
    this.hull   = this.maxHull;
    this.shield = this.maxShield;
    this.lastDamageAt = -1e9;
    this.alive = true;
    this._fireCd = 3; // первый залп чуть раньше полного 5с — сразу читается как новая угроза
    // Между ЗАДНЕЙ парой турельных сокетов головы (HEAD_TURRET_OFFSETS[2]/[3] —
    // rear-left/rear-right), не в центре вагона и не сдвигом вперёд (обе предыдущие
    // попытки: сперва совпадала с вагоном, потом отрывалась сбоку в пустоту — см.
    // скриншоты из диалога). Правка по последнему скриншоту с разметкой: "перенеси
    // ротационную турель сюда, ближе к задней части" — та же локальная система
    // координат и формула поворота, что и у самих турельных сокетов (_updateTurrets).
    this._localLx = 0;
    this._localLy = (HEAD_TURRET_OFFSETS[2].ly + HEAD_TURRET_OFFSETS[3].ly) / 2;
  }

  get x() {
    const rot = this.wagon.train._wagonRot(this.wagon);
    const lx = this._localLx * this.wagon.dispW, ly = this._localLy * this.wagon.dispLen;
    return this.wagon.x + lx * Math.cos(rot) - ly * Math.sin(rot);
  }
  get y() {
    const rot = this.wagon.train._wagonRot(this.wagon);
    const lx = this._localLx * this.wagon.dispW, ly = this._localLy * this.wagon.dispLen;
    return this.wagon.y + lx * Math.sin(rot) + ly * Math.cos(rot);
  }
  get corp() { return null; } // см. TrainTurretTarget.corp выше — тот же контракт
  get canBeAttacked() { return this.alive && this.wagon.alive && this.wagon.train._inBounds(this.x, this.y); }
  get pvpMobId() { return `${this.wagon.pvpMobId}:core`; }
  // ×4 обычной турельной награды (прямая правка по просьбе, тот же множитель, что и у
  // прочности выше) — это финальная структура, а не рядовая турель.
  get wagonReward() {
    const base = TURRET_REWARD[this.wagon.train.tier] ?? TURRET_REWARD[1];
    return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, Math.round(v * 4)]));
  }

  // Локальный фоллбэк без сервера — см. TrainTurretTarget.takeDamage (тот же контракт).
  takeDamage(damage) {
    if (!this.canBeAttacked) return { hullHit: 0, shieldHit: 0, killed: false };
    this.lastDamageAt = Date.now();
    let dmg = Math.round(damage);
    let shieldHit = 0;
    if (this.shield > 0) { shieldHit = Math.min(dmg, this.shield); this.shield -= shieldHit; dmg -= shieldHit; }
    const hullHit = Math.min(dmg, this.hull);
    this.hull -= hullHit;
    const killed = this.hull <= 0;
    if (killed) { this.alive = false; this.wagon.train._onCoreTurretDestroyed(); }
    return { hullHit, shieldHit, killed };
  }
}

class ArmoredTrainWagon {
  constructor(train, idx, isHead) {
    this.train = train;
    this.idx = idx;                // 0..4 хвост→ближе к голове, ARMORED_TRAIN_WAGON_COUNT(5) = голова
    this.isHead = isHead;
    this.isArmoredTrainWagon = true;

    // Прочность вагона — теперь тирована по pvpTierMult (тот же коэффициент, что у баз
    // и турелей поезда, см. bases.js): WAGON_HULL/WAGON_SHIELD — референс для tier 4/5
    // (mult=1.0), тир 1-3 пропорционально слабее. Раньше было зафиксировано без тира по
    // сектору намеренно (см. историю) — пересмотрено по прямой просьбе (диалог).
    const wMult = pvpTierMult(this.train.tier);
    this.maxHull   = (isHead ? WAGON_HULL   * 2.5 : WAGON_HULL)   * wMult;
    this.maxShield = (isHead ? WAGON_SHIELD * 2.5 : WAGON_SHIELD) * wMult;
    this.hull = this.maxHull;
    this.shield = this.maxShield;
    this.alive = true;
    this.lastDamageAt = -1e9;
    this.x = 0; this.y = 0;
    this.hpState = 0; // 0=целый, 1=полуразрушен(обычн.)/частично(голова), 2=разрушен-70%(только голова)
    this._turretCooldowns = new Array(WAGON_TURRET_COUNT).fill(0);
    // Турели — независимые цели (см. TrainTurretTarget) вдобавок к боевому пулу самого
    // вагона: убить их можно ПОРОЗНЬ, не разрушая вагон (тот же контракт, что у базы).
    this.turrets = Array.from({ length: WAGON_TURRET_COUNT }, (_, i) => new TrainTurretTarget(this, i));
    // Сервер-авторитетный таргетинг (План Фаза 3) — без ownerCorp: поезд нейтральная
    // угроза, бьёт любого присутствующего в комнате, не только вражеские корпуса
    // (в отличие от турелей баз, см. MiningBase._createVisuals).
    if (train.scene._realtimeRoomKey) {
      for (const tt of this.turrets) train.scene.pvpClient?.registerMob(tt.pvpMobId);
    }
    this.dispW = isHead ? HEAD_TARGET_LEN * 0.78 : WAGON_TARGET_LEN * 0.68; // уточнится в _buildWagonVisual
    this.dispLen = isHead ? HEAD_TARGET_LEN : WAGON_TARGET_LEN;

    this.sprite = null; this._turretSprites = null;
  }

  // Турель уничтожена индивидуально — освобождаем визуальный слот, сам вагон не трогаем
  // (в отличие от onWagonDestroyed на ArmoredTrain, который сносит весь вагон).
  onTurretDestroyed(idx) {
    // x/y — из TrainTurretTarget (обновляются каждый кадр в _updateTurrets), берём ДО
    // destroy() спрайта. Раньше турель просто исчезала без VFX (баг из диалога:
    // "отсутствует анимация взрыва турели") — та же explosion(), что у вагона/обычного моба.
    const tt = this.turrets[idx];
    this.train.scene.explosion?.(tt.x, tt.y, 0.6);
    this._turretSprites?.[idx]?.destroy();
    if (this._turretSprites) this._turretSprites[idx] = null;
    this.train.scene.log?.(`Турель бронепоезда уничтожена (вагон ${this.idx + 1})`);

    // Все 4 турели вагона мертвы — вагон "оголён", получает ракетный бортовой залп
    // взамен (диалог: "после уничтожения турелей - ракетный залп с бортов"). Решение
    // "когда стрелять" теперь полностью серверное (см. ArmoredTrainManager.arm_missiles
    // в server/main.py, включая 4с задержку перед первым залпом) — здесь только визуал
    // (playMissileVolleyVfx), см. GameScene._onTrainWeaponFire.
    if (!this.turretsGone && this.turrets.every(t => !t.alive)) {
      this.turretsGone = true;
      if (this.isHead) this.train._spawnHeadCoreTurret(this);
    }
  }

  // pvpMobId детерминирован (sector:startAt:idx) — все клиенты, атакующие один и тот
  // же вагон, независимо приходят к одному mobId без отдельного протокола регистрации
  // (тот же трюк, что у мобов нашествия — см. GameScene._spawnWorldEventWave).
  get pvpMobId() { return `train:${this.train.sectorKey}:${this.train.startAt}:${this.idx}`; }
  get wagonReward() { return this.isHead ? this.train.headRewardPool : this.train.wagonRewardPool; }
  // Строго с хвоста — зеркалит ArmoredTrainManager.is_vulnerable на сервере (main.py):
  // вагон уязвим, только когда ВСЕ вагоны с меньшим idx уже уничтожены. Раньше тут был
  // просто `this.alive` — клиент давал прицелиться/стрелять по любому живому вагону,
  // сервер молча дропал заявку без объяснений (см. GameScene click-handler — там теперь
  // явное сообщение, когда canBeAttacked==false у ещё живого вагона).
  get canBeAttacked() {
    if (!this.alive) return false;
    return this.train.wagons.every(w => w.idx >= this.idx || !w.alive);
  }

  _texForState() {
    if (this.isHead) return ['train_head_1', 'train_head_2', 'train_head_3'][this.hpState] ?? 'train_head_3';
    return ['train_wagon_1', 'train_wagon_2'][this.hpState] ?? 'train_wagon_2';
  }

  // DEV-фоллбэк без сервера (см. GameScene._localPvpFireResolve) — тот же контракт,
  // что TurretTarget.takeDamage в MiningBase.js: shield поглощает первым, возвращает
  // {hullHit, shieldHit, killed}. В обычной игре урон по вагону ВСЕГДА идёт через
  // сервер (mobFireClaim), это не вызывается.
  takeDamage(damage) {
    if (!this.canBeAttacked) return { hullHit: 0, shieldHit: 0, killed: false };
    this.lastDamageAt = Date.now();
    let dmg = Math.round(damage);
    let shieldHit = 0;
    if (this.shield > 0) {
      shieldHit = Math.min(dmg, this.shield);
      this.shield -= shieldHit;
      dmg -= shieldHit;
    }
    const hullHit = Math.min(dmg, this.hull);
    this.hull -= hullHit;
    const killed = this.hull <= 0;
    return { hullHit, shieldHit, killed };
  }

  _updateHpState() {
    const frac = this.maxHull > 0 ? (this.hull + this.shield) / (this.maxHull + this.maxShield) : 0;
    if (this.isHead) {
      const [p1, p2] = ARMORED_TRAIN_HEAD_PHASES;
      const next = frac <= p2 ? 2 : frac <= p1 ? 1 : 0;
      if (next > this.hpState) { this.hpState = next; this._refreshVisual(); this.train._onHeadPhase(next); }
    } else if (frac <= ARMORED_TRAIN_WAGON_DAMAGED_AT && this.hpState === 0) {
      this.hpState = 1;
      this._refreshVisual();
    }
  }

  _refreshVisual() {
    if (!this.sprite) return;
    const texKey = this._texForState();
    const targetLen = this.isHead ? HEAD_TARGET_LEN : WAGON_TARGET_LEN;
    const { w, h } = fitSize(this.train.scene, texKey, targetLen);
    this.sprite.setTexture(texKey).setDisplaySize(w, h);
    this.dispW = w; this.dispLen = h;
  }

  destroyVisuals() {
    this.sprite?.destroy(); this.sprite = null;
    this._turretSprites?.forEach(s => s?.destroy()); this._turretSprites = null;
  }
}

export default class ArmoredTrain {
  constructor(scene, sectorKey, startAt) {
    this.scene = scene;
    this.sectorKey = sectorKey;
    this.startAt = startAt;
    this.tier = parseInt(sectorKey.split('_').pop(), 10) || 1;
    this.cfg = ARMORED_TRAIN_SECTORS[sectorKey];
    this.wagonRewardPool = { ...this.cfg.wagonReward, ...this.cfg.clanRes };
    this.headRewardPool = this._scaleHeadPool();
    this.destroyedCount = 0;
    this.finished = false;
    // DEV: заморозка движения — пока калибруем масштаб/турели ('[' / ']' и т.п.), поезд
    // ползущий по маршруту только мешает целиться на глаз. GameScene DEV-хоткей T
    // включает это сразу при спавне; см. update() — при frozen позиция просто не
    // пересчитывается каждый кадр, остальное (турели/бары/тросы) как обычно.
    this.frozen = false;

    // Маршрут: прямая линия через мир сектора, вход/направление — детерминированы
    // ТЕМ ЖЕ хэшем, что и у нашествия (GameScene._worldEventHash), поэтому у всех
    // клиентов идентичный путь без отдельного протокола синхронизации позиции.
    const h = scene._worldEventHash(`train:${sectorKey}:${startAt}:path`);
    const cx = scene.worldWidth / 2, cy = scene.worldHeight / 2;
    this.heading = (h % 360) * Math.PI / 180;
    const cosH = Math.cos(this.heading), sinH = Math.sin(this.heading);
    // R раньше был фиксированным max(worldWidth,worldHeight)*0.6 — ОДИНАКОВЫМ для любого
    // heading. Сектора не квадратные (ширина обычно ощутимо больше высоты), так что для
    // heading, близкого к вертикали, этот R (посчитанный по широкой стороне) улетал далеко
    // за пределы короткой стороны — поезд стартовал/ехал далеко за границей видимой карты.
    // Вместо этого — реальная точка выхода луча из прямоугольника сектора (стандартный
    // ray-box из центра) + фиксированный буфер, чтобы въезд/выезд были ЧУТЬ за кромкой
    // карты, а не на неопределённом расстоянии, зависящем от heading.
    const hw = scene.worldWidth / 2, hh = scene.worldHeight / 2;
    const EDGE_BUFFER = 1200;
    const tExit = Math.min(
      Math.abs(cosH) > 1e-6 ? hw / Math.abs(cosH) : Infinity,
      Math.abs(sinH) > 1e-6 ? hh / Math.abs(sinH) : Infinity,
    );
    const R = tExit + EDGE_BUFFER;
    this.startPos = { x: cx - cosH * R, y: cy - sinH * R };
    this.endPos   = { x: cx + cosH * R, y: cy + sinH * R };
    this._dirX = cosH; this._dirY = sinH;
    // Точки, где ПРЯМАЯ маршрута реально пересекает границу сектора (без EDGE_BUFFER) —
    // нужны миникарте (HudScene.drawMinimap), чтобы не рисовать поезд/маршрут далеко за
    // пределами своего же прямоугольника, а только стрелку "откуда въедет" на кромке.
    this.mapEnterPos = { x: cx - cosH * tExit, y: cy - sinH * tExit };
    this.mapExitPos  = { x: cx + cosH * tExit, y: cy + sinH * tExit };

    // Прямая правка: вдвое быстрее, ПОКА поезд ещё не виден на карте (approach/exit —
    // чистое ожидание за EDGE_BUFFER), затем медленнее ("cruise") — реальное время
    // пролёта ВИДИМОЙ части карты (mapEnterPos→mapExitPos) держится РОВНО
    // ARMORED_TRAIN_WINDOW_MS независимо от heading/геометрии сектора (раньше вся прямая,
    // включая обе заграничные буферные зоны, шла с одной постоянной скоростью — время на
    // самой карте плавало вместе с длиной буферов, ничем не гарантированное "не менее").
    const cruiseDist = 2 * tExit;
    const cruiseMs = ARMORED_TRAIN_WINDOW_MS;
    const cruiseSpeed = cruiseDist / cruiseMs; // px/ms
    const approachMs = EDGE_BUFFER / (cruiseSpeed * 2);
    this._approachMs = approachMs;
    this._cruiseMs = cruiseMs;
    this._exitMs = approachMs; // симметрично — тот же ускоренный темп на выходе с карты
    this._pEnter = EDGE_BUFFER / (2 * R);
    this._pExit = 1 - this._pEnter;
    this._totalMs = approachMs + cruiseMs + approachMs;

    this.wagons = [];
    for (let i = 0; i < ARMORED_TRAIN_WAGON_COUNT; i++) this.wagons.push(new ArmoredTrainWagon(this, i, false));
    this.head = new ArmoredTrainWagon(this, ARMORED_TRAIN_WAGON_COUNT, true);
    this.wagons.push(this.head);

    this._tetherPhase = 0;
    this._tetherSprites = [];
    // Ракетный бортовой залп оголённых вагонов (см. ArmoredTrainWagon.onTurretDestroyed,
    // playMissileVolleyVfx/_updateMissiles) — визуал/самонаведение скопированы с
    // ArgusController._activateMissiles/_updateMissiles (диалог: "анимация ракеты как у
    // аргуса"). Server-authoritative: сервер решает залп/урон (server _fire_train_missiles),
    // клиент здесь только рисует полёт по broadcast'у (см. GameScene._onTrainWeaponFire).
    this._missiles = [];
    this._missileGfx = null;
    for (const w of this.wagons) this._buildWagonVisual(w);
    this._positionAll(0);
  }

  // DEV: ручная калибровка общего размера поезда вживую (хоткеи '[' / ']' в GameScene) —
  // WAGON_TARGET_LEN/HEAD_TARGET_LEN/WAGON_GAP выведены из измерения PNG на глаз
  // (см. комментарий у объявления), точную цифру удобнее подогнать в реальной игре,
  // не гадая новое число и не перезаходя в сектор на каждую попытку. Масштабирует ВСЕ
  // три величины одним и тем же mult, чтобы турельные гнёзда/зазор под трос сохраняли
  // пропорции корпуса. Пересобирает визуал (спрайт+турели+бары) каждого сегмента —
  // дешёво, вызывается по хоткею, не каждый кадр.
  rescale(mult) {
    // Держим ТЕКУЩУЮ позицию головы, не пересчитываем по this.progress — progress идёт
    // от реального wall-clock времени независимо от frozen (см. update()), и почти сразу
    // после спавна указывает на позицию у startPos (за границей карты, см. конструктор).
    // Калибровочный спавн (GameScene keydown-T) ставит голову к игроку вручную
    // (_positionAllAt) — пересчёт по progress отбросил бы это и утащил поезд обратно на
    // реальный маршрут, визуально "поезд пропал" (на самом деле уехал за карту).
    const headX = this.head.x, headY = this.head.y;
    WAGON_TARGET_LEN = Math.max(20, Math.round(WAGON_TARGET_LEN * mult));
    HEAD_TARGET_LEN  = Math.max(20, Math.round(HEAD_TARGET_LEN  * mult));
    WAGON_GAP        = Math.max(20, Math.round(WAGON_GAP        * mult));
    for (const w of this.wagons) {
      w.destroyVisuals();
      this._buildWagonVisual(w);
    }
    this._positionAllAt(headX, headY);
  }

  // DEV: расстояние между вагонами отдельно от общего масштаба (rescale трогает и
  // WAGON_GAP тоже, пропорционально размеру сегментов) — раздвинуть/сдвинуть стыки, не
  // трогая сами вагоны. Держим текущую позицию головы (см. rescale — та же причина).
  adjustGap(mult) {
    const headX = this.head.x, headY = this.head.y;
    WAGON_GAP = Math.max(20, Math.round(WAGON_GAP * mult));
    this._positionAllAt(headX, headY);
  }

  // DEV: длина троса (TETHER_LENGTH_MULT) — растяжение сверх реального зазора между
  // сегментами (стилизация, см. объявление константы), подгоняется отдельно от
  // расстояния между вагонами (adjustGap) — увеличив зазор, трос надо удлинить, чтобы
  // не остался коротким на новом расстоянии.
  adjustTetherLength(mult) {
    TETHER_LENGTH_MULT = Math.max(0.2, TETHER_LENGTH_MULT * mult);
    this._updateTetherSprites();
  }

  _scaleHeadPool() {
    const out = {};
    for (const [k, v] of Object.entries(this.cfg.wagonReward)) out[k] = Math.round(v * ARMORED_TRAIN_HEAD_MULT);
    for (const [k, v] of Object.entries(this.cfg.clanRes)) out[k] = Math.round(v * ARMORED_TRAIN_HEAD_MULT);
    return out;
  }

  // Вагон и голова — РАЗНЫЕ текстуры (train1_*/train2_*.png) с разной компоновкой
  // запечённых сокетов, поэтому у каждого СВОЙ массив офсетов (см. объявление выше) —
  // раньше был один общий на оба, калибровка одного двигала турели другого.
  _turretOffsetsFor(w) { return w.isHead ? HEAD_TURRET_OFFSETS : WAGON_TURRET_OFFSETS; }

  _buildWagonVisual(w) {
    const texKey = w._texForState();
    const targetLen = w.isHead ? HEAD_TARGET_LEN : WAGON_TARGET_LEN;
    const { w: dispW, h: dispH } = fitSize(this.scene, texKey, targetLen);
    w.sprite = this.scene.add.image(0, 0, texKey).setDisplaySize(dispW, dispH).setDepth(40);
    w.dispW = dispW; w.dispLen = dispH;
    w._turretSprites = this._turretOffsetsFor(w).map((off, i) => this._makeTurretSprite(w, i));
  }

  // Турели поезда — РЕАЛЬНЫЙ ассет и размер, тот же, что на нейтральной базе
  // (CORP_ASSETS.neutral.cannon1, BASE_CONFIG.turretSize=84px, TURRET_ORIGIN — якорь по
  // основанию ствола, см. bases.js) — раньше это была схематичная точка graphics.fillCircle,
  // не настоящая турель. См. также вывод WAGON_TARGET_LEN выше — размер вагона посчитан
  // ОТ этого размера турели, чтобы она физически легла в запечённое в арт гнездо.
  _makeTurretSprite(wagon, idx) {
    const assets = CORP_ASSETS.neutral;
    const { w: tw, h: th } = fitSize(this.scene, assets.cannon1, BASE_CONFIG.turretSize);
    const key = prerenderTex(this.scene, assets.cannon1, tw * 2, th * 2);
    const oy = TURRET_ORIGIN.neutral?.cannon1 ?? 0.5;
    const spr = this.scene.add.image(0, 0, key).setDisplaySize(tw, th).setOrigin(0.5, oy).setDepth(41);
    /* DEV: перетаскивание турели мышью для калибровки TURRET_OFFSETS — временно отключено
       по просьбе (T теперь просто полноценно запускает поезд, без калибровки).
       Раскомментировать для следующей калибровочной сессии.
    if (this.scene.devMode) {
      spr.setInteractive({ useHandCursor: true });
      this.scene.input.setDraggable(spr, true);
      spr.on('drag', (pointer, dragX, dragY) => {
        const rot = this._wagonRot(wagon);
        const cosR = Math.cos(rot), sinR = Math.sin(rot);
        const dx = dragX - wagon.x, dy = dragY - wagon.y;
        const lx = dx * cosR + dy * sinR;
        const ly = -dx * sinR + dy * cosR;
        this._turretOffsetsFor(wagon)[idx] = { lx: lx / wagon.dispW, ly: ly / wagon.dispLen };
      });
    }
    */
    return spr;
  }

  // Спрайты рисуются "носом вниз" (train_head_*/train_wagon_* — та же конвенция, что и
  // остальной арт, см. ART_ANGLE_OFFSET), heading + π/2 разворачивает нос по направлению
  // движения — ВЕРНО для обычных вагонов (симметричны, направление не читается визуально).
  // Голова (train_head_*) асимметрична: широкий "кабинный" торец с раструбами — перед
  // локомотива, зауженный конец внизу канваса — состыковка с тросом/вагонами позади.
  // Общая формула сажала бы острие вперёд (как нос корабля) — для головы это буквально
  // "задом наперёд" (кабина трейлится сзади вместо того, чтобы вести состав), нужен доп. π.
  _wagonRot(w) {
    return this.heading + Math.PI / 2 + (w.isHead ? Math.PI : 0);
  }

  // idx считается от хвоста (0) к голове (ARMORED_TRAIN_WAGON_COUNT) — расстояние от
  // головы растёт с уменьшением idx, ровно как "бьют с хвоста" в дизайне.
  _positionAll(progress) {
    const p = Phaser.Math.Clamp(progress, 0, 1);
    const headX = Phaser.Math.Linear(this.startPos.x, this.endPos.x, p);
    const headY = Phaser.Math.Linear(this.startPos.y, this.endPos.y, p);
    this._positionAllAt(headX, headY);
  }

  // Общий хвост _positionAll — принимает готовые координаты головы напрямую (не через
  // progress/startPos-endPos), нужно для DEV-калибровки: startPos на progress=0 лежит
  // НАРОЧНО за границей сектора (EDGE_BUFFER, см. конструктор — там "въезд" маршрута), и
  // замороженный для калибровки поезд там же и остаётся навсегда, за границей карты. Для
  // калибровки это не нужно — телепортируем к игроку (см. GameScene keydown-T).
  _positionAllAt(headX, headY) {
    for (const w of this.wagons) {
      if (!w.alive) continue;
      const behind = (ARMORED_TRAIN_WAGON_COUNT - w.idx) * WAGON_GAP;
      w.x = headX - this._dirX * behind;
      w.y = headY - this._dirY * behind;
      if (w.sprite) {
        // Round(w.x/y) ЗДЕСЬ — ОШИБКА, найдено диагностикой: на этапе подъезда (быстро)
        // квантование в 1px — незаметная доля кадрового смещения, но на крейсерской фазе
        // (медленно, суб-пиксельное движение за кадр) то же округление даёт неровный
        // "ступенчатый" ход вместо плавного скольжения — именно это и читалось как
        // "дрожание", СИЛЬНЕЕ на медленном участке (баг из диалога: "пока выезжает
        // быстрее — дрожание едва заметно, но на самой карте стаёт сильным"). Не квантуем
        // позицию вообще нигде на этом пути (camera.roundPixels тоже false, см. GameScene.js
        // create() — тот же класс бага, что и render.roundPixels в main.js) — w.x/w.y
        // остаются float, спрайту — тоже float.
        w.sprite.setPosition(w.x, w.y);
        w.sprite.setRotation(this._wagonRot(w));
      }
    }
    this._updateTetherSprites();
  }

  // Пара силовых тросов на стык (не один по центру) — из симметричных боковых креплений
  // у стыковочного края каждого сегмента (см. TETHER_L_FRAC/TETHER_R_FRAC/
  // TETHER_LENGTH_MULT/TETHER_THICKNESS_MULT выше). Пульс — цвет/яркость, длина/толщина
  // уже сами по себе стилизованы (растянуты длиннее реального зазора), тянуть их
  // геометрию доп. не нужно.
  _updateTetherSprites() {
    const alive = this.wagons.filter(w => w.alive).sort((a, b) => b.idx - a.idx); // голова первой
    const wantPairs = [];
    for (let i = 0; i < alive.length - 1; i++) wantPairs.push([alive[i], alive[i + 1]]);
    const stale = wantPairs.length !== this._tetherSprites.length
      || this._tetherSprites.some((t, i) => t.a !== wantPairs[i][0] || t.b !== wantPairs[i][1]);
    if (stale) this._rebuildTetherSprites(wantPairs);

    this._tetherSprites.forEach((t, segIdx) => {
      this._positionTetherCable(t, true, segIdx);
      this._positionTetherCable(t, false, segIdx);
    });
  }

  // Один трос из пары — крепится к боковому "утолщению" у стыковочного края сегмента
  // (не к центру): edge = центр сегмента ∓ половина его длины вдоль курса, плюс СВОЙ
  // (не зеркальный) офсет frac*dispW поперёк курса — TETHER_L_FRAC/TETHER_R_FRAC каждый
  // двигается независимо, см. объявление выше. dispW/dispLen СВОИ у каждого сегмента
  // (голова/вагон могут отличаться по размеру после калибровки).
  _positionTetherCable(t, isLeft, segIdx) {
    const a = t.a, b = t.b;
    const img = isLeft ? t.imgL : t.imgR;
    const frac = isLeft ? TETHER_L_FRAC : TETHER_R_FRAC;
    const dirX = this._dirX, dirY = this._dirY;
    const perpX = -dirY, perpY = dirX;
    const halfA = a.dispLen / 2, halfB = b.dispLen / 2;
    const ax = a.x - dirX * halfA + perpX * frac * a.dispW;
    const ay = a.y - dirY * halfA + perpY * frac * a.dispW;
    const bx = b.x + dirX * halfB + perpX * frac * b.dispW;
    const by = b.y + dirY * halfB + perpY * frac * b.dispW;
    const midX = (ax + bx) / 2, midY = (ay + by) / 2;
    const span = Math.max(4, Math.hypot(ax - bx, ay - by)) * TETHER_LENGTH_MULT;
    const dispW = span * CABLE_SCALE_TO_CONTENT;
    const pulse = 0.8 + 0.2 * Math.sin(this._tetherPhase * Math.PI * 2 + segIdx * 1.1 + (isLeft ? 0 : 1));
    img.setPosition(midX, midY)
      .setRotation(this.heading)
      .setDisplaySize(dispW, dispW * CABLE_ASPECT * TETHER_THICKNESS_MULT)
      .setAlpha(pulse);
    // Ручка калибровки — НЕ сам трос (см. _makeTetherHandle): растянутый ×3/утолщённый
    // ×2 канат интерактивным делать нельзя, его display-прямоугольник огромный и ловил
    // клики по движению корабля рядом с поездом. Ручка маленькая и фиксированного
    // размера, только для перетаскивания.
    const handle = isLeft ? t.handleL : t.handleR;
    handle?.setPosition(midX, midY);
  }

  _rebuildTetherSprites(wantPairs) {
    this._tetherSprites.forEach(t => { t.imgL.destroy(); t.imgR.destroy(); t.handleL?.destroy(); t.handleR?.destroy(); });
    this._tetherSprites = wantPairs.map(([a, b]) => ({
      a, b,
      imgL: this.scene.add.image(0, 0, 'train_cable').setDepth(39),
      imgR: this.scene.add.image(0, 0, 'train_cable').setDepth(39),
      handleL: this._makeTetherHandle(a, true),
      handleR: this._makeTetherHandle(a, false),
    }));
  }

  // DEV: маленькая ручка калибровки троса мышью (не сам трос — см. _positionTetherCable)
  // — та же идея, что у турелей (_makeTurretSprite), но трос после ×3 растяжения/×2
  // утолщения интерактивным быть не может: display-размер огромный, ловил клики по
  // движению корабля вместо него. Левый/правый трос каждый пишет в СВОЮ переменную
  // (TETHER_L_FRAC/TETHER_R_FRAC) — независимо, без зеркалирования друг на друга.
  // Сегмент A этой пары — система отсчёта для обоих тросов ВСЕХ пар (значения общие на
  // весь поезд, не отдельные на каждую пару). Проекция драга на перпендикуляр курса,
  // делённая на dispW сегмента A, даёт новый офсет. 'L' (GameScene) дампит оба в лог/буфер.
  _makeTetherHandle(a, isLeft) {
    // Временно отключено по просьбе (T теперь просто полноценно запускает поезд, без
    // калибровки) — раскомментировать тело для следующей калибровочной сессии.
    return null;
    /*
    if (!this.scene.devMode) return null;
    const handle = this.scene.add.circle(0, 0, 14, 0x4dd0e1, 0.85).setStrokeStyle(2, 0x0a1a22, 0.9).setDepth(46);
    // Метка для GameScene pointerdown — эта ручка ЧИСТО калибровочная (нет своего
    // combat-хит-теста, в отличие от турелей), можно безопасно глушить общий обработчик
    // сцены при клике по ней целиком, не трогая обычный таргетинг турелей/вагонов.
    handle.isDevCalibHandle = true;
    handle.setInteractive({ useHandCursor: true });
    this.scene.input.setDraggable(handle, true);
    handle.on('drag', (pointer, dragX, dragY) => {
      const perpX = -this._dirY, perpY = this._dirX;
      const perpDist = (dragX - a.x) * perpX + (dragY - a.y) * perpY;
      const frac = perpDist / a.dispW;
      if (isLeft) TETHER_L_FRAC = frac; else TETHER_R_FRAC = frac;
    });
    return handle;
    */
  }

  // Одноразовая вспышка + затухание — трос "рвётся" именно на этом сегменте в
  // момент уничтожения вагона (обычная перерисовка троса уже просто перестанет
  // рисовать сегмент со следующего кадра, без этой вспышки разрыв был бы незаметен).
  _flashTetherSnap(x1, y1, x2, y2) {
    const g = this.scene.add.graphics().setDepth(44);
    g.lineStyle(4, 0xffffff, 1);
    g.lineBetween(x1, y1, x2, y2);
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 350, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
  }

  // Маршрут поезда НАРОЧНО заходит за пределы мира на въезде/выезде (EDGE_BUFFER, см.
  // constructor) — турель там физически не видна игроку, но без этой проверки всё равно
  // и стреляла, и принимала урон (баг из диалога). См. использование в _updateTurrets и
  // TrainTurretTarget.canBeAttacked.
  _inBounds(x, y) {
    return x >= 0 && x <= this.scene.worldWidth && y >= 0 && y <= this.scene.worldHeight;
  }

  // Турели: тот же контракт, что MiningBase._updateTurrets (nearest player in range,
  // gs.fireMobWeapon — локально-авторитетный урон по игроку, без сервера). Стреляют
  // ВСЕ живые вагоны одновременно (не только текущий уязвимый "хвостовой") — очередь
  // уничтожения касается только КТО получает урон, не кто им отвечает. Позиции сокетов
  // — 2×2 сетка (свой массив на вагон/голову, см. _turretOffsetsFor), повёрнутая на тот
  // же угол, что и корпус сегмента.
  _updateTurrets(dt, player) {
    // Раньше гейтилось на player.alive — как только ЛОКАЛЬНЫЙ игрок умирал, вся функция
    // (для ВСЕХ вагонов) выходила сразу, турели визуально замирали, хотя поезд продолжал
    // ехать (баг из диалога: "после убийства корабля... поезд движется, турели остановились").
    // Ниже уже есть per-турельный гейт по РЕАЛЬНОЙ цели (targetEntity, строка ~653) —
    // сервер может назначить турель другому живому игроку комнаты, и он должен доворачиваться/
    // стрелять по нему, даже если ЭТОТ клиент только наблюдает труп своего игрока.
    // Нужен лишь сам объект player (как дефолтный фоллбэк-таргет ниже), не его .alive.
    if (!player) return;
    for (const w of this.wagons) {
      if (!w.alive) continue;
      // Головной вагон — турели "2-го уровня" (cannon2: вдвое прочнее/сильнее cannon1,
      // см. BASE_CONFIG в bases.js и TrainTurretTarget выше) — сильнее защищён, раз
      // именно он спавнит волны дронов и завершает поезд (см. диалог).
      const range   = w.isHead ? BASE_CONFIG.cannon2Range  : BASE_CONFIG.cannon1Range;
      const damage  = (w.isHead ? BASE_CONFIG.cannon2Damage : BASE_CONFIG.cannon1Damage) * pvpTierMult(this.tier);
      const rateInv = 1 / (w.isHead ? BASE_CONFIG.cannon2Rate : BASE_CONFIG.cannon1Rate);
      // Свой угол на вагон (не общий this.heading+π/2) — голова развёрнута доп. на π
      // относительно корпуса (см. _wagonRot), иначе её турельные сокеты остались бы
      // рассчитаны по старому углу и разъехались бы с уже перевёрнутым спрайтом.
      const rot = this._wagonRot(w);
      const cosR = Math.cos(rot), sinR = Math.sin(rot);
      // Корпус вагона теперь рисуется в СЫРОМ w.x/y (см. _positionAllAt — Math.round там
      // был ошибкой, диагностика нашла настоящую причину дрожания на медленном крейсерском
      // участке). Турели считаем от ТОГО ЖЕ сырого якоря, тем же способом (не округляем
      // офсет/финальную позицию) — иначе они снова разошлись бы по фазе с корпусом кадр
      // от кадра (тот же класс бага, что уже чинили: "турели как будто болтаются -
      // скользят на корпусе").
      const bx = w.x, by = w.y;
      this._turretOffsetsFor(w).forEach((off, i) => {
        const lx = off.lx * w.dispW, ly = off.ly * w.dispLen;
        const ox = bx + lx * cosR - ly * sinR;
        const oy = by + lx * sinR + ly * cosR;
        // Позиция нужна TrainTurretTarget.x/y (клик-таргетинг/урон) даже для уже
        // уничтоженной турели не важна, но для живой — единственное место, где считается.
        const tt = w.turrets[i];
        tt.x = ox; tt.y = oy;
        const spr = w._turretSprites?.[i];
        if (!tt.alive || !spr) return; // турель убита — сокет пуст, не стреляет и не рисуется
        spr.setPosition(ox, oy);
        // Y-сортировка глубины между соседними турелями — при повороте к цели ствол одной
        // турели может геометрически проходить рядом с корпусом соседней; фиксированная
        // одинаковая depth=41 у всех давала произвольный (по порядку создания) z-order,
        // из-за чего одна турель визуально "налезала под" соседнюю независимо от того, кто
        // реально ближе. Чуть смещаем depth по мировому Y (стандартный top-down приём) —
        // множитель крошечный, не выходит за пределы соседнего слоя (42).
        spr.setDepth(41 + oy * 0.0001);
        // Сервер-авторитетный таргетинг (План Фаза 3): если сервер в этот тик назначил
        // эту турель ДРУГОМУ игроку комнаты — ствол ВСЁ РАВНО должен визуально довернуться
        // на реального адресата (RemotePlayer), а не замереть на месте (баг из диалога:
        // "нет поворота башни в сторону другого игрока") — только САМ ВЫСТРЕЛ (fireMobWeapon,
        // ниже) остаётся только у клиента настоящей цели, иначе урон применился бы у нас
        // локально ВТОРОЙ раз поверх relay от неё же. Фоллбэк на локального игрока, если
        // сервер ещё не прислал апдейт (соло/дев) или реальная цель не найдена/не жива.
        let iAmTarget = true;
        let targetEntity = player;
        const targets = this.scene._serverMobTargets;
        if (tt.pvpMobId && targets) {
          const targetUid = targets[tt.pvpMobId];
          if (targetUid !== undefined && targetUid !== this.scene.myUserId) {
            iAmTarget = false;
            targetEntity = this.scene.pvpClient?.players?.get(targetUid) || null;
          }
        }
        if (!targetEntity?.alive) return; // реальная цель не найдена/не жива — турель бездействует
        w._turretCooldowns[i] -= dt;
        const d = Phaser.Math.Distance.Between(ox, oy, targetEntity.x, targetEntity.y);
        const inRange = d < range;
        const rawAngle = inRange ? Math.atan2(targetEntity.y - oy, targetEntity.x - ox) : rot;
        // Сектор обстрела: турель не должна разворачиваться дальше своей "внешней"
        // стороны — иначе, когда игрок перелетает на противоположный борт поезда, ствол
        // делает почти разворот на 180° и по пути визуально проходит сквозь корпус/другую
        // турель. "Внешнее" направление сокета — от центра сегмента К сокету (off.lx/ly),
        // довёрнутое на тот же rot, что и позиция. Зажимаем угол наведения в пределах
        // ±140° от этого направления (было ±100° — 4 сокета математически покрывали все
        // 360° без дыр, но в любой момент только 1-2 из 4 реально держали цель в секторе,
        // остальные корректно молчали — с игровой стороны это читалось как "турели не
        // стреляют", см. диалог). ±140° даёт кратный запас перекрытия между соседними
        // секторами (макс. разрыв между центрами соседних сокетов ~121°), но всё ещё
        // меньше 180° — ствол не разворачивается через сам корпус вагона.
        const arcCenter = Math.atan2(off.ly, off.lx) + rot;
        const arcDiff = Phaser.Math.Angle.Wrap(rawAngle - arcCenter);
        // Сокеты идут парами по борту (0/1 — передняя пара, 2/3 — задняя, см.
        // WAGON_TURRET_OFFSETS/HEAD_TURRET_OFFSETS: лево/право зеркальны по lx при
        // одинаковом ly) — ограничение ±140° существует, чтобы ствол не разворачивался
        // через корпус К СОСЕДНЕЙ турели той же пары. Если соседка уже уничтожена — там
        // больше нечего огибать, доступны все 360° (правка по просьбе).
        const NEIGHBOR_IDX = [1, 0, 3, 2];
        const neighborAlive = w.turrets[NEIGHBOR_IDX[i]]?.alive ?? false;
        const ARC_HALF = neighborAlive ? Math.PI * (140 / 180) : Math.PI;
        const clampedAngle = arcCenter + Phaser.Math.Clamp(arcDiff, -ARC_HALF, ARC_HALF);
        const targetAngle = clampedAngle + Math.PI / 2;
        const diff = Phaser.Math.Angle.Wrap(targetAngle - spr.rotation);
        spr.rotation += Phaser.Math.Clamp(diff, -6 * dt, 6 * dt);
        // Раньше стреляла по чистой дальности, независимо от того, довернулся ли ствол на
        // игрока — "дальние" турели (у которых arcDiff близко к пределу ±100°, разворот
        // долгий) наносили урон, даже стоя носом в сторону, никогда не долетев до игрока
        // визуально. Гейтим огонь и по сектору обстрела (игрок реально в пределах ±100° от
        // "внешнего" направления сокета, не только зажатый угол), и по факту доворота
        // ствола (spr.rotation достаточно близко к targetAngle — довернулся, не просто
        // целится в клампнутую сторону).
        const withinArc = Math.abs(arcDiff) <= ARC_HALF;
        const aimed = Math.abs(Phaser.Math.Angle.Wrap(targetAngle - spr.rotation)) < 0.12;
        // Въезд/выезд поезда нарочно за пределами мира (см. _inBounds) — турель там не
        // должна стрелять по игроку (баг из диалога).
        if (!inRange || !withinArc || !aimed || w._turretCooldowns[i] > 0 || this.frozen || !this._inBounds(ox, oy)) return;
        w._turretCooldowns[i] = rateInv;
        if (!iAmTarget) return; // визуал (доворот/КД) отыгран, реальный выстрел — только у клиента настоящей цели
        // pvpMobId — нужен fireMobWeapon для relay "меня атакует турель X" остальным
        // игрокам комнаты (см. pvp_mob_attack_vfx, баг из диалога "второй игрок не видит").
        this.scene.fireMobWeapon?.({ x: ox, y: oy, damage, isBoss: false, tpl: { projectileType: 'plasma' }, pvpMobId: tt.pvpMobId }, targetEntity.x, targetEntity.y, targetEntity);
      });
    }
  }

  // Пороги HP головного вагона (2 фазы) — спавн волны дронов охраны (sec_drone,
  // уменьшенный вдвое — см. constants.js). pvpMobId шарит HP дрона между клиентами
  // тем же детерминированным паттерном, что и мобы нашествия.
  _onHeadPhase(phase) {
    const cfg = this.cfg;
    const cx = this.head.x, cy = this.head.y;
    this._drones = this._drones || [];
    for (let i = 0; i < ARMORED_TRAIN_DRONE_WAVE_SIZE; i++) {
      const h = this.scene._worldEventHash(`train:${this.sectorKey}:${this.startAt}:drones:${phase}:${i}`);
      const ang = (h % 360) * Math.PI / 180, dist = 150 + (h % 250);
      const x = cx + Math.cos(ang) * dist, y = cy + Math.sin(ang) * dist;
      const lvl = cfg.lvlMax;
      // neutral:false — sec_drone неутрален по умолчанию (см. MOBS.sec_drone), но эти
      // дроны — активная охрана головного вагона, должны агриться на игрока сразу по
      // приближению, а не только после того, как их первыми ударят (см. Mob.js
      // "neutral ⇒ никогда не выставляет state='aggro' по дистанции").
      const m = new Mob(this.scene, MOBS.sec_drone, lvl, x, y, { neutral: false });
      m.isArmoredTrainDrone = true;
      m.noRespawn = true;
      if (this.scene._realtimeRoomKey) {
        m.pvpMobId = `train:${this.sectorKey}:${this.startAt}:drone:${phase}:${i}`;
        // Сервер-авторитетный таргетинг (План Фаза 2) — регистрация идемпотентна,
        // все клиенты комнаты зовут это на один и тот же детерминированный mobId.
        this.scene.pvpClient?.registerMob(m.pvpMobId);
      }
      this.scene.mobs.push(m);
      this._drones.push(m);
      this._spawnDroneFlyoutFx(m, cx, cy, x, y);
    }
    this.scene.log?.(`⚠ Бронепоезд: волна дронов охраны (фаза ${phase + 1})!`);
  }

  // Косметика "вылета" дрона из головного вагона: реальный спрайт (уже созданный
  // Mob с корректной физикой/якорем в целевой точке) скрыт до конца твина,
  // призрак-копия летит cx,cy → x,y и исчезает. Никак не влияет на AI/leash.
  _spawnDroneFlyoutFx(m, cx, cy, x, y) {
    if (!m.sprite) return;
    m.sprite.setVisible(false);
    const ghost = this.scene.add.image(cx, cy, m.sprite.texture.key)
      .setDisplaySize(m.sprite.displayWidth, m.sprite.displayHeight)
      .setDepth(m.sprite.depth)
      .setAlpha(0.4).setScale(0.4);
    this.scene.tweens.add({
      targets: ghost,
      x, y,
      alpha: 1,
      scaleX: m.sprite.scaleX, scaleY: m.sprite.scaleY,
      duration: 400,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        ghost.destroy();
        if (m.alive) m.sprite?.setVisible(true);
      }
    });
  }

  // Дроны — Mob.js держит поводок (leash) от НЕПОДВИЖНОЙ this.spawnX/Y (штатный
  // механизм для обычных стационарных охранников). Голова поезда ДВИЖЕТСЯ — без
  // постоянной перепривязки якоря дрон рано или поздно оказывался далеко позади уже
  // уехавшей головы. Переустанавливаем spawnX/Y на текущую позицию головы каждый кадр,
  // пока она жива — leash-гистерезис в Mob.js делает всё остальное сам, код там не
  // трогаем. После уничтожения головы якорь просто замораживается на месте её смерти
  // (спавнить точку возврата больше некуда) — оставшиеся дроны не разлетаются дальше.
  // Плюс лёгкое взаимное отталкивание ("рой") — иначе восьмёрка дронов на одной и той же
  // аггро-точке визуально слипается в стопку.
  // idx → объект вагона (голова тоже в this.wagons, последним элементом — см. конструктор).
  _wagonByIdx(idx) {
    return this.wagons[idx];
  }

  // Вызывается из GameScene._onTrainWeaponFire — сервер УЖЕ решил залп, распределил
  // урон между целями и применил его (см. server _fire_train_missiles/
  // _distribute_train_damage, план "Полностью серверное"). Здесь только визуал: летящие
  // самонаводящиеся снаряды с борта до последней известной позиции каждой цели,
  // 1:1 с реальным числом "попаданий", доставшихся ей (hits[].hits) — не всегда 4 на
  // борт, если урон был распределён между несколькими игроками.
  playMissileVolleyVfx(wagonIdx, hits) {
    const wagon = this._wagonByIdx(wagonIdx);
    if (!wagon?.alive || !hits?.length) return;
    const gs = this.scene;
    const rot = this._wagonRot(wagon);
    // Борт = перпендикуляр к курсу вагона (тот же rot, что и у турельных сокетов) —
    // левая/правая точка запуска, а не 4 отдельных сокета (турели уже мертвы к этому
    // моменту, их гнёзда пустуют — новый залп не привязан к конкретным турельным точкам).
    const perpX = -Math.sin(rot), perpY = Math.cos(rot);
    const sideOffset = wagon.dispW * 0.5;
    const sides = [
      { x: wagon.x - perpX * sideOffset, y: wagon.y - perpY * sideOffset },
      { x: wagon.x + perpX * sideOffset, y: wagon.y + perpY * sideOffset },
    ];
    this._missileGfx ??= gs.add.graphics().setDepth(56);
    let i = 0;
    for (const h of hits) {
      const target = h.uid === gs.myUserId ? gs.player : gs.pvpClient?.players?.get(h.uid);
      if (!target?.alive) { i += h.hits; continue; }
      for (let s = 0; s < h.hits; s++) {
        const side = sides[i % 2];
        const baseAngle = Math.atan2(target.y - side.y, target.x - side.x) + (s - (h.hits - 1) / 2) * 0.12;
        this._missiles.push({ x: side.x, y: side.y, angle: baseAngle, speed: 620, target, life: 3.5, hit: false });
        i++;
      }
    }
    gs.log?.(`🚀 Поезд: ракетный залп с борта (вагон ${wagon.idx + 1})`);
  }

  // Полёт/самонаведение/попадание — визуал скопирован с ArgusController._updateMissiles
  // (тот же корпус+нос+хвостовой шлейф). Чисто косметическая симуляция — реальный урон
  // уже применён сервером ДО того, как этот метод вообще узнал о залпе (см.
  // playMissileVolleyVfx), поэтому попадание тут — только explosion(), без takeDamage/
  // hitFlash/mobAttackVfx (те теперь в GameScene._onTrainWeaponFire, один раз на весь
  // залп, а не по факту долёта каждого отдельного визуального снаряда).
  _updateMissiles(dt) {
    if (!this._missiles.length) return;
    const gs = this.scene;
    this._missileGfx.clear();
    let anyAlive = false;

    for (const m of this._missiles) {
      if (m.hit || m.life <= 0) continue;
      anyAlive = true;
      m.life -= dt;

      if (m.target?.alive) {
        const desired = Math.atan2(m.target.y - m.y, m.target.x - m.x);
        let diff = desired - m.angle;
        diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        const turn = Math.min(Math.abs(diff), 4.5 * dt);
        m.angle += Math.sign(diff) * turn;
      }

      m.x += Math.cos(m.angle) * m.speed * dt;
      m.y += Math.sin(m.angle) * m.speed * dt;

      if (m.target?.alive) {
        const dist = Math.hypot(m.target.x - m.x, m.target.y - m.y);
        if (dist < 45) {
          m.hit = true;
          gs.explosion?.(m.x, m.y, 0.4);
          continue;
        }
      }

      const ca = Math.cos(m.angle), sa = Math.sin(m.angle);
      this._missileGfx.lineStyle(6, 0xff4400, 0.35);
      this._missileGfx.lineBetween(m.x - ca * 22, m.y - sa * 22, m.x - ca * 40, m.y - sa * 40);
      this._missileGfx.lineStyle(4, 0xff8800, 0.55);
      this._missileGfx.lineBetween(m.x - ca * 10, m.y - sa * 10, m.x - ca * 26, m.y - sa * 26);
      this._missileGfx.fillStyle(0xffffff, 0.95);
      this._missileGfx.fillCircle(m.x, m.y, 4);
      this._missileGfx.fillStyle(0xff6622, 0.9);
      this._missileGfx.fillTriangle(
        m.x + ca * 10, m.y + sa * 10,
        m.x - sa * 4, m.y + ca * 4,
        m.x + sa * 4, m.y - ca * 4,
      );
    }

    if (!anyAlive) this._missiles = [];
    else this._missiles = this._missiles.filter(m => !m.hit && m.life > 0);
  }

  // "Вырастает" в опустевшем гнезде головы, когда её 4 турели уже уничтожены (см.
  // ArmoredTrainWagon.onTurretDestroyed, диалог: "для главного вагона... ротационная
  // многонаправленная турель, вырастает из места посередине между турелями"). Реальный
  // ассет (client/assets/train/rotate_turet.png, симметричная 8-ствольная иконка —
  // origin 0.5/0.5, не нужен TURRET_ORIGIN-якорь по стволу, как у обычных турелей).
  _spawnHeadCoreTurret(headWagon) {
    if (this.coreTurret) return; // защита от повторного вызова (не должно случаться)
    this.coreTurret = new TrainCoreTurret(headWagon);
    if (this.scene._realtimeRoomKey) this.scene.pvpClient?.registerMob(this.coreTurret.pvpMobId);
    // ×1.8 обычного turretSize (было ×1.4, затем перебор до ×2.6 — по скриншоту из
    // диалога получилось слишком крупно и оторвано от корпуса вместе со смещением
    // выше; ×1.8 — заметнее обычной турели, но не отдельная громадная структура).
    // Позиция — сразу со смещением (см. TrainCoreTurret.x/y), не headWagon.x/y
    // напрямую — иначе один кадр мелькнула бы в центре до первого тика _updateCoreTurret.
    const targetLen = Math.round(BASE_CONFIG.turretSize * 1.8);
    const { w: tw, h: th } = fitSize(this.scene, 'turret_core', targetLen);
    this._coreTurretSprite = this.scene.add.image(this.coreTurret.x, this.coreTurret.y, 'turret_core')
      .setDisplaySize(tw, th).setOrigin(0.5, 0.5).setDepth(42);
    this.scene.log?.('⚠ Голова бронепоезда наращивает центральную турель!');
  }

  _onCoreTurretDestroyed() {
    this.scene.explosion?.(this.coreTurret.x, this.coreTurret.y, 0.7);
    this._coreTurretSprite?.destroy();
    this._coreTurretSprite = null;
    this.coreTurret = null;
    this.scene.log?.('Центральная турель бронепоезда уничтожена!');
  }

  // Постоянное вращение кольца стволов + слежение за позицией головы — чисто
  // косметика, независимая от того, кто и когда решает стрелять (см. playCoreVolleyVfx).
  _updateCoreTurret(dt) {
    const core = this.coreTurret;
    if (!core?.alive) return;
    this._coreTurretSprite?.setPosition(core.x, core.y); // сырые float — см. _positionAllAt
    if (this._coreTurretSprite) this._coreTurretSprite.rotation += dt * 0.3;
  }

  // Вызывается из GameScene._onTrainWeaponFire — сервер УЖЕ решил залп, распределил и
  // применил урон (см. server _fire_core_volley/_distribute_train_damage). Здесь только
  // визуал: 8 радиальных "призрачных" болтов (GameScene._spawnGhostBolt — НЕ настоящий
  // Projectile, тот сам наносит урон в _hit() при owner:'mob' и задвоил бы его поверх
  // уже применённого сервером). core._burstStep — чисто косметический локальный счётчик
  // "какой из 3 залпов серии" для 120°-доворота узора; синхронен у всех клиентов, т.к.
  // инкрементируется РОВНО по одному разу на каждый одинаковый входящий broadcast.
  playCoreVolleyVfx() {
    const core = this.coreTurret;
    if (!core?.alive) return;
    const gs = this.scene;
    const BOLTS = 8;
    core._burstStep = core._burstStep ?? 0;
    const rotOffset = core._burstStep * (Math.PI * 2 / 3);
    for (let i = 0; i < BOLTS; i++) {
      const ang = rotOffset + i * (Math.PI * 2 / BOLTS);
      const tx = core.x + Math.cos(ang) * 800, ty = core.y + Math.sin(ang) * 800;
      gs._spawnGhostBolt(core.x, core.y, tx, ty, 'plasma');
    }
    gs.muzzleFlash?.(core.x, core.y, 0xffaa44);
    core._burstStep = (core._burstStep + 1) % 3;
  }

  _updateDrones(dt) {
    if (!this._drones?.length) return;
    const alive = this._drones.filter(d => d.alive);
    if (!alive.length) { this._drones = alive; return; }
    if (this.head.alive) {
      for (const d of alive) { d.spawnX = this.head.x; d.spawnY = this.head.y; }
    }
    // Общая реализация (см. Mob.js applySeparation) — раньше была только здесь,
    // теперь переиспользуется и для PvP-патрульных роёв (GameScene._updateDroneSwarms).
    applySeparation(alive, dt);
    this._drones = alive;
  }

  // Вызывается из GameScene._onPvpMobHitResult/_localPvpFireResolve на killed=true.
  onWagonDestroyed(wagon) {
    const neighbors = this.wagons.filter(w => w.alive && Math.abs(w.idx - wagon.idx) === 1);
    for (const n of neighbors) this._flashTetherSnap(wagon.x, wagon.y, n.x, n.y);
    wagon.alive = false;
    wagon.destroyVisuals();
    this.destroyedCount++;
    this._updateTetherSprites();
    this.scene.explosion?.(wagon.x, wagon.y, wagon.isHead ? 1.6 : 1.0);
    this.scene.log?.(wagon.isHead ? '💥 Бронепоезд: головной вагон уничтожен!' : '💥 Бронепоезд: вагон уничтожен!');
    // Поворотная турель растёт ИЗ головного вагона (см. _spawnHeadCoreTurret) — если он
    // уничтожен раньше, чем саму турель успели добить отдельно, она должна исчезнуть
    // вместе с ним, а не повиснуть спрайтом на месте гибели (баг из диалога: "урон
    // игроку наносится после убийства головного вагона" — сервер уже перестал слать
    // залпы от неё, см. server _train_weapon_tick_loop, но визуал сам себя не убирал).
    if (wagon.isHead && this.coreTurret) this._onCoreTurretDestroyed();
    if (this.wagons.every(w => !w.alive)) this._markFinished();
  }

  // Единая точка "поезд закончился" (все вагоны мертвы ИЛИ истёк маршрутный таймаут,
  // см. вызовы ниже) — раньше каждое место просто ставило this.finished=true само по
  // себе, ничего не сообщая серверу. ArmoredTrainManager.cleanup(trainKey) на сервере
  // существовал, но его никто никогда не звал — _train_weapon_tick_loop не знал, что
  // маршрут закончился (ушёл с карты по расписанию, необязательно уничтожен), и
  // продолжал слать залпы уже несуществующего поезда бесконечно (баг из диалога: "урон
  // после уничтожения поезда продолжает убивать игрока"). Идемпотентно на сервере —
  // не страшно, если несколько клиентов комнаты пришлют это независимо.
  _markFinished() {
    if (this.finished) return;
    this.finished = true;
    if (this.scene._realtimeRoomKey) this.scene.pvpClient?.trainFinished(this.trainKey);
  }

  // Кусочно-линейная скорость (см. конструктор — _approachMs/_cruiseMs/_exitMs/_pEnter/
  // _pExit): быстро до появления на карте, медленно поперёк видимой части, снова быстро
  // на выходе. _positionAll(progress) как раньше просто линейно интерполирует
  // startPos→endPos по этой доле — вся нелинейность скорости живёт только здесь.
  get progress() {
    const t = Date.now() - this.startAt;
    if (t <= 0) return 0;
    if (t < this._approachMs) {
      return Phaser.Math.Clamp(this._pEnter * (t / this._approachMs), 0, 1);
    }
    if (t < this._approachMs + this._cruiseMs) {
      const f = (t - this._approachMs) / this._cruiseMs;
      return this._pEnter + (this._pExit - this._pEnter) * f;
    }
    const f = (t - this._approachMs - this._cruiseMs) / this._exitMs;
    return Phaser.Math.Clamp(this._pExit + (1 - this._pExit) * f, 0, 1);
  }

  // "sector:startAt" — совпадает с ключом ArmoredTrainManager.destroyed на сервере
  // (mobId вагона = "train:" + trainKey + ":" + idx).
  get trainKey() { return `${this.sectorKey}:${this.startAt}`; }

  // Ответ на pvp_train_query (см. HudScene.onTrainSnapshot) — подхватывает реальное
  // состояние ОТ СЕРВЕРА для игрока, зашедшего в сектор ПОСЛЕ начала события: какие
  // вагоны уже уничтожены (destroyed — переживает remove_mob на сервере, в отличие от
  // hull/shield самих PvpMobState) и hull/shield ещё живых.
  applySnapshot(msg) {
    if (msg.trainKey !== this.trainKey) return; // ответ на устаревший/чужой запрос
    for (const idx of msg.destroyed ?? []) {
      const w = this.wagons.find(w => w.idx === idx && w.alive);
      if (w) { w.alive = false; w.destroyVisuals(); this.destroyedCount++; }
    }
    for (const [mobId, s] of Object.entries(msg.wagons ?? {})) {
      const w = this.wagons.find(w => w.pvpMobId === mobId && w.alive);
      if (w) { w.hull = s.hull; w.shield = s.shield; w._updateHpState(); }
    }
    this._updateTetherSprites();
    if (this.wagons.every(w => !w.alive)) this._markFinished();
  }

  update(dt) {
    if (this.finished) return;
    // frozen (DEV-калибровка, см. конструктор): не двигаем и не гасим по таймауту —
    // иначе окно (_totalMs) истекло бы прямо во время подгонки масштаба/турелей.
    // Турели/тросы/бары всё равно обновляются как обычно.
    this._tetherPhase = ((this._tetherPhase ?? 0) + dt * 0.4) % 1; // ~2.5с на полный цикл пульса
    if (!this.frozen) {
      const now = Date.now();
      if (now >= this.startAt + this._totalMs) { this._markFinished(); return; }
      this._positionAll(this.progress); // сама вызывает _updateTetherSprites()
    } else {
      this._updateTetherSprites(); // вагоны неподвижны, но пульс троса всё равно анимируем
    }
    for (const w of this.wagons) if (w.alive) w._updateHpState();
    this._updateTurrets(dt, this.scene.player);
    this._updateMissiles(dt);
    this._updateCoreTurret(dt);
    this._updateDrones(dt);
  }

  destroy() {
    this._tetherSprites.forEach(t => { t.imgL.destroy(); t.imgR.destroy(); t.handleL?.destroy(); t.handleR?.destroy(); });
    this._tetherSprites = [];
    for (const w of this.wagons) w.destroyVisuals();
    this._missileGfx?.destroy();
    this._coreTurretSprite?.destroy();
  }
}
