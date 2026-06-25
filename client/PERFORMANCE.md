# Performance Optimisation Notes

## Problem

Visible stutters during:
- Initial boot (1–3 s freeze before title screen)
- Sector / map transitions (`scene.restart()` hitch)
- First gameplay moments after a map load
- Opening Garage / Shop / Corp screens (icon downloads mid-session)

Root cause: 300+ synchronous `prepShipTex` calls at boot, single-threaded HTTP server, and 200+ assets loaded lazily during gameplay instead of at boot.

---

## Changes Made

### 1. Boot — RAF job queue (`BootScene.js`)

`prepShipTex` (canvas step-halving) is CPU-heavy. Running 70+ calls synchronously blocked the main thread for 1–3 s.

**Fix:** spread jobs across `requestAnimationFrame` frames with a 14 ms budget per tick. Progress bar (`#loading-bar`) advances as jobs complete.

```js
const tick = () => {
  const t0 = performance.now();
  while (i < jobs.length && performance.now() - t0 < 14) jobs[i++]();
  if (bar) bar.style.width = `${Math.round(i / jobs.length * 100)}%`;
  if (i < jobs.length) { requestAnimationFrame(tick); return; }
  this._finishCreate();
};
requestAnimationFrame(tick);
```

### 2. Scene transitions — HTML overlay (`index.html` + all scene files)

`scene.restart()` is synchronous — Phaser tears down and rebuilds in one frame. The old Phaser `Graphics` fade-in was drawn after the hitch, making it invisible.

**Fix:** `#scene-overlay` div in `index.html` (CSS `position:fixed`, `z-index:9`). Shown by adding class `.active` (instant black, no render cycle needed) **before** `scene.restart()`. Fades out via CSS transition after the new scene's first tick.

```js
// before restart:
document.getElementById('scene-overlay')?.classList.add('active');
this.scene.restart(...);

// in GameScene.create():
this.time.delayedCall(1, () => {
  document.getElementById('scene-overlay')?.classList.remove('active');
});
```

Applied in: `GameScene`, `CorpScene`, `LoginScene`, `TestProfileScene`.

### 3. Assets at boot, not during gameplay (`BootScene.js`)

All UI backgrounds, module icons, perk images, NPC portraits, ammo icons were loaded lazily during gameplay (first time their screen opened). Each caused a 100–225 ms stall with the stale single-threaded server.

**Fix:** moved all those `load.image()` calls into `BootScene.preload()` so all 200+ HTTP requests fire in parallel at boot.

### 4. Threaded HTTP server (`server.py`)

Python's `socketserver.TCPServer` handles one connection at a time. With 200+ boot assets, each request queued behind the previous one — causing 3–4 s stalls on burst loads.

**Fix:** `ThreadingMixIn` (one thread per connection):

```python
class ThreadedServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True
```

### 5. Idle-callback throttle (`GameScene.js`)

`requestIdleCallback` was batching up to 5 deferred jobs per callback (50–100 ms), causing mid-game frame drops.

**Fix:** exactly 1 job per callback:

```js
requestIdleCallback(() => { jobs[i++](); scheduleNext(); }, { timeout: 400 });
```

---

## Asset Optimisation (`optimize_assets.py`)

One-time script. Run once from `client/`:

```
python optimize_assets.py
```

### What it does

| Directory | Rule | Result |
|---|---|---|
| `maps/*.png` | PNG → JPEG q85, max 2560 px | 6–7 MB → ~900 KB each |
| `UI BACKGROUNDS/*.png` | PNG → JPEG q82, max 1920 px | 2.4 MB → ~300 KB each |
| `mobs/*.png` | PNG resize + recompress, max 512 px | ~2 MB → ~250 KB each |
| `ships/*.png` | PNG resize + recompress, max 512 px | |
| `modules/*.png` | PNG resize + recompress, max 256 px | |
| (etc.) | | |

Converts `.png` → `.jpg` for photographic directories and deletes the original `.png`. Corresponding JS load calls use `.jpg`.

**Total saved: ~244 MB** (from ~300 MB to ~55 MB for processed files).

### ⚠ Do NOT add sprite sheets to optimizer rules

VFX sprite sheets (`vfx/*_sheet.png`) and `ui/arrow_cruise_anim.png` are horizontal strips sliced by a fixed `frameWidth` defined in `vfx_manifest.json` / BootScene. Resizing the image invalidates the frame geometry — Phaser reports "zero frames" and animations break.

These files are already small (10–35 KB each) and must stay at their original dimensions.

---

## File Reference

| File | Change |
|---|---|
| `index.html` | Added `#scene-overlay`, `#loading`, `#loading-bar` |
| `server.py` | `ThreadingMixIn` threaded server |
| `src/scenes/BootScene.js` | RAF job queue, all assets moved to `preload()`, `.jpg` extensions |
| `src/scenes/GameScene.js` | HTML overlay on restart, 1-job idle callback, `.jpg` map extension |
| `src/scenes/CorpScene.js` | HTML overlay before `scene.restart()` |
| `src/scenes/LoginScene.js` | HTML overlay before `scene.start()` |
| `src/scenes/TestProfileScene.js` | HTML overlay before scene launch |
| `optimize_assets.py` | One-time asset optimizer (do not re-run unless assets are replaced) |
