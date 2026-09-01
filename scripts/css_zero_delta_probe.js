/*
 * css_zero_delta_probe.js — DEV-ONLY verification tooling.
 *
 * NEVER wired into CI (.github/workflows/ci.yml) and NEVER a dependency of the
 * zero-dependency/IPFS-ready site. This script exists only to prove that the
 * design-token refactor of site/css/style.css produces a byte-identical
 * computed-style render (zero user-visible delta). Run it manually BEFORE the
 * token edit and again AFTER, then byte-compare the two JSON dumps.
 *
 * Playwright resolves via the WS_PLAYWRIGHT_PATH env var (machine-specific
 * absolute path travels ONLY via the env, never committed) or a global install:
 *
 *   WS_PLAYWRIGHT_PATH=/path/to/node_modules/playwright \
 *     node scripts/css_zero_delta_probe.js /tmp/tokens_before.json
 *
 * JavaScript is disabled so the dump covers exactly the static markup (no
 * RPC/dynamic-data noise). Chromium is relaunched per viewport.
 */
'use strict';

const FS = require('fs');

// Fixed 32-property computed-style whitelist.
const PROPS = [
  'display', 'position', 'max-width',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'text-transform', 'color', 'background-color',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-radius', 'box-shadow', 'gap', 'grid-template-columns',
  'flex-direction', 'opacity'
];

const URL = 'file:///home/raivo/Documents/wellstreet/site/index.html';
const VIEWPORTS = [['1280', { width: 1280, height: 800 }], ['400', { width: 400, height: 800 }]];

async function main() {
  const outPath = process.argv[2];
  if (!outPath) { console.error('usage: node css_zero_delta_probe.js <out.json>'); process.exit(2); }
  const { chromium } = require(process.env.WS_PLAYWRIGHT_PATH || 'playwright');
  const out = {};
  const counts = {};
  for (const [w, vp] of VIEWPORTS) {
    const b = await chromium.launch();
    const ctx = await b.newContext({ javaScriptEnabled: false, viewport: vp });
    const p = await ctx.newPage();
    await p.goto(URL, { waitUntil: 'load' });
    await p.waitForTimeout(300);
    const rows = await p.evaluate(function (props) {
      const els = Array.prototype.slice.call(document.querySelectorAll('*'));
      return els.map(function (el, i) {
        const cs = getComputedStyle(el);
        const dump = {};
        for (let k = 0; k < props.length; k++) { dump[props[k]] = cs.getPropertyValue(props[k]); }
        let cls = '';
        try { cls = typeof el.className === 'string' ? el.className : ''; } catch (e) { cls = ''; }
        return [i, el.tagName, el.id || '', cls, dump];
      });
    }, PROPS);
    out[w] = rows;
    counts[w] = rows.length;
    await ctx.close();
    await b.close();
  }
  FS.writeFileSync(outPath, JSON.stringify(out));
  console.log('WROTE ' + outPath + ' elements@1280: ' + counts['1280'] + ' elements@400: ' + counts['400']);
}

main().catch(function (e) { console.error(e && e.message ? e.message : String(e)); process.exit(1); });
