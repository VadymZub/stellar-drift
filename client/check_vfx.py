import os
from PIL import Image

vfx_dir = "VFX _1"
files = [f for f in os.listdir(vfx_dir) if f.endswith(".png")]

for f in files:
    path = os.path.join(vfx_dir, f)
    with Image.open(path) as img:
        print(f"{f}: {img.size[0]}x{img.size[1]}")
