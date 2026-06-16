"""
Resize ship game sprites to displaySize * 4
(covers DPR=2 + zoom=2x without quality loss).
Garage art (*_g.png) is left untouched.
Originals are backed up to assets/ships/originals/.
"""
from pathlib import Path
from PIL import Image
import shutil

SHIPS_DIR = Path(__file__).parent / 'assets' / 'ships'
BACKUP_DIR = SHIPS_DIR / 'originals'

# displaySize from ships.js (max dimension in world units)
DISPLAY_SIZES = {
    'wisp':     77,
    'stiletto': 120,
    'anvil':    110,
    'drover':   147,
    'aegis':    155,
    'phantom':  147,
    'helion':   156,
    'argosy':   140,
    'drifter':  147,
}

ZOOM_MULTIPLIER = 4  # DPR=2 × maxZoom=2

BACKUP_DIR.mkdir(exist_ok=True)

for key, display_size in DISPLAY_SIZES.items():
    src = SHIPS_DIR / f'{key}.png'
    if not src.exists():
        print(f'  SKIP  {src.name} — not found')
        continue

    img = Image.open(src).convert('RGBA')
    w, h = img.size
    target_max = display_size * ZOOM_MULTIPLIER

    if max(w, h) <= target_max:
        print(f'  OK    {src.name}  {w}x{h} — already <= target {target_max}px')
        continue

    # Proportional resize: longest side → target_max
    scale = target_max / max(w, h)
    new_w = max(1, round(w * scale))
    new_h = max(1, round(h * scale))

    # Backup original
    backup = BACKUP_DIR / src.name
    if not backup.exists():
        shutil.copy2(src, backup)

    resized = img.resize((new_w, new_h), Image.LANCZOS)
    resized.save(src, optimize=True)
    print(f'  DONE  {src.name}  {w}x{h} -> {new_w}x{new_h}  (target {target_max}px)')

print('\nDone. Originals saved to assets/ships/originals/')
