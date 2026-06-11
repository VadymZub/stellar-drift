"""
Centroid-based re-centering for VFX frames.
For each frame: find the weighted centroid of the brightest pixels (the "hot core"),
then re-paste all frames so their centroids align at one consistent point.

Usage:
  python fix_centering.py emp_strike       <- fix one effect
  python fix_centering.py all              <- fix all effects
"""
from PIL import Image
import numpy as np
import os, sys, json, shutil

SRC_DIR  = r"C:\Work\stellar-drift\client\VFX _1\cleaned"
ASSET    = r"C:\Work\stellar-drift\client\assets\vfx"
MANIFEST = os.path.join(ASSET, "vfx_manifest.json")

GRIDS = {
    "EMP Strike skill.png":          ("emp_strike",        4, 4, 16),  # 1536x1024
    "Engine particle.png":           ("engine_particle",   3, 4, 12),  # 1254x1254
    "Hull hit.png":                  ("hull_hit",          4, 3, 12),  # 1536x1024, 3 rows
    "Laser beam1.png":               ("laser_beam1",       4, 3, 12),  # 1536x1024
    "Laser beam2.png":               ("laser_beam2",       4, 2,  8),  # 1536x1024
    "Plasma bolt.png":               ("plasma_bolt",       4, 4, 16),  # 1536x1024, 4 rows
    "plasma burst skill effect.png": ("plasma_burst",      4, 4, 16),  # 1536x1024, 4 rows
    "Repair Pulse skill.png":        ("repair_pulse",      4, 4, 16),  # 1536x1024, 4 rows
    "Targeting reticle.png":         ("targeting_reticle", 2, 3,  6),  # 1024x1536, 2 cols
}

# ── Per-effect strategy ──────────────────────────────────────────────────────
# 'centroid'  : re-align all frames so their bright-core centroid is at
#               one consistent point. Best for symmetric/spot effects.
# 'simple_pad': just pad the raw cell uniformly. Best for effects where
#               the hot core MOVES as part of the animation (explosions, bolts).
STRATEGY = {
    "emp_strike":        "centroid",   # symmetric lightning, clear drift
    "engine_particle":   "centroid",   # lock onto bright nozzle core to fix Y-drift
    "hull_hit":          "simple_pad", # explosion grows outward from impact point
    "laser_beam1":       "centroid",   # beam flash - symmetric
    "laser_beam2":       "centroid",   # starburst - symmetric
    "plasma_bolt":       "simple_pad", # projectile in flight - directional
    "plasma_burst":      "simple_pad", # plasma ring expands outward
    "repair_pulse":      "centroid",   # ring expands from stable center
    "targeting_reticle": "simple_pad", # reticle centered in original artwork
}

BRIGHT_THR = {
    "emp_strike":        210,
    "engine_particle":   220,  # lock onto bright nozzle tip only
    "laser_beam1":       230,
    "laser_beam2":       200,
    "repair_pulse":      210,
    "targeting_reticle": 180,
}

# fps override per effect
FPS_OVERRIDE = {
    "hull_hit":          12,
    "plasma_bolt":       16,   # 16f @ 16fps = 1.0s
    "plasma_burst":      16,   # 16f @ 16fps = 1.0s
    "repair_pulse":      14,   # 16f @ 14fps = 1.14s
    "targeting_reticle": 8,    # 6f  @  8fps = 0.75s
}

PAD = 0.12   # uniform padding for simple_pad
PAD_C = 0.18  # padding for centroid mode (needs more room for shifted content)


def cut_raw_cells(path, nc, nr, nframes):
    """Return raw RGBA crops (numpy arrays) at original grid boundaries."""
    img = Image.open(path).convert("RGBA")
    arr = np.array(img)
    W, H = img.size
    xs = [int(round(i * W / nc)) for i in range(nc + 1)]
    ys = [int(round(i * H / nr)) for i in range(nr + 1)]
    cells = []
    for idx in range(nframes):
        r, c = divmod(idx, nc)
        cell = arr[ys[r]:ys[r+1], xs[c]:xs[c+1], :].copy()
        cells.append(cell)
    return cells


def find_centroid(cell_arr, thr):
    """
    Weighted centroid of pixels brighter than `thr` (max of RGB channels).
    Falls back to progressively lower thresholds if no pixels qualify.
    Returns (cx, cy) in pixel coords of the cell.
    """
    brightness = cell_arr[:, :, :3].max(axis=-1).astype(float)
    for t in [thr, thr - 30, thr - 60, int(brightness.max() * 0.5), 0]:
        mask = brightness > t
        if mask.sum() > 10:
            ys, xs = np.where(mask)
            w = brightness[mask]
            return float(np.average(xs, weights=w)), float(np.average(ys, weights=w))
    h, w2 = cell_arr.shape[:2]
    return float(w2 / 2), float(h / 2)


def repack(cells, centroids, pad=PAD):
    """
    Re-paste all cells so their centroids line up at a common point.
    Returns (list of PIL Images, output_fw, output_fh, anchor_x, anchor_y).
    """
    cx_arr = np.array([c[0] for c in centroids])
    cy_arr = np.array([c[1] for c in centroids])

    # Stable anchor = median centroid (robust against outliers like frame_00)
    ax = float(np.median(cx_arr))
    ay = float(np.median(cy_arr))

    cell_h, cell_w = cells[0].shape[:2]

    # Compute required canvas size so no content is clipped after any shift
    max_left  = ax + max(0, max(ax - cx for cx, _ in centroids))
    max_right = (cell_w - ax) + max(0, max(cx - ax for cx, _ in centroids))
    max_top   = ay + max(0, max(ay - cy for _, cy in centroids))
    max_bot   = (cell_h - ay) + max(0, max(cy - ay for _, cy in centroids))

    # Content size = bounding box that fits every shifted cell
    content_w = max_left + max_right
    content_h = max_top  + max_bot

    # Add padding, round to even
    fw = int(np.ceil(content_w * (1 + 2 * pad) / 2) * 2)
    fh = int(np.ceil(content_h * (1 + 2 * pad) / 2) * 2)

    # Canvas anchor = where we want the centroid to land
    out_ax = fw // 2
    out_ay = fh // 2

    images = []
    for cell, (cx, cy) in zip(cells, centroids):
        canvas = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        ox = int(round(out_ax - cx))
        oy = int(round(out_ay - cy))
        canvas.paste(Image.fromarray(cell), (ox, oy))
        images.append(canvas)

    return images, fw, fh, out_ax, out_ay


def pack_sheet(frames, fw, fh):
    n = len(frames)
    sheet = Image.new("RGBA", (fw * n, fh), (0, 0, 0, 0))
    for i, img in enumerate(frames):
        sheet.paste(img, (i * fw, 0))
    return sheet


def simple_pad_frames(cells, pad=PAD):
    """Uniform padding only — no content-based shift."""
    import math
    cell_h, cell_w = cells[0].shape[:2]
    fw = int(math.ceil(cell_w * (1 + 2 * pad) / 2) * 2)
    fh = int(math.ceil(cell_h * (1 + 2 * pad) / 2) * 2)
    ox = (fw - cell_w) // 2
    oy = (fh - cell_h) // 2
    images = []
    for cell in cells:
        canvas = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        canvas.paste(Image.fromarray(cell), (ox, oy))
        images.append(canvas)
    return images, fw, fh


def process_effect(folder_name):
    src_entry = None
    for fname, (fold, nc, nr, nframes) in GRIDS.items():
        if fold == folder_name:
            src_entry = (fname, fold, nc, nr, nframes)
            break
    if not src_entry:
        print(f"  ERROR: unknown effect '{folder_name}'"); return

    fname, folder, nc, nr, nframes = src_entry
    src_path = os.path.join(SRC_DIR, fname)
    strategy = STRATEGY.get(folder, "simple_pad")

    print(f"\n[ {folder} ]  strategy={strategy}  grid={nc}x{nr}  frames={nframes}")

    cells = cut_raw_cells(src_path, nc, nr, nframes)

    if strategy == "simple_pad":
        images, fw, fh = simple_pad_frames(cells, pad=PAD)
        print(f"  output frame: {fw}x{fh}  (simple pad {PAD*100:.0f}%)")
    else:
        thr = BRIGHT_THR.get(folder, 200)
        centroids = [find_centroid(c, thr) for c in cells]
        cxs = [c[0] for c in centroids]
        cys = [c[1] for c in centroids]
        print(f"  centroid X range={max(cxs)-min(cxs):.1f}px  Y range={max(cys)-min(cys):.1f}px  thr={thr}")
        images, fw, fh, ax, ay = repack(cells, centroids, pad=PAD_C)
        print(f"  output frame: {fw}x{fh}  anchor=({ax},{ay})")

    # Save individual frames
    frame_dir = os.path.join(ASSET, folder)
    os.makedirs(frame_dir, exist_ok=True)
    for i, img in enumerate(images):
        img.save(os.path.join(frame_dir, f"frame_{i:02d}.png"))

    # Save sprite sheet
    sheet = pack_sheet(images, fw, fh)
    sheet_path = os.path.join(ASSET, f"{folder}_sheet.png")
    sheet.save(sheet_path)
    print(f"  Sheet: {folder}_sheet.png  ({fw*nframes}x{fh})")

    # Update manifest
    with open(MANIFEST, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    manifest[folder]["frameWidth"]  = fw
    manifest[folder]["frameHeight"] = fh
    manifest[folder]["frameCount"]  = nframes
    if folder in FPS_OVERRIDE:
        manifest[folder]["fps"] = FPS_OVERRIDE[folder]
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print(f"  Manifest updated.")


# ── Entry point ──────────────────────────────────────────────────────────────
targets = sys.argv[1:] if len(sys.argv) > 1 else ["emp_strike"]
if targets == ["all"]:
    targets = [fold for _, (fold, *_) in GRIDS.items()]

for t in targets:
    process_effect(t)

print("\nDone!")
