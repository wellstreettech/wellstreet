/*
 * probe_display_font.js — DEV-ONLY verification tooling (WSV-FONTS self-host goal).
 *
 * NEVER wired into CI (.github/workflows/ci.yml runs exactly
 * `node --test "site-tests/*.test.js" "api-tests/*.test.js"` — scripts/ is outside
 * both globs) and NEVER a dependency of the zero-dependency/IPFS-ready site. This
 * script proves the self-hosted display face loads headlessly and is
 * metric-distinct from the monospace fallback, and that the page attempts no
 * external request outside the config-derived allowlist.
 *
 * Playwright resolves via the WS_PLAYWRIGHT_PATH env var (machine-specific
 * absolute path travels ONLY via the env, never committed) or a global install:
 *
 *   WS_PLAYWRIGHT_PATH=/path/to/node_modules/playwright \
 *     node scripts/probe_display_font.js "Doto"
 *
 * Behavior:
 *   - serves site/ on 127.0.0.1 via node http WITH correct font MIME types
 *     (.ttf -> font/ttf, .woff2 -> font/woff2 — Chromium loads fonts regardless,
 *     clean logs need the right types);
 *   - intercepts EVERY request and aborts all non-localhost (zero real external
 *     network leaves the box), recording each attempted external ORIGIN;
 *   - requires the real site/js/config.js and asserts every attempted
 *     non-localhost origin is inside {origins of config.rpc.endpoints}
 *     UNION {config.chain.explorerBase};
 *   - accepts the face name as argv[2] and uses it for BOTH the font
 *     load/check strings and the sample-span font stacks (a face amendment
 *     touches only the argv token);
 *   - awaits document.fonts.load('16px "<face>"'), asserts
 *     document.fonts.check('16px "<face>"') === true;
 *   - renders two 24-char sample spans ("<face>",monospace vs explicit
 *     monospace) and asserts the width delta >= 2px;
 *   - prints PROBE_OK=1, FONT_LOADED=1, NON_ALLOWLIST_REQUESTS=0 and exits 0
 *     only if all assertions pass.
 *
 * KNOWN LIMIT: variable-axis rendering (ROND round vs square dots) is NOT
 * verifiable here — this proves font load + metric-distinctness only.
 */
'use strict';

const FS = require('fs');
const HTTP = require('http');
const PATH = require('path');

const SITE_ROOT = PATH.join(__dirname, '..', 'site');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webmanifest': 'application/manifest+json'
};

function fail(msg) {
  console.error('PROBE_FAIL: ' + msg);
  process.exit(1);
}

// --- allowlist from the REAL site/js/config.js (UMD: module.exports works) ---
function buildAllowlist() {
  const cfg = require(PATH.join(SITE_ROOT, 'js', 'config.js'));
  const allow = new Set();
  (cfg.rpc && cfg.rpc.endpoints ? cfg.rpc.endpoints : []).forEach(function (ep) {
    allow.add(new URL(ep).origin);
  });
  if (cfg.chain && cfg.chain.explorerBase) {
    allow.add(new URL(cfg.chain.explorerBase).origin);
  }
  return allow;
}

function startServer() {
  return new Promise(function (resolve, reject) {
    const server = HTTP.createServer(function (req, res) {
      let urlPath;
      try {
        urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      } catch (e) {
        res.writeHead(400); res.end('bad request'); return;
      }
      if (urlPath.endsWith('/')) urlPath += 'index.html';
      const filePath = PATH.normalize(PATH.join(SITE_ROOT, urlPath));
      if (filePath !== SITE_ROOT && filePath.indexOf(SITE_ROOT + PATH.sep) !== 0) {
        res.writeHead(403); res.end('forbidden'); return;
      }
      FS.readFile(filePath, function (err, data) {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        const ext = PATH.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', function () { resolve(server); });
  });
}

async function main() {
  const face = process.argv[2];
  if (!face) {
    console.error('usage: WS_PLAYWRIGHT_PATH=/path/to/node_modules/playwright node scripts/probe_display_font.js "<FaceName>"');
    process.exit(2);
  }

  const allow = buildAllowlist();

  const server = await startServer();
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;

  const nonAllowlistOrigins = [];
  let abortedExternal = 0;
  let fontLoaded = false;
  let widthDelta = 0;

  try {
    const pw = require(process.env.WS_PLAYWRIGHT_PATH || 'playwright');
    const browser = await pw.chromium.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();

      await page.route('**/*', function (route) {
        let u;
        try { u = new URL(route.request().url()); } catch (e) { return route.abort(); }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          return route.continue(); // data:/blob:/about: — nothing leaves the box
        }
        if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
          return route.continue();
        }
        abortedExternal += 1;
        if (!allow.has(u.origin)) nonAllowlistOrigins.push(u.origin);
        return route.abort();
      });

      await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(1200);

      fontLoaded = await page.evaluate(async function (f) {
        await document.fonts.load('16px "' + f + '"');
        return document.fonts.check('16px "' + f + '"') === true;
      }, face);

      widthDelta = await page.evaluate(function (f) {
        const SAMPLE = 'Wellstreet SPY 90/10 APR'; // exactly 24 chars
        function measure(fontFamily) {
          const s = document.createElement('span');
          s.textContent = SAMPLE;
          s.style.fontFamily = fontFamily;
          s.style.fontSize = '32px';
          s.style.position = 'absolute';
          s.style.left = '-9999px';
          s.style.whiteSpace = 'nowrap';
          document.body.appendChild(s);
          const w = s.getBoundingClientRect().width;
          document.body.removeChild(s);
          return w;
        }
        return measure('"' + f + '", monospace') - measure('monospace');
      }, face);
    } finally {
      await browser.close();
    }
  } finally {
    server.close();
  }

  console.log('FONT_LOADED=' + (fontLoaded ? 1 : 0));
  console.log('WIDTH_DELTA_PX=' + widthDelta.toFixed(2));
  console.log('ABORTED_EXTERNAL=' + abortedExternal);
  if (nonAllowlistOrigins.length > 0) {
    console.log('NON_ALLOWLIST_ORIGINS=' + Array.from(new Set(nonAllowlistOrigins)).join(','));
  }
  const nonAllowlistCount = nonAllowlistOrigins.length;
  console.log('NON_ALLOWLIST_REQUESTS=' + nonAllowlistCount);

  if (!fontLoaded) fail('font did not load: document.fonts.check("' + face + '") was false');
  if (Math.abs(widthDelta) < 2) fail('sample-span width delta ' + widthDelta.toFixed(2) + 'px < 2px (face not metrically distinct from monospace fallback)');
  if (nonAllowlistCount !== 0) fail('attempted requests to non-allowlist origins');

  console.log('PROBE_OK=1');
}

main().catch(function (e) { console.error(e && e.message ? e.message : String(e)); process.exit(1); });
