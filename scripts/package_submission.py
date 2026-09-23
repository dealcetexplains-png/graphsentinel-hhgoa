"""Create a secret-free, reproducible hackathon submission archive."""

from __future__ import annotations

import hashlib
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "submission" / "GraphSentinel-HHGOA.zip"
INCLUDE_ROOTS = [
    ".env.example", ".gitignore", "README.md", "SUBMISSION_CHECKLIST.md", "index.html",
    "package.json", "package-lock.json", "pnpm-lock.yaml", "tsconfig.app.json", "tsconfig.json",
    "tsconfig.node.json", "vite.config.ts", "src", "server", "scripts", "tigergraph", "mcp",
    "output/hhgoa", "data/hhgoa", "docs/README.md", "submission/GraphSentinel-Hackathon-Deck.pptx",
    "submission/DEMO_SCRIPT.md",
]
EXCLUDED_PARTS = {"node_modules", "dist", "tmp", "__pycache__"}
EXCLUDED_SUFFIXES = {".pyc", ".tsbuildinfo", ".crdownload"}


def candidates():
    for entry in INCLUDE_ROOTS:
        path = ROOT / entry
        if path.is_file():
            yield path
        elif path.is_dir():
            yield from path.rglob("*")


def allowed(path: Path) -> bool:
    relative = path.relative_to(ROOT)
    if not path.is_file() or any(part in EXCLUDED_PARTS for part in relative.parts):
        return False
    if path.suffix in EXCLUDED_SUFFIXES or path.name.startswith(".env.") and path.name != ".env.example":
        return False
    if path.name in {".env", ".env.local"} or ("docs" in relative.parts and path.suffix == ".csv"):
        return False
    return True


def main() -> None:
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    files = sorted({path for path in candidates() if allowed(path)})
    with zipfile.ZipFile(DESTINATION, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            archive.write(path, Path("GraphSentinel-HHGOA") / path.relative_to(ROOT))
    digest = hashlib.sha256(DESTINATION.read_bytes()).hexdigest()
    checksum = DESTINATION.with_suffix(".zip.sha256")
    checksum.write_text(f"{digest}  {DESTINATION.name}\n", encoding="utf-8")
    print(f"Created {DESTINATION} with {len(files)} files ({DESTINATION.stat().st_size / 1024 / 1024:.2f} MB)")
    print(f"SHA-256 {digest}")


if __name__ == "__main__":
    main()
