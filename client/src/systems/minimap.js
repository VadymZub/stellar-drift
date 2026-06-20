import { MINIMAP } from '../constants.js';

// Миникарта — векторные блипы (не камера): резкая при любом DPR/рендер-конфиге.
// Геометрия общая для рисования (HudScene) и клик-навигации (GameScene).

// Прямоугольник миникарты на экране (правый верх). scene.scale.width одинаков во всех сценах.
// dims — опционально переопределяет размеры из settings (getMinimapDims).
export function minimapRect(scene, dims) {
  const d = dims || MINIMAP;
  return { x: scene.scale.width - d.w - d.pad, y: d.pad, w: d.w, h: d.h };
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
