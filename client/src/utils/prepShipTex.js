// Step-halves a texture from its current size to targetMax px on the longest side.
// Each pass is ≤2× reduction with imageSmoothingQuality:'high' (equivalent to Lanczos).
// Replaces the Phaser texture in-place and sets LINEAR filter.
export function prepShipTex(scene, key, targetMax) {
  const tex = scene.textures.get(key);
  if (!tex) return;
  const img = tex.getSourceImage();
  if (!img) return;
  const sw = img.naturalWidth  != null ? img.naturalWidth  : img.width;
  const sh = img.naturalHeight != null ? img.naturalHeight : img.height;
  if (!sw || !sh || Math.max(sw, sh) <= targetMax) return;

  const scale = targetMax / Math.max(sw, sh);
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);

  let src = img, cw = sw, ch = sh;
  while (cw > dw * 2 || ch > dh * 2) {
    const hw = Math.max(dw, Math.ceil(cw / 2));
    const hh = Math.max(dh, Math.ceil(ch / 2));
    const tmp = document.createElement('canvas');
    tmp.width = hw; tmp.height = hh;
    const c = tmp.getContext('2d');
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(src, 0, 0, hw, hh);
    src = tmp; cw = hw; ch = hh;
  }

  scene.textures.remove(key);
  const newTex = scene.textures.createCanvas(key, dw, dh);
  const ctx = newTex.getContext();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, dw, dh);
  newTex.refresh();
  newTex.setFilter(0); // FilterMode.LINEAR
}

// Removes near-white background pixels (threshold 240) from a canvas texture.
// Used for badge-style perk images that ship with a white background.
export function removeWhiteBg(scene, key, threshold = 240) {
  const tex = scene.textures.get(key);
  if (!tex) return;
  const ctx = tex.getContext?.();
  if (!ctx) return;
  const src = tex.getSourceImage();
  const w = src.naturalWidth != null ? src.naturalWidth : src.width;
  const h = src.naturalHeight != null ? src.naturalHeight : src.height;
  if (!w || !h) return;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > threshold && d[i + 1] > threshold && d[i + 2] > threshold) d[i + 3] = 0;
  }
  ctx.putImageData(imgData, 0, 0);
  tex.refresh();
}
