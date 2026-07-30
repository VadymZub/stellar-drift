#!/usr/bin/env python3
"""Sets src-tauri/tauri.conf.json + Cargo.toml version to 1.1.<git commit count>.
Run before cutting a release so the tag and the in-app version never drift apart."""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TAURI_CONF = ROOT / "src-tauri" / "tauri.conf.json"
CARGO_TOML = ROOT / "src-tauri" / "Cargo.toml"


def commit_count() -> int:
    out = subprocess.run(
        ["git", "rev-list", "--count", "HEAD"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    )
    return int(out.stdout.strip())


def main() -> str:
    version = f"1.1.{commit_count()}"

    conf = json.loads(TAURI_CONF.read_text(encoding="utf-8"))
    conf["version"] = version
    TAURI_CONF.write_text(json.dumps(conf, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    cargo = CARGO_TOML.read_text(encoding="utf-8")
    cargo = re.sub(r'^version = ".*"', f'version = "{version}"', cargo, count=1, flags=re.MULTILINE)
    CARGO_TOML.write_text(cargo, encoding="utf-8")

    print(version)
    return version


if __name__ == "__main__":
    main()
