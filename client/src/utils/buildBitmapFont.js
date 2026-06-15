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
  const pad      = UI_RES; // padding in atlas px = 1 display pixel at any UI_RES

  // Measure font metrics via temp canvas
  const tmp = document.createElement('canvas');
  tmp.width = 4; tmp.height = 4;
  const mCtx = tmp.getContext('2d');
  mCtx.font = fontSpec;
  const ref  = mCtx.measureText('АМЙgpQf');
  const asc  = Math.ceil(ref.fontBoundingBoxAscent  ?? ref.actualBoundingBoxAscent  ?? atlasPx * 0.82);
  const desc = Math.ceil(ref.fontBoundingBoxDescent ?? ref.actualBoundingBoxDescent ?? atlasPx * 0.22);

  // Round rowH up to multiple of UI_RES so that rowH/UI_RES is always integer.
  // This prevents 0.5-pixel Y offset when centering with setOrigin(0.5, 0.5).
  const rowH = alignTo(asc + desc + pad * 2, UI_RES);

  // Pack glyphs into rows (max atlas width 1024)
  const MAX_W = 1024;
  const chars = [...CHARSET];
  let cx = 0, cy = 0;
  const slots = [];
  for (const ch of chars) {
    const measured = Math.ceil(mCtx.measureText(ch).width);
    // Round advance up to multiple of UI_RES so that xAdvance/UI_RES is integer.
    // This prevents sub-pixel glyph positions from accumulating across characters.
    const adv = alignTo(measured, UI_RES);
    const cw  = adv + pad * 2; // atlas cell width = advance + padding on both sides
    if (cx + cw > MAX_W && cx > 0) { cx = 0; cy += rowH; }
    slots.push({ ch, x: cx, y: cy, w: cw, adv });
    cx += cw;
  }
  const atlasH = nextPow2(cy + rowH);

  // Clean up stale keys on hot-reload
  const texKey = `__bmf_tex_${key}`;
  if (scene.textures.exists(texKey))   scene.textures.remove(texKey);
  if (scene.cache.bitmapFont.has(key)) scene.cache.bitmapFont.remove(key);

  // Create Phaser CanvasTexture and render glyphs (white — tinted per object at runtime)
  const tex = scene.textures.createCanvas(texKey, MAX_W, atlasH);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, MAX_W, atlasH);
  ctx.font         = fontSpec;
  ctx.fillStyle    = '#ffffff';
  ctx.textBaseline = 'alphabetic';

  const charMap = {};
  for (const { ch, x, y, w, adv } of slots) {
    ctx.fillText(ch, x + pad, y + pad + asc);

    // Phaser 4 reads UV coords directly from charData (v-axis inverted: OpenGL convention)
    charMap[ch.codePointAt(0)] = {
      x, y,
      width:   w,
      height:  rowH,
      centerX: Math.floor(w    / 2),
      centerY: Math.floor(rowH / 2),
      xOffset:  0,
      yOffset:  0,
      xAdvance: adv, // multiple of UI_RES → adv/UI_RES is integer → no sub-pixel drift
      data:    {},
      kerning: {},
      u0:  x           / MAX_W,
      v0:  1 - y            / atlasH,
      u1: (x + w)      / MAX_W,
      v1:  1 - (y + rowH)   / atlasH,
    };
  }

  tex.refresh(); // upload canvas → WebGL texture

  // Register bitmap font. atlasPx is reference size — Phaser scales glyphs by requestedSize/atlasPx,
  // so requesting fontSize gives scale=1/UI_RES and UI_RES× supersampling at integer pixel positions.
  scene.cache.bitmapFont.add(key, {
    data: {
      font:       fontFamily,
      size:       atlasPx,
      lineHeight: rowH,
      chars:      charMap,
    },
    texture:   texKey,
    frame:     null,
    fromAtlas: false,
  });
}

// Round n up to the nearest multiple of align
function alignTo(n, align) {
  return Math.ceil(n / align) * align;
}

function nextPow2(n) {
  let p = 1; while (p < n) p <<= 1; return p;
}
