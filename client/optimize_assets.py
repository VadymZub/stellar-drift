#!/usr/bin/env python3
"""
One-time asset optimizer for Stellar Drift.
Resizes PNG files to their actual display size and re-saves with maximum
PNG compression. Reduces total asset footprint by 5-15x.

Photographic assets (maps, UI backgrounds) are converted to JPEG for 10-15x
savings vs PNG. The corresponding .png files are deleted after conversion.

Run from the client/ directory:
    python optimize_assets.py
"""
import io, os, sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).parent / 'assets'

# max_px: longest side the game will ever display this asset at.
# Rule order matters — first match wins.
RULES = [
    ('mobs/*.png',                512),   # displayed at 50-200px, max boss ~400px
    ('ships/*.png',               512),   # displayed at 100-200px; garage art at 223px
    ('modules/*.png',             256),   # displayed at 96px
    ('ammo/*.png',                512),
    ('perks/*.png',               800),   # displayed at 384px
    ('npc/*.png',                1024),   # displayed at 432px
    ('skills/*.png',              256),   # displayed at 96px
    ('ranks/*.png',               128),   # displayed at 44px
    ('corps/*.png',               128),   # displayed at 36px
    ('consumables/*.png',         256),
    ('bases/*.png',               512),
    ('ui/*.png',                  256),
    ('structures/*.png',          512),
    # NOTE: vfx/*_sheet.png and ui/arrow_cruise_anim.png are spritesheets — do NOT resize
    # them here. Resizing breaks frameWidth/frameHeight slicing in vfx_manifest.json.
]

# Photographic content — convert to JPEG (no alpha, 8-15x savings over PNG).
# The .png source is deleted after a successful .jpg write.
JPEG_RULES = [
    ('maps/*.png',               2560, 85),   # cover-fit 1920x1080 @ 1.3x zoom
    ('UI BACKGROUNDS/*.png',     1920, 82),   # full-screen overlays
]

def process_png(path: Path, max_px: int) -> tuple[int, int]:
    """Resize if needed and re-compress PNG. Returns (old_bytes, new_bytes) or (0,0) if no gain."""
    old_size = path.stat().st_size
    with Image.open(path) as img:
        w, h = img.size
        resized = False
        if max(w, h) > max_px:
            scale = max_px / max(w, h)
            new_w, new_h = max(1, int(w * scale)), max(1, int(h * scale))
            img = img.resize((new_w, new_h), Image.LANCZOS)
            resized = True
        buf = io.BytesIO()
        img.save(buf, 'PNG', optimize=True, compress_level=9)
        data = buf.getvalue()

    new_size = len(data)
    if new_size >= old_size:
        if not resized:
            return 0, 0
    path.write_bytes(data)
    return old_size, new_size

def process_jpeg(path: Path, max_px: int, quality: int) -> tuple[int, int]:
    """Convert PNG to JPEG, resize if needed. Deletes original .png. Returns (old_bytes, new_bytes)."""
    old_size = path.stat().st_size
    jpg_path = path.with_suffix('.jpg')
    # Skip if .jpg already exists and is newer than .png
    if jpg_path.exists() and jpg_path.stat().st_mtime >= path.stat().st_mtime:
        path.unlink()
        return 0, 0
    with Image.open(path) as img:
        w, h = img.size
        if max(w, h) > max_px:
            scale = max_px / max(w, h)
            new_w, new_h = max(1, int(w * scale)), max(1, int(h * scale))
            img = img.resize((new_w, new_h), Image.LANCZOS)
        rgb = img.convert('RGB')
        buf = io.BytesIO()
        rgb.save(buf, 'JPEG', quality=quality, optimize=True, progressive=True)
        data = buf.getvalue()

    jpg_path.write_bytes(data)
    path.unlink()  # remove the original .png
    return old_size, len(data)

def main():
    total_old = total_new = 0
    results = []
    skipped = 0

    for pattern, max_px, quality in JPEG_RULES:
        for path in sorted(ROOT.glob(pattern)):
            if not path.is_file():
                continue
            old, new = process_jpeg(path, max_px, quality)
            if old == 0:
                skipped += 1
                continue
            results.append((old - new, path.with_suffix('.jpg').relative_to(ROOT), old, new))
            total_old += old
            total_new += new

    for pattern, max_px in RULES:
        for path in sorted(ROOT.glob(pattern)):
            if not path.is_file():
                continue
            old, new = process_png(path, max_px)
            if old == 0:
                skipped += 1
                continue
            results.append((old - new, path.relative_to(ROOT), old, new))
            total_old += old
            total_new += new

    results.sort(reverse=True)
    for saved, rel, old, new in results[:40]:
        print(f"  {str(rel):<55} {old//1024:>6} KB -> {new//1024:>5} KB  (-{saved//1024} KB)")

    if len(results) > 40:
        print(f"  ... and {len(results)-40} more")

    print()
    print(f"Optimized : {len(results)} files")
    print(f"Skipped   : {skipped} (already converted or no improvement)")
    print(f"Before    : {total_old/1024/1024:.1f} MB")
    print(f"After     : {total_new/1024/1024:.1f} MB")
    print(f"Saved     : {(total_old-total_new)/1024/1024:.1f} MB  "
          f"({100*(total_old-total_new)/max(total_old,1):.0f}%)")

if __name__ == '__main__':
    if not ROOT.exists():
        print('Run from the client/ directory'); sys.exit(1)
    print(f'Optimizing assets in {ROOT} ...\n')
    main()
