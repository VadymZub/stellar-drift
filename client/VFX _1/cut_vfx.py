"""
VFX Sprite Sheet Cutter + Packer  v2
Cuts each sheet into frames, pads uniformly (no content-shift centering),
packs into a horizontal sprite sheet for Phaser.
Output: client/assets/vfx/{name}/ (PNGs) + {name}_sheet.png + vfx_manifest.json
"""
from PIL import Image
import numpy as np
import os, json, math

SRC = r"C:\Work\stellar-drift\client\VFX _1"
DST = r"C:\Work\stellar-drift\client\assets\vfx"

# ── Grid definitions (cols, rows, frame_count, folder) ─────────────────────
GRIDS = {
    "EMP Strike skill.png":          ("emp_strike",        4, 4, 16),
    "Engine particle.png":           ("engine_particle",   3, 4, 12),
    "Hull hit.png":                  ("hull_hit",          4, 4, 16),
    "Laser beam1.png":               ("laser_beam1",       4, 3, 12),
    "Laser beam2.png":               ("laser_beam2",       4, 2,  8),
    "Plasma bolt.png":               ("plasma_bolt",       4, 4, 16),
    "plasma burst skill effect.png": ("plasma_burst",      4, 4, 16),
    "Repair Pulse skill.png":        ("repair_pulse",      4, 4, 16),
    "Targeting reticle.png":         ("targeting_reticle", 4, 4, 16),
}

FPS = {
    "emp_strike": 16, "engine_particle": 12, "hull_hit": 16,
    "laser_beam1": 12, "laser_beam2": 12, "plasma_bolt": 14,
    "plasma_burst": 14, "repair_pulse": 12, "targeting_reticle": 10,
}

TWEEN = {
    "emp_strike":        dict(scaleFrom=0.30, scalePeak=1.10, scaleEnd=0.85, alphaEnd=0.0, introDur=300, outroDur=250, ease="Quint.Out"),
    "engine_particle":   dict(scaleFrom=0.70, scalePeak=1.00, scaleEnd=1.00, alphaEnd=0.6, introDur=200, outroDur=350, ease="Sine.Out"),
    "hull_hit":          dict(scaleFrom=0.40, scalePeak=1.15, scaleEnd=0.90, alphaEnd=0.0, introDur=200, outroDur=280, ease="Back.Out"),
    "laser_beam1":       dict(scaleFrom=0.05, scalePeak=1.00, scaleEnd=0.90, alphaEnd=0.1, introDur=60,  outroDur=200, ease="Expo.Out"),
    "laser_beam2":       dict(scaleFrom=0.20, scalePeak=1.20, scaleEnd=1.00, alphaEnd=0.0, introDur=100, outroDur=200, ease="Back.Out"),
    "plasma_bolt":       dict(scaleFrom=0.30, scalePeak=1.00, scaleEnd=0.95, alphaEnd=0.1, introDur=160, outroDur=280, ease="Sine.Out"),
    "plasma_burst":      dict(scaleFrom=0.25, scalePeak=1.10, scaleEnd=0.90, alphaEnd=0.0, introDur=240, outroDur=300, ease="Quint.Out"),
    "repair_pulse":      dict(scaleFrom=0.45, scalePeak=1.05, scaleEnd=1.00, alphaEnd=0.1, introDur=350, outroDur=400, ease="Sine.InOut"),
    "targeting_reticle": dict(scaleFrom=1.50, scalePeak=1.00, scaleEnd=1.00, alphaEnd=0.8, introDur=500, outroDur=300, ease="Expo.Out"),
}

PAD = 0.10   # padding fraction added on each side of the raw cell


def cut_and_pad(path, nc, nr, nframes, pad=PAD):
    """
    Cut sprite sheet into padded RGBA frames.
    Each raw cell is placed centered on a canvas that is (1 + 2*pad) larger.
    Returns list of PIL Images and the output (fw, fh).
    """
    img = Image.open(path).convert("RGBA")
    W, H = img.size
    arr = np.array(img)

    # Compute cell boundaries using linspace (handles non-integer divisions)
    xs = [int(round(i * W / nc)) for i in range(nc + 1)]
    ys = [int(round(i * H / nr)) for i in range(nr + 1)]

    # Max cell size across all cells (usually uniform, except rounding)
    cell_w = max(xs[c + 1] - xs[c] for c in range(nc))
    cell_h = max(ys[r + 1] - ys[r] for r in range(nr))

    # Output frame size: cell + symmetric padding, rounded to even
    fw = int(math.ceil(cell_w * (1 + 2 * pad) / 2) * 2)
    fh = int(math.ceil(cell_h * (1 + 2 * pad) / 2) * 2)

    frames = []
    for idx in range(nframes):
        row = idx // nc
        col = idx % nc
        x0, x1 = xs[col], xs[col + 1]
        y0, y1 = ys[row], ys[row + 1]
        cell_crop = arr[y0:y1, x0:x1, :]
        cw = x1 - x0
        ch = y1 - y0

        # Place cell centered on the padded canvas
        canvas = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        ox = (fw - cw) // 2
        oy = (fh - ch) // 2
        canvas.paste(Image.fromarray(cell_crop), (ox, oy))
        frames.append(canvas)

    return frames, fw, fh


def pack_sheet(frames, fw, fh):
    """Horizontal sprite sheet: all frames in one row."""
    n = len(frames)
    sheet = Image.new("RGBA", (fw * n, fh), (0, 0, 0, 0))
    for i, img in enumerate(frames):
        sheet.paste(img, (i * fw, 0))
    return sheet


os.makedirs(DST, exist_ok=True)
manifest = {}

for fname, (folder, nc, nr, nframes) in GRIDS.items():
    src_path = os.path.join(SRC, fname)
    print(f"\nProcessing: {fname}")

    frames, fw, fh = cut_and_pad(src_path, nc, nr, nframes)
    print(f"  Grid {nc}x{nr} -> {nframes} frames, output {fw}x{fh} each")

    # Save individual frames
    frame_dir = os.path.join(DST, folder)
    os.makedirs(frame_dir, exist_ok=True)
    for i, img in enumerate(frames):
        img.save(os.path.join(frame_dir, f"frame_{i:02d}.png"))

    # Save sprite sheet
    sheet = pack_sheet(frames, fw, fh)
    sheet_path = os.path.join(DST, f"{folder}_sheet.png")
    sheet.save(sheet_path)
    print(f"  Saved: {folder}_sheet.png  ({fw*nframes}x{fh})")

    manifest[folder] = {
        "sheet":       f"assets/vfx/{folder}_sheet.png",
        "frameWidth":  fw,
        "frameHeight": fh,
        "frameCount":  nframes,
        "fps":         FPS[folder],
        "tween":       TWEEN[folder],
    }

manifest_path = os.path.join(DST, "vfx_manifest.json")
with open(manifest_path, "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2)

print(f"\nManifest: {manifest_path}")
print("Done!")
