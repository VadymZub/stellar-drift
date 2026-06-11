import { MINIMAP } from '../constants.js';

// Миникарта — векторные блипы (не камера): резкая при любом DPR/рендер-конфиге.
// Геометрия общая для рисования (HudScene) и клик-навигации (GameScene).

// Прямоугольник миникарты на экране (правый верх). scene.scale.width одинаков во всех сценах.
export function minimapRect(scene) {
  return { x: scene.scale.width - MINIMAP.w - MINIMAP.pad, y: MINIMAP.pad, w: MINIMAP.w, h: MINIMAP.h };
}

// Вписываем мир в квадрат миникарты с сохранением пропорций (letterbox).
function fit(rect, ww, wh) {
  const s = Math.min(rect.w / ww, rect.h / wh);
  return { s, ox: rect.x + (rect.w - ww * s) / 2, oy: rect.y + (rect.h - wh * s) / 2 };
}

export function worldToMinimap(wx, wy, rect, ww, wh) {
  const f = fit(rect, ww, wh);
  return { x: f.ox + wx * f.s, y: f.oy + wy * f.s, s: f.s };
}

export function minimapToWorld(px, py, rect, ww, wh) {
  const f = fit(rect, ww, wh);
  return { x: (px - f.ox) / f.s, y: (py - f.oy) / f.s };
}
