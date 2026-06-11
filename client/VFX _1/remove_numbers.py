"""
Remove frame-number watermarks from sprite sheets.
Strategy: for each cell, scan the top-left patch area and zero the alpha only
for pixels whose RGB is close to the background color (digits = background RGB
but opaque). Dark content (smoke, fire, bolts) is left untouched.

Usage:
  python remove_numbers.py emp_strike
  python remove_numbers.py all
"""
from PIL import Image
import numpy as np
import os, sys, shutil

SRC_DIR = r"C:\Work\stellar-drift\client\VFX _1"
OUT_DIR = r"C:\Work\stellar-drift\client\VFX _1\cleaned"

# Effects where content fills the top-left corner at full size — skip, handle manually
SKIP = {"engine_particle"}

GRIDS = {
    "EMP Strike skill.png":          ("emp_strike",        4, 4, 16),
    "Engine particle.png":           ("engine_particle",   3, 4, 12),
    "Hull hit.png":                  ("hull_hit",          4, 3, 12),
    "Laser beam1.png":               ("laser_beam1",       4, 3, 12),
    "Laser beam2.png":               ("laser_beam2",       4, 2,  8),
    "Plasma bolt.png":               ("plasma_bolt",       4, 4, 16),
    "plasma burst skill effect.png": ("plasma_burst",      4, 4, 16),
    "Repair Pulse skill.png":        ("repair_pulse",      4, 4, 16),
    "Targeting reticle.png":         ("targeting_reticle", 2, 3,  6),
}

# Patch region covering digit in top-left of each cell (conservative max).
PATCH_W = 160
PATCH_H = 150
# Colour-distance tolerance: pixels within this delta of background RGB are treated as digits.
RGB_TOL = 50


def erase_digit(cell_arr, pw, ph, tol=RGB_TOL):
    """
    Zero the alpha ONLY for patch pixels whose RGB matches the background colour.
    Background is sampled from the top-right corner (same rows, mirrored X).
    Dark content (smoke, fire, bolts) differs from background → untouched.
    """
    h, w = cell_arr.shape[:2]
    pw = min(pw, w // 2)
    ph = min(ph, h // 2)

    # Sample background RGB from top-right corner
    bg_sample = cell_arr[:ph, w - pw:w, :3].reshape(-1, 3).astype(float)
    bg_rgb = np.median(bg_sample, axis=0)          # (3,)

    # Patch region as view
    patch = cell_arr[:ph, :pw, :]

    # Per-pixel max-channel distance from background
    dist = np.abs(patch[:, :, :3].astype(float) - bg_rgb).max(axis=-1)  # (ph, pw)

    # Pixels close to background AND visible → digit watermark → erase
    is_digit = (dist <= tol) & (patch[:, :, 3] > 0)
    patch[:, :, 3] = np.where(is_digit, 0, patch[:, :, 3])

    n_erased = int(is_digit.sum())
    return n_erased


def process(folder_name):
    src_entry = None
    for fname, (fold, nc, nr, nframes) in GRIDS.items():
        if fold == folder_name:
            src_entry = (fname, fold, nc, nr, nframes)
            break
    if not src_entry:
        print(f"  Unknown: {folder_name}"); return

    fname, folder, nc, nr, nframes = src_entry
    src_path = os.path.join(SRC_DIR, fname)

    if folder in SKIP:
        os.makedirs(OUT_DIR, exist_ok=True)
        shutil.copy2(src_path, os.path.join(OUT_DIR, fname))
        print(f"\n[ {folder} ]  SKIPPED — copied original to cleaned/")
        return os.path.join(OUT_DIR, fname)

    print(f"\n[ {folder} ]  {nc}x{nr}  {fname}")

    img = Image.open(src_path).convert("RGBA")
    arr = np.array(img).copy()
    W, H = img.size
    xs = [int(round(i * W / nc)) for i in range(nc + 1)]
    ys = [int(round(j * H / nr)) for j in range(nr + 1)]

    total_erased = 0
    for idx in range(nframes):
        r, c = divmod(idx, nc)
        x0, x1 = xs[c], xs[c + 1]
        y0, y1 = ys[r], ys[r + 1]
        cell = arr[y0:y1, x0:x1, :]
        n = erase_digit(cell, PATCH_W, PATCH_H)
        total_erased += n
        if idx < 4:
            print(f"  frame {idx:02d}  erased_pixels={n}")

    print(f"  Total erased: {total_erased} pixels across {nframes} frames")
    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, fname)
    Image.fromarray(arr).save(out_path)
    print(f"  Saved: cleaned/{fname}")
    return out_path


targets = sys.argv[1:] if len(sys.argv) > 1 else ["emp_strike"]
if targets == ["all"]:
    targets = [fold for _, (fold, *_) in GRIDS.items()]

for t in targets:
    process(t)

print("\nDone!")
