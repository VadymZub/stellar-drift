"""
Scan each sprite sheet with multiple grid candidates and report
the content bounding box per candidate so we can pick the right one.
"""
from PIL import Image
import numpy as np
import os

SRC = r"C:\Work\stellar-drift\client\VFX _1"

# (cols, rows) candidates to evaluate per image
CANDIDATES = {
    "EMP Strike skill.png":          [(4,4)],
    "Engine particle.png":           [(3,4),(3,3)],
    "Hull hit.png":                  [(4,4),(4,3)],
    "Laser beam1.png":               [(4,4),(4,3)],
    "Laser beam2.png":               [(4,4),(4,2)],
    "Plasma bolt.png":               [(4,4),(4,3)],
    "plasma burst skill effect.png": [(4,4),(4,3)],
    "Repair Pulse skill.png":        [(4,4),(4,3)],
    "Targeting reticle.png":         [(4,4),(3,4)],
}

def count_nonbg_pixels(frame_arr, bg, tol=35):
    diff = np.abs(frame_arr.astype(float) - bg).max(axis=-1)
    return int((diff > tol).sum())

def analyze(path, nc, nr, bg):
    img = Image.open(path).convert("RGBA")
    arr = np.array(img)
    h, w = arr.shape[:2]
    fw = w / nc
    fh = h / nr
    results = []
    for row in range(nr):
        for col in range(nc):
            x0 = int(col * fw)
            x1 = int((col+1) * fw)
            y0 = int(row * fh)
            y1 = int((row+1) * fh)
            crop = arr[y0:y1, x0:x1, :]
            npix = count_nonbg_pixels(crop, bg)
            results.append((row, col, npix))
    return results, fw, fh

for fname, cands in CANDIDATES.items():
    path = os.path.join(SRC, fname)
    img = Image.open(path).convert("RGBA")
    arr = np.array(img)
    h, w = arr.shape[:2]
    # Sample corner bg
    corners = [arr[0,0,:3], arr[0,-1,:3], arr[-1,0,:3], arr[-1,-1,:3],
               arr[h//2, 0,:3], arr[0, w//2,:3]]
    bg = np.array(corners, float).mean(axis=0)
    bg4 = np.append(bg, 255)

    print(f"\n{'='*60}")
    print(f"{fname}  {w}x{h}  BG~{bg.astype(int)}")

    for (nc, nr) in cands:
        results, fw, fh = analyze(path, nc, nr, bg4)
        nonempty = sum(1 for _, _, n in results if n > 100)
        frame_info = ""
        for row, col, npix in results:
            if npix < 100:
                frame_info += "[ empty ]  "
            else:
                frame_info += f"[{npix:6d}]  "
            if col == nc-1:
                frame_info += "\n             "
        print(f"  {nc}x{nr} -> {fw:.1f}x{fh:.1f} px/frame   non-empty={nonempty}/{nc*nr}")
        print(f"             {frame_info.rstrip()}")
