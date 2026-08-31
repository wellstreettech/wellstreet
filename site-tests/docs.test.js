'use strict';
// Markdown renderer smoke tests (dependency-free renderer in site/js/docs.js).
// Security-critical: everything is escaped before formatting; unsafe URL schemes
// are stripped.
const test = require('node:test');
const assert = require('node:assert');

const config = require('../site/js/config.js');
const docs = require('../site/js/docs.js');

test('headings render at their level', () => {
  assert.strictEqual(docs.renderMarkdown('# Title'), '<h1>Title</h1>');
  assert.strictEqual(docs.renderMarkdown('### Sub'), '<h3>Sub</h3>');
});

test('paragraph, bold, italic and inline code', () => {
  const out = docs.renderMarkdown('This is **bold**, *em* and `code` here.');
  assert.ok(out.indexOf('<p>') === 0);
  assert.ok(out.indexOf('<strong>bold</strong>') !== -1);
  assert.ok(out.indexOf('<em>em</em>') !== -1);
  assert.ok(out.indexOf('<code>code</code>') !== -1);
});

test('raw HTML in markdown is escaped, never executed', () => {
  const out = docs.renderMarkdown('hello <script>alert(1)</script> & <img src=x onerror=alert(2)>');
  assert.ok(out.indexOf('<script>') === -1);
  assert.ok(out.indexOf('alert(1)') !== -1); // present as TEXT
  assert.ok(out.indexOf('&lt;script&gt;') !== -1);
  assert.ok(out.indexOf('&amp;') !== -1);
});

test('fenced code blocks escape their contents and keep language class', () => {
  const md = '```solidity\ncontract X { bool a = 1 < 2; }\n<script>bad()</script>\n```';
  const out = docs.renderMarkdown(md);
  assert.ok(out.indexOf('<pre><code class="language-solidity">') === 0);
  assert.ok(out.indexOf('&lt;script&gt;') !== -1);
  assert.ok(out.indexOf('<script>') === -1);
});

test('links: http(s) allowed with noopener; javascript: and data: schemes stripped', () => {
  const ok = docs.renderMarkdown('[docs](https://wellstreet.tech/x)');
  assert.ok(ok.indexOf('<a href="https://wellstreet.tech/x" rel="noopener noreferrer">docs</a>') !== -1);

  const js = docs.renderMarkdown('[click](javascript:alert(1))');
  assert.ok(js.indexOf('javascript:') === -1);
  assert.ok(js.indexOf('<a ') === -1);
  assert.ok(js.indexOf('click') !== -1);

  const data = docs.renderMarkdown('[x](data:text/html;base64,AAAA)');
  assert.ok(data.indexOf('data:') === -1);
  assert.ok(data.indexOf('<a ') === -1);
});

test('images with unsafe src are dropped to alt text; safe src kept', () => {
  const bad = docs.renderMarkdown('![alt](javascript:alert(1))');
  assert.ok(bad.indexOf('<img') === -1);
  assert.ok(bad.indexOf('alt') !== -1);
  const good = docs.renderMarkdown('![diagram](../docs/public/img.png)');
  assert.ok(good.indexOf('<img src="../docs/public/img.png"') !== -1);
});

test('safeUrl rules', () => {
  assert.strictEqual(docs.safeUrl('https://x.example/a'), 'https://x.example/a');
  assert.strictEqual(docs.safeUrl('#anchor'), '#anchor');
  assert.strictEqual(docs.safeUrl('./a.md'), './a.md');
  assert.strictEqual(docs.safeUrl('../docs/public/a.md'), '../docs/public/a.md');
  assert.strictEqual(docs.safeUrl('a.md'), 'a.md');
  assert.strictEqual(docs.safeUrl('javascript:alert(1)'), null);
  assert.strictEqual(docs.safeUrl('JaVaScRiPt:alert(1)'), null);
  assert.strictEqual(docs.safeUrl('data:text/html,x'), null);
  assert.strictEqual(docs.safeUrl('vbscript:x'), null);
  assert.strictEqual(docs.safeUrl(''), null);
});

test('lists render as ul/ol (flat, minimal renderer)', () => {
  const ul = docs.renderMarkdown('- one\n- two\n- three');
  assert.ok(ul.indexOf('<ul>') !== -1);
  assert.strictEqual(ul.split('<li>').length - 1, 3);
  const ol = docs.renderMarkdown('1. first\n2. second');
  assert.ok(ol.indexOf('<ol>') !== -1);
  assert.strictEqual(ol.split('<li>').length - 1, 2);
});

test('blockquote, hr and tables render', () => {
  const q = docs.renderMarkdown('> quoted line');
  assert.ok(q.indexOf('<blockquote>') !== -1);

  const hr = docs.renderMarkdown('above\n\n---\n\nbelow');
  assert.ok(hr.indexOf('<hr>') !== -1);

  const table = docs.renderMarkdown('| Pool | APR |\n| --- | --- |\n| SPY/500 | 70.87% |');
  assert.ok(table.indexOf('<table>') !== -1);
  assert.ok(table.indexOf('<th>Pool</th>') !== -1);
  assert.ok(table.indexOf('<td>70.87%</td>') !== -1);
  // tables are wrapped for horizontal scroll on narrow screens (mobile fix)
  assert.ok(table.indexOf('<div class="table-wrap"><table>') === 0);
});

test('multi-line paragraphs collapse into one <p>', () => {
  const out = docs.renderMarkdown('line one\nline two');
  assert.strictEqual(out, '<p>line one line two</p>');
});

test('realistic doc sample renders end-to-end', () => {
  const md = [
    '# Wellstreet risks',
    '',
    'The **honest** list. Read before depositing.',
    '',
    '## Vault risks',
    '',
    '- Issuer pause: the stock token can be paused by its issuer',
    '- `adminBurn` exists on the fleet implementation',
    '',
    '> This is not an audit.',
    '',
    '```solidity',
    'function totalAssets() public view returns (uint256) { return totalAssetsStored; }',
    '```',
    '',
    '| Check | Status |',
    '| ----- | ------ |',
    '| first-depositor inflation | tested |'
  ].join('\n');
  const out = docs.renderMarkdown(md);
  assert.ok(out.indexOf('<h1>Wellstreet risks</h1>') !== -1);
  assert.ok(out.indexOf('<strong>honest</strong>') !== -1);
  assert.ok(out.indexOf('adminBurn') !== -1);
  assert.ok(out.indexOf('<blockquote><p><p>') === -1); // no nested-paragraph glitch
  assert.ok(out.indexOf('totalAssetsStored') !== -1);
  assert.ok(out.indexOf('<td>tested</td>') !== -1);
});

test('doc path mapping is relative and IPFS-safe', () => {
  assert.strictEqual(config.docs.docsDir, '../docs/public');
  assert.ok(!config.docs.docsDir.startsWith('/'));
  for (const d of config.docs.index) {
    const url = docs.docUrl(config, d);
    assert.ok(!url.startsWith('/'), 'no leading slash: ' + url);
    assert.ok(url.indexOf('../docs/public/') === 0, url);
    assert.ok(url.endsWith('.md'));
  }
});

test('renderMarkdown handles null/undefined and CRLF line endings', () => {
  assert.strictEqual(docs.renderMarkdown(null), '');
  assert.strictEqual(docs.renderMarkdown(undefined), '');
  const crlf = docs.renderMarkdown('# H\r\n\r\npara\r\n');
  assert.ok(crlf.indexOf('<h1>H</h1>') !== -1);
  assert.ok(crlf.indexOf('<p>para</p>') !== -1);
});

// ---- Docs index ↔ disk truth ------------------------------------------------
// The docs tab fetches markdown AT RUNTIME from a relative path; an index entry
// whose file is missing on disk renders an honest "not published yet" state.
// These tests pin the index to the files that actually exist in docs/public/
// so the tab can never silently list phantom pages again.

test('docs index lists exactly the 6 published docs', () => {
  assert.strictEqual(config.docs.index.length, 6);
  assert.deepStrictEqual(
    config.docs.index.map(function (d) { return d.id; }),
    ['compliance', 'guarantees', 'not-guaranteed',
     'risk-disclosure', 'run-it-yourself', 'tokenomics']
  );
});

test('every docs index entry has a non-empty id, title and file', () => {
  for (const d of config.docs.index) {
    assert.ok(typeof d.id === 'string' && d.id.trim() !== '', 'missing id: ' + JSON.stringify(d));
    assert.ok(typeof d.title === 'string' && d.title.trim() !== '', 'missing title for id ' + d.id);
    assert.ok(typeof d.file === 'string' && d.file.trim() !== '', 'missing file for id ' + d.id);
  }
});

test('every docs index file exists on disk at docs/public/<file>', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const d of config.docs.index) {
    const p = path.join(__dirname, '..', 'docs', 'public', d.file);
    assert.ok(fs.existsSync(p), 'index lists a file that does not exist: ' + p);
  }
});
