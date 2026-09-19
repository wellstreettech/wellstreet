'use strict';
// Whitepaper PDF build — renders docs/public/whitepaper.md through the site's
// OWN markdown renderer (site/js/docs.js — the same bytes the docs tab shows),
// wraps it in the paper-pole print template, and writes the HTML that
// scripts build step 2 turns into site/whitepaper.pdf via playwright.
//
//   node scripts/whitepaper_pdf.js > /tmp/wellstreet-whitepaper.html
//   python3 scripts/whitepaper_pdf_render.py
//
// LOCKSTEP (same ceremony as skills/registry.json): any edit to
// docs/public/whitepaper.md ⇒ re-run BOTH steps and commit the refreshed
// site/whitepaper.pdf in the same change. site-tests/whitepaper.test.js
// asserts the PDF artifact + the md's PDF link line exist together.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const docs = require('../site/js/docs.js');

const ROOT = path.join(__dirname, '..');
const MD_PATH = path.join(ROOT, 'docs', 'public', 'whitepaper.md');
const FONT_DIR = path.join(ROOT, 'site', 'fonts');

const md = fs.readFileSync(MD_PATH, 'utf8');
const body = docs.renderMarkdown(md);

let sha = 'unknown';
try { sha = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch (e) { /* non-repo render */ }

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>The Wellstreet Whitepaper</title>
<style>
  @font-face {
    font-family: 'Doto';
    src: url('file://${FONT_DIR}/doto-var.ttf') format('truetype');
    font-weight: 100 900;
  }
  @font-face {
    font-family: 'Garamond';
    src: url('file://${FONT_DIR}/eb-garamond-latin-var.woff2') format('woff2');
    font-weight: 100 900;
  }
  @font-face {
    font-family: 'Inter';
    src: url('file://${FONT_DIR}/inter-latin-var.woff2') format('woff2');
    font-weight: 100 900;
  }
  @page { size: A4; margin: 20mm 17mm 22mm 17mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    background: #EDE9DC;
    color: #0A0E12;
    font-family: 'Garamond', Georgia, serif;
    font-size: 11.5pt;
    line-height: 1.58;
  }
  /* ── cover: the dark pole ─────────────────────────────────────────── */
  .cover {
    page-break-after: always;
    height: 251mm;
    overflow: hidden;
    background: #0A0E12;
    color: #EDE9DC;
    border: 2px solid #EDE9DC;
    padding: 15mm 14mm;
    position: relative;
    background-image: radial-gradient(circle, rgba(237,233,220,0.05) 1.1px, transparent 1.3px);
    background-size: 15px 15px;
    display: flex;
    flex-direction: column;
  }
  .cover .kicker {
    font-family: 'Inter', sans-serif;
    font-size: 9pt;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: #EDE9DC;
    opacity: 0.75;
  }
  .cover h1 {
    font-family: 'Doto', monospace;
    font-variation-settings: 'ROND' 100;
    font-weight: 800;
    font-size: 58pt;
    line-height: 1.02;
    margin: 14mm 0 0 0;
    letter-spacing: 0.01em;
  }
  .cover .subtitle {
    font-family: 'Doto', monospace;
    font-variation-settings: 'ROND' 100;
    font-weight: 500;
    font-size: 17pt;
    margin-top: 6mm;
    max-width: 150mm;
    line-height: 1.35;
  }
  .cover .accent-rule {
    width: 42mm; height: 3px; background: #E8A33D; margin-top: 10mm;
  }
  .cover .meta {
    margin-top: auto;
    font-family: 'Inter', sans-serif;
    font-size: 9.5pt;
    line-height: 2.0;
    border-top: 2px solid #EDE9DC;
    padding-top: 6mm;
  }
  .cover .meta .amber { color: #E8A33D; }
  .cover .foot {
    font-family: 'Inter', sans-serif;
    font-size: 8pt;
    opacity: 0.72;
    margin-top: 6mm;
    line-height: 1.5;
  }
  /* ── body: the paper pole ─────────────────────────────────────────── */
  main { display: block; }
  h1 {
    font-family: 'Doto', monospace;
    font-variation-settings: 'ROND' 100;
    font-weight: 800;
    font-size: 23pt;
    margin: 0 0 2mm 0;
  }
  main > p:first-of-type {
    font-family: 'Inter', sans-serif;
    font-size: 9.5pt;
    border-bottom: 2px solid #0A0E12;
    padding-bottom: 4mm;
    margin-bottom: 6mm;
  }
  h2 {
    page-break-before: always;
    font-family: 'Doto', monospace;
    font-variation-settings: 'ROND' 100;
    font-weight: 700;
    font-size: 16.5pt;
    border-top: 2.5px solid #0A0E12;
    padding-top: 3.5mm;
    margin: 0 0 4mm 0;
  }
  main > h2:first-of-type { page-break-before: auto; }
  h2::before { content: ''; }
  h3 {
    font-family: 'Inter', sans-serif;
    font-weight: 700;
    font-size: 11pt;
    margin: 6mm 0 2mm 0;
  }
  p { margin: 0 0 3.2mm 0; text-align: justify; }
  strong { font-weight: 700; }
  a { color: #0A0E12; text-decoration: underline; text-decoration-color: #E8A33D; text-decoration-thickness: 1.5px; }
  ul { margin: 0 0 3.5mm 0; padding-left: 6mm; }
  li { margin-bottom: 1.8mm; }
  pre {
    page-break-inside: avoid;
    font-family: 'Inter', ui-monospace, monospace;
    font-size: 8.6pt;
    line-height: 1.5;
    background: #E4DFCF;
    border: 2px solid #0A0E12;
    border-left: 4px solid #E8A33D;
    padding: 3.5mm 4mm;
    margin: 3.5mm 0 4mm 0;
    white-space: pre-wrap;
  }
  code {
    font-family: 'Inter', ui-monospace, monospace;
    font-size: 9pt;
    background: #E4DFCF;
    padding: 0 1mm;
  }
  pre code { background: none; padding: 0; font-size: 8.6pt; }
  blockquote { border-left: 4px solid #E8A33D; margin: 3mm 0; padding-left: 4mm; }
</style>
</head>
<body>
  <section class="cover">
    <div class="kicker">Whitepaper &middot; chain 4663</div>
    <h1>WELLSTREET</h1>
    <div class="subtitle">An agent-native liquidity layer for Robinhood Chain.</div>
    <div class="accent-rule"></div>
    <div class="meta">
      Version 1.0 &middot; 2026-09-18<br>
      wellstreet.tech &middot; robinhoodchain.blockscout.com<br>
      <span class="amber">Checkable, not sellable.</span>
    </div>
    <div class="foot">
      Generated from docs/public/whitepaper.md — the canonical source, rendered by the same
      markdown renderer the site's docs tab uses. Every number carries a source; every source
      is a file in a public repository or a raw RPC call. Where this paper and the on-chain
      code disagree, the code wins. Build ${sha}.
    </div>
  </section>
  <main>
${body}
  </main>
</body>
</html>
`;

process.stdout.write(html);
