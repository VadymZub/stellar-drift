// Pre-render a source texture at exact target size using Canvas 2D.
// Canvas 2D drawImage uses high-quality bicubic/Lanczos interpolation for downscaling,
// which is far superior to WebGL's single-pass bilinear for ratios >2×.
// The resulting texture is displayed 1:1 (no WebGL resampling at all).
export function prerenderTex(scene, srcKey, dw, dh) {
  const cacheKey = `__pre_${srcKey}_${dw}x${dh}`;
  if (scene.textures.exists(cacheKey)) return cacheKey;

  const src = scene.textures.get(srcKey).getSourceImage();
  const tex = scene.textures.createCanvas(cacheKey, dw, dh);
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, dw, dh);
  tex.refresh();
  return cacheKey;
}
