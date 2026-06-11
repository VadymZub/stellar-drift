import os
import struct

def get_image_info(data):
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        w, h = struct.unpack('>LL', data[16:24])
        return int(w), int(h)
    return None

vfx_dir = "VFX _1"
for f in os.listdir(vfx_dir):
    if f.endswith(".png"):
        path = os.path.join(vfx_dir, f)
        with open(path, 'rb') as img_file:
            data = img_file.read(24)
            info = get_image_info(data)
            if info:
                print(f"{f}: {info[0]}x{info[1]}")
