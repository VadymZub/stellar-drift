import { UI_RES } from '../constants.js';

// Full charset: digits, Latin, Cyrillic, common symbols (no color emoji)
const CHARSET =
  ' 0123456789' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
  'abcdefghijklmnopqrstuvwxyz' +
  'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя' +
  '.,!?/:+-·•%×|_\'"()[]';

export function buildBitmapFont(scene, key, fontFamily, fontSize, weight = '500') {
  try {
    _build(scene, key, fontFamily, fontSize, weight);
  } catch (e) {
    console.warn(`[buildBitmapFont] "${key}" failed:`, e);
  }
}

function _build(scene, key, fontFamily, fontSize, weight) {
  const atlasPx  = Math.round(fontSize * UI_RES);
  const fontSpec = `${weight} ${atlasPx}px "${fontFamily}"`;
  const pad      = 2;

  // Measure font metrics
  const tmp = document.createElement('canvas');
  tmp.width = 4; tmp.height = 4;
  const mCtx = tmp.getContext('2d');
  mCtx.font = fontSpec;
  const ref  = mCtx.measureText('АМЙgpQf');
  const asc  = Math.ceil(ref.fontBoundingBoxAscent  ?? ref.actualBoundingBoxAscent  ?? atlasPx * 0.82);
  const desc = Math.ceil(ref.fontBoundingBoxDescent ?? ref.actualBoundingBoxDescent ?? atlasPx * 0.22);
  const rowH = asc + desc + pad * 2;

  // Pack glyphs into rows (max atlas width 1024)
  const MAX_W = 1024;
  const chars = [...CHARSET];
  let cx = 0, cy = 0;
  const slots = [];
  for (const ch of chars) {
    const adv = Math.ceil(mCtx.measureText(ch).width);
    const cw  = adv + pad * 2;
    if (cx + cw > MAX_W && cx > 0) { cx = 0; cy += rowH; }
    slots.push({ ch, x: cx, y: cy, w: cw, adv });
    cx += cw;
  }
  const atlasH = nextPow2(cy + rowH);

  // Create Phaser canvas texture
  const texKey = `__bmf_tex_${key}`;
  const tex    = scene.textures.createCanvas(texKey, MAX_W, atlasH);
  const ctx    = tex.getContext();
  ctx.clearRect(0, 0, MAX_W, atlasH);
  ctx.font         = fontSpec;
  ctx.fillStyle    = '#ffffff';
  ctx.textBaseline = 'alphabetic';  // consistent baseline across all chars

  // Render each glyph and record its atlas position
  const charMap = {};
  for (const { ch, x, y, w, adv } of slots) {
    ctx.fillText(ch, x + pad, y + pad + asc);
    charMap[ch.codePointAt(0)] = {
      x, y,
      width:    w,
      height:   rowH,
      xOffset:  0,
      yOffset:  0,
      xAdvance: adv + pad,
      data:     {},
      kerning:  {},
    };
  }
  tex.refresh();

  // Register with Phaser's bitmap font cache.
  // atlasPx is the reference size — Phaser scales glyphs by (requestedSize / atlasPx),
  // so requesting fontSize gives 1/UI_RES scale = UI_RES× supersampling.
  scene.cache.bitmapFont.add(key, {
    data: {
      font:       fontFamily,
      size:       atlasPx,
      lineHeight: rowH,
      chars:      charMap,
    },
    texture: texKey,
    frame:   null,
  });
}

function nextPow2(n) {
  let p = 1; while (p < n) p <<= 1; return p;
}
