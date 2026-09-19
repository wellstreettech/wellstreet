#!/usr/bin/env python3
"""Step 2 of the whitepaper PDF build: HTML -> site/whitepaper.pdf.

Input: the HTML written by `node scripts/whitepaper_pdf.js > /tmp/wellstreet-whitepaper.html`.
Output: site/whitepaper.pdf (served at wellstreet.tech/whitepaper.pdf).

Playwright PDF with an A4 page box + a page-number footer. Run from the repo root.
"""
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
HTML = Path("/tmp/wellstreet-whitepaper.html")
OUT = ROOT / "site" / "whitepaper.pdf"

if not HTML.exists():
    sys.exit("missing /tmp/wellstreet-whitepaper.html — run: node scripts/whitepaper_pdf.js > /tmp/wellstreet-whitepaper.html")

sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip() or "unknown"

footer = (
    '<div style="width:100%; font-family: monospace; font-size:7.5px; color:#0A0E12;'
    ' padding: 0 17mm; display:flex; justify-content:space-between; align-items:center;">'
    '<span>wellstreet.tech &middot; checkable, not sellable</span>'
    '<span>build ' + sha + ' &middot; page '
    '<span class="pageNumber"></span>/<span class="totalPages"></span></span>'
    '</div>'
)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto(f"file://{HTML}")
    page.wait_for_timeout(900)  # let the local webfonts settle
    page.pdf(
        path=str(OUT),
        format="A4",
        print_background=True,
        prefer_css_page_size=True,
        display_header_footer=True,
        header_template="<span></span>",
        footer_template=footer,
        margin={"top": "20mm", "bottom": "22mm", "left": "17mm", "right": "17mm"},
    )
    browser.close()

print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
