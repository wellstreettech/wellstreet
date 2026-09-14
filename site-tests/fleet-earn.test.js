'use strict';
// FLEET-APR-LOOP (2026-09-14) — pins for the how-you-earn block in the fleet
// section: the roamer/loop one-breath + the APR explainer.
//
// The teeth: the 40.3% figure in the copy is the MEASURED phase-0 baseline
// owned by site/js/config.js (aprMethodology.phase0Baseline.netAprPct). This
// file pins copy ↔ constant — a baseline re-pin breaks this test until the
// site copy moves with it (they cannot silently drift).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../site/js/config.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');

// the block scoped between the how-you-earn div and the flagship card
const block = html.slice(html.indexOf('id="fleet-earn"'), html.indexOf('fleet-card--flagship'));

test('fleet-earn: the block exists in the fleet section, before the flagship card', () => {
  assert.ok(html.includes('id="fleet-earn"'), 'the how-you-earn block is present');
  assert.ok(block.includes('href="#flow"'), 'the loop link points at the flow section');
  assert.ok(block.length > 0 && block.length < 4000, 'the block sits before the flagship card, compact');
});

test('fleet-earn: the loop line carries the fee lanes verbatim', () => {
  assert.ok(block.includes('The roamer is the protocol\'s own automated LP'), 'the roamer is named for what it is');
  assert.ok(block.includes('90% of every fee streams to depositors'), 'the 90% lane, plain');
  assert.ok(block.includes('parked until $WELL launches, not earning'), 'the burn leg honesty state');
});

test('fleet-earn: the APR explainer states the projection honestly', () => {
  assert.ok(block.includes('Where the ~0.3% comes from'), 'the explainer is present');
  assert.ok(block.includes('projected until the first harvest makes it measured'), 'projected until measured, in plain words');
  assert.ok(!/guaranteed|passive income/i.test(block), 'voice kill-list holds inside the block');
});

test('fleet-earn: the 40.3% figure is SYNCED to the config constant (drift = test break)', () => {
  const baseline = config.aprMethodology.phase0Baseline.netAprPct;
  assert.strictEqual(baseline, 40.310);
  const toTenth = baseline.toFixed(1); // '40.3'
  assert.ok(block.includes(toTenth), `the copy cites the measured baseline (${toTenth}%) — re-pin both together`);
});
