// Pre-render a source texture at exact target size using Canvas 2D.
// Uses step-halving (each pass ≤ 2× reduction) before the final draw — same technique
// as _prepShipTex in BootScene. Avoids the softness of a single large-ratio drawImage
// (e.g. drover_g 1672px → 203px in one pass = visibly blurry).
export function prerenderTex(scene, srcKey, dw, dh) {
  const cacheKey = `__pre_${srcKey}_${dw}x${dh}`;
  if (scene.textures.exists(cacheKey)) return cacheKey;

  const src = scene.textures.get(srcKey).getSourceImage();
  const sw = src.naturalWidth  != null ? src.naturalWidth  : src.width;
  const sh = src.naturalHeight != null ? src.naturalHeight : src.height;

  // Step-halve until within 2× of target
  let cur = src, cw = sw, ch = sh;
  while (cw > dw * 2 || ch > dh * 2) {
    const hw = Math.max(dw, Math.ceil(cw / 2));
    const hh = Math.max(dh, Math.ceil(ch / 2));
    const tmp = document.createElement('canvas');
    tmp.width = hw; tmp.height = hh;
    const c = tmp.getContext('2d');
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(cur, 0, 0, hw, hh);
    cur = tmp; cw = hw; ch = hh;
  }

  const tex = scene.textures.createCanvas(cacheKey, dw, dh);
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, dw, dh);
  tex.refresh();
  return cacheKey;
}
