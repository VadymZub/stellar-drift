"""
Analyze sprite sheet grids by detecting background separators.
"""
from PIL import Image
import numpy as np
import os

SRC = r"C:\Work\stellar-drift\client\VFX _1"

sheets = {
    "EMP Strike skill.png":         None,
    "Engine particle.png":          None,
    "Hull hit.png":                 None,
    "Laser beam1.png":              None,
    "Laser beam2.png":              None,
    "Plasma bolt.png":              None,
    "plasma burst skill effect.png":None,
    "Repair Pulse skill.png":       None,
    "Targeting reticle.png":        None,
}

def get_bg_color(arr):
    """Sample corners to estimate background color (RGBA mean)."""
    corners = [arr[0,0], arr[0,-1], arr[-1,0], arr[-1,-1]]
    return np.array(corners).mean(axis=0)

def score_divider_col(arr, x, bg, tol=40):
    """How 'background-like' is column x (0..1)."""
    col = arr[:, x, :3].astype(float)
    diff = np.abs(col - bg[:3]).max(axis=1)
    return (diff < tol).mean()

def score_divider_row(arr, y, bg, tol=40):
    row = arr[y, :, :3].astype(float)
    diff = np.abs(row - bg[:3]).max(axis=1)
    return (diff < tol).mean()

def find_grid(arr, bg, candidate_cols, candidate_rows):
    """Try all candidate (cols, rows) and score dividers."""
    h, w = arr.shape[:2]
    best = None
    best_score = -1
    for nc in candidate_cols:
        for nr in candidate_rows:
            fw = w / nc
            fh = h / nr
            scores = []
            # Score vertical dividers
            for i in range(1, nc):
                x = int(i * fw)
                if x < w:
                    scores.append(score_divider_col(arr, x, bg))
            # Score horizontal dividers
            for j in range(1, nr):
                y = int(j * fh)
                if y < h:
                    scores.append(score_divider_row(arr, y, bg))
            s = np.mean(scores) if scores else 0
            if s > best_score:
                best_score = s
                best = (nc, nr, fw, fh, s)
    return best

for fname in sheets:
    path = os.path.join(SRC, fname)
    img = Image.open(path).convert("RGBA")
    arr = np.array(img)
    h, w = arr.shape[:2]
    bg = get_bg_color(arr)

    # Try common grid candidates
    cols_cand = [2, 3, 4, 5, 6]
    rows_cand = [2, 3, 4, 5, 6]
    nc, nr, fw, fh, score = find_grid(arr, bg, cols_cand, rows_cand)

    print(f"{fname}")
    print(f"  Image: {w}x{h}  BG~{bg[:3].astype(int)}")
    print(f"  Best grid: {nc} cols x {nr} rows  -> {fw:.1f}x{fh:.1f} per frame  (divider score={score:.2f})")
    print()
