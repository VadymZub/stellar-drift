"""Generate small preview images with grid lines overlaid for visual confirmation."""
from PIL import Image, ImageDraw
import os

SRC = r"C:\Work\stellar-drift\client\VFX _1"
OUT = os.path.join(SRC, "grid_preview")
os.makedirs(OUT, exist_ok=True)

# (cols, rows) for each sheet - candidates to draw
CANDIDATES = {
    "EMP Strike skill.png":          [(4,4)],
    "Engine particle.png":           [(3,4)],
    "Hull hit.png":                  [(4,4),(4,3)],
    "Laser beam1.png":               [(4,4),(4,3)],
    "Laser beam2.png":               [(4,2)],
    "Plasma bolt.png":               [(4,4),(4,3)],
    "plasma burst skill effect.png": [(4,4),(4,3)],
    "Repair Pulse skill.png":        [(4,4),(4,3)],
    "Targeting reticle.png":         [(4,4)],
}

SCALE = 6  # shrink by this factor for preview

for fname, cands in CANDIDATES.items():
    src = Image.open(os.path.join(SRC, fname)).convert("RGBA")
    W, H = src.size
    pw, ph = W // SCALE, H // SCALE
    base = src.resize((pw, ph), Image.LANCZOS)

    for (nc, nr) in cands:
        img = base.copy().convert("RGB")
        draw = ImageDraw.Draw(img)
        fw = pw / nc
        fh = ph / nr
        # Draw red grid lines
        for c in range(1, nc):
            x = int(c * fw)
            draw.line([(x,0),(x,ph)], fill=(255,50,50), width=1)
        for r in range(1, nr):
            y = int(r * fh)
            draw.line([(0,y),(pw,y)], fill=(255,50,50), width=1)
        # Label each cell
        for r in range(nr):
            for c in range(nc):
                n = r*nc + c + 1
                x = int(c*fw + 3)
                y = int(r*fh + 3)
                draw.text((x,y), str(n), fill=(255,255,0))

        stem = os.path.splitext(fname)[0]
        safe = stem.replace(" ", "_").replace("/","_")
        out_name = f"{safe}__{nc}x{nr}.png"
        img.save(os.path.join(OUT, out_name))
        print(f"Saved: {out_name}  ({nc}x{nr}, {fw:.1f}x{fh:.1f} per frame)")
