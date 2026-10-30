"""Regenerate the bundled Tailwind utilities without adding runtime dependencies."""
from pathlib import Path
import re
import subprocess
import tempfile

page = Path(__file__).resolve().parents[1] / "index.html"
raw = page.read_bytes()
html = raw.decode().replace("\r\n", "\n")
pattern = r'(<style id="game-utilities">).*?(</style>)'
assert len(re.findall(pattern, html, re.S)) == 1, "Expected one utility style block"
with tempfile.TemporaryDirectory() as folder:
    folder = Path(folder)
    source = folder / "content.html"
    source.write_text(re.sub(pattern, "", html, flags=re.S))
    css_input = folder / "input.css"
    css_input.write_text("@tailwind base;\n@tailwind components;\n@tailwind utilities;\n")
    output = folder / "utilities.css"
    subprocess.run([
        "npm", "exec", "--yes", "--package=tailwindcss@3.4.17", "--",
        "tailwindcss", "--input", str(css_input), "--output", str(output),
        "--content", str(source), "--minify",
    ], check=True)
    css = output.read_text()
html = re.sub(pattern, lambda m: m[1] + css + m[2], html, flags=re.S)
if b"\r\n" in raw:
    html = html.replace("\n", "\r\n")
page.write_bytes(html.encode())
print(f"Bundled {len(css):,} bytes of CSS into {page.name}")
