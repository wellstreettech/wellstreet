const { test } = require('node:test');
const assert = require('node:assert');

test('NO-ICON-CDN GUARD: zero font-awesome/cdnjs references in shipped site bytes', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const bad = /cdnjs|font-?awesome|SnH5WK/i;
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (/\.(html|css|js)$/.test(e.name) && bad.test(fs.readFileSync(p, 'utf8'))) { hits.push(p); }
    }
  };
  walk(path.join(__dirname, '..', 'site'));
  assert.deepStrictEqual(hits, [], 'icon CDN references found: ' + hits.join(', '));
});
