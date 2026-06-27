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

// Removes near-white background pixels from a canvas texture using edge flood-fill.
// Only pixels reachable from the image border are removed — interior white art is preserved.
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

  const isWhite = (px) => d[px] > threshold && d[px + 1] > threshold && d[px + 2] > threshold && d[px + 3] > 0;

  // Flood-fill BFS from all border pixels — only background white is removed.
  const visited = new Uint8Array(w * h);
  const queue = [];
  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) {
      const idx = y * w + x;
      if (!visited[idx] && isWhite(idx * 4)) { visited[idx] = 1; queue.push(idx); }
    }
  }
  for (let y = 1; y < h - 1; y++) {
    for (const x of [0, w - 1]) {
      const idx = y * w + x;
      if (!visited[idx] && isWhite(idx * 4)) { visited[idx] = 1; queue.push(idx); }
    }
  }
  let qi = 0;
  while (qi < queue.length) {
    const idx = queue[qi++];
    d[idx * 4 + 3] = 0;
    const x = idx % w, y = (idx / w) | 0;
    if (y > 0)     { const n = idx - w; if (!visited[n] && isWhite(n * 4)) { visited[n] = 1; queue.push(n); } }
    if (y < h - 1) { const n = idx + w; if (!visited[n] && isWhite(n * 4)) { visited[n] = 1; queue.push(n); } }
    if (x > 0)     { const n = idx - 1; if (!visited[n] && isWhite(n * 4)) { visited[n] = 1; queue.push(n); } }
    if (x < w - 1) { const n = idx + 1; if (!visited[n] && isWhite(n * 4)) { visited[n] = 1; queue.push(n); } }
  }

  ctx.putImageData(imgData, 0, 0);
  tex.refresh();
}
