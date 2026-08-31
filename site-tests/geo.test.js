'use strict';
// Jurisdiction gate tests. Per the spec's GATE FIX MAP FIX-5, this unit test is the
// CANONICAL verification surface for the gate (there is NO live US-simulated 403 probe).
const test = require('node:test');
const assert = require('node:assert');

const config = require('../site/js/config.js');
const geo = require('../site/js/geo.js');

const F19 = 'geo-blocking has no adjudicated safe harbor — it reduces, not eliminates, exposure';

test('the F19 disclosure constant is verbatim', () => {
  assert.strictEqual(geo.F19_DISCLOSURE, F19);
});

test('config carries the same verbatim disclosure (block page + mirror banner)', () => {
  assert.strictEqual(config.geo.disclosure, F19);
  assert.ok(config.geo.mirrorBanner.indexOf(F19) !== -1);
});

test('the static block-page template carries the F19 disclosure verbatim (no-JS survival)', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'site', 'index.html'), 'utf8');
  assert.ok(html.indexOf(F19) !== -1, 'index.html must carry the F19 line statically');
  const occurrences = html.split(F19).length - 1;
  assert.ok(occurrences >= 2, 'disclosure present on block page AND mirror banner, got ' + occurrences);
});

test('blocked jurisdictions: US, UK alias, GB', () => {
  const gate = { blockedCountries: ['US', 'GB', 'UK'] };
  assert.strictEqual(geo.gateDecision('US', gate).blocked, true);
  assert.strictEqual(geo.gateDecision('UK', gate).blocked, true);
  assert.strictEqual(geo.gateDecision('GB', gate).blocked, true);
});

test('allowed jurisdictions: DE, BR (and everything else unlisted)', () => {
  const gate = { blockedCountries: ['US', 'GB', 'UK'] };
  assert.strictEqual(geo.gateDecision('DE', gate).blocked, false);
  assert.strictEqual(geo.gateDecision('BR', gate).blocked, false);
  assert.strictEqual(geo.gateDecision('JP', gate).blocked, false);
  assert.strictEqual(geo.gateDecision('CH', gate).blocked, false);
});

test('normalization: lowercase and padded codes are handled; unknown/absent allows', () => {
  const gate = { blockedCountries: ['US', 'GB', 'UK'] };
  assert.strictEqual(geo.gateDecision('us', gate).blocked, true);
  assert.strictEqual(geo.gateDecision(' US ', gate).blocked, true);
  assert.strictEqual(geo.gateDecision('gB', gate).blocked, true);

  const unknown = geo.gateDecision(null, gate);
  assert.strictEqual(unknown.blocked, false);
  assert.strictEqual(unknown.known, false);
  assert.strictEqual(geo.gateDecision('', gate).blocked, false);
  assert.strictEqual(geo.gateDecision('XX', gate).blocked, false); // known but unlisted
});

test('every decision carries the disclosure verbatim', () => {
  const d = geo.gateDecision('US', config.geo);
  assert.strictEqual(d.disclosure, F19);
  assert.strictEqual(d.countryCode, 'US');
});

test('config gate list matches the locked jurisdiction set', () => {
  assert.deepStrictEqual(config.geo.blockedCountries, ['US', 'GB', 'UK']);
});

test('normalizeCountry edge cases', () => {
  assert.strictEqual(geo.normalizeCountry('de'), 'DE');
  assert.strictEqual(geo.normalizeCountry('  br '), 'BR');
  assert.strictEqual(geo.normalizeCountry(null), null);
  assert.strictEqual(geo.normalizeCountry(undefined), null);
  assert.strictEqual(geo.normalizeCountry(''), null);
  assert.strictEqual(geo.normalizeCountry(42), null);
});

test('applyGate is safe outside a DOM (returns noop, never throws)', () => {
  const decision = geo.gateDecision('US', config.geo);
  const out = geo.applyGate(decision, {});
  assert.deepStrictEqual(out, { applied: 'noop' });
});

test('detectMirrorMode: config override wins; heuristic off in Node', () => {
  assert.strictEqual(geo.detectMirrorMode({ mirrorMode: true }), true);
  assert.strictEqual(geo.detectMirrorMode({ mirrorMode: false }), false);
  assert.strictEqual(geo.detectMirrorMode({}), false);
  assert.strictEqual(geo.detectMirrorMode(undefined), false);
});
