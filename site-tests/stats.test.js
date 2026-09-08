'use strict';
// G5 STATS/FLYWHEEL rider tests (SECTION_IMPROVE 2026-09-08) — the bars'
// null→count change + the dual-state pending register, behaviorally:
//   - laneShares now takes the COUNTED-EVENT pair (Burned-event count vs
//     Forwarded-event count, one unit) — the pre-G5 units form ($WELL bigint
//     vs a null treasury figure) returns null, so mixed-unit lanes never draw;
//   - setBar stamps data-empty on the TRACK as well as the fill (the absence
//     register — the solid paper-2 track read as a filled bar in light mode)
//     and clears both stamps + any stale empty title when a real share lands;
//   - setPendingRegister: pending shows the chips/lines + the toggle title +
//     the windowed unit grey; live clears ALL of them (a chip that outlives
//     its state lies); error keeps the toggle title + grey but hides the
//     chips (a failure is not a pending state).
// The module self-inits against whatever document is visible at require time —
// the stub starts EMPTY (getElementById → null) so init() early-returns, then
// the fixtures attach per-test. Dependency-free: node:test + node:assert ONLY.
const test = require('node:test');
const assert = require('node:assert');

// ---- document stub (empty at require time → stats.js selfInit early-returns) ----
const fixture = {}; // id → element
globalThis.document = {
  readyState: 'complete',
  getElementById(id) { return fixture[id] || null; },
};

function el(cls) {
  const classes = new Set();
  const node = {
    className: cls || '',
    attrs: {},
    hidden: false,
    parentElement: null,
    setAttribute(k, v) { node.attrs[k] = String(v); },
    getAttribute(k) { return (k in node.attrs) ? node.attrs[k] : null; },
    removeAttribute(k) { delete node.attrs[k]; },
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      contains(c) { return classes.has(c); },
    },
  };
  return node;
}

// the #stats surface (SECTION_ID) with a querySelector for the toggle group —
// attached AFTER the require so selfInit's init() finds NO surface and
// deterministically early-returns (no listeners, no reads at require time)
const toggle = el('st-toggle');
const surface = el('block');
surface.querySelector = (sel) => (sel === '.st-toggle' ? toggle : null);

const stats = require('../site/js/stats.js');

fixture['stats'] = surface;

// ------------------------------------------------------------------
test('laneShares takes the counted-event pair (G5 null→count)', () => {
  assert.deepStrictEqual(stats.laneShares(3, 1), { burn: 0.75, treasury: 0.25 });
  assert.deepStrictEqual(stats.laneShares(0, 5), { burn: 0, treasury: 1 });
  assert.deepStrictEqual(stats.laneShares(5, 0), { burn: 1, treasury: 0 });
  assert.strictEqual(stats.laneShares(0, 0), null, 'zero total events → no shares');
  assert.strictEqual(stats.laneShares(null, 1), null, 'a missing burn count → null');
  assert.strictEqual(stats.laneShares(3, undefined), null, 'a missing treasury count → null');
  assert.strictEqual(stats.laneShares(-1, 3), null, 'a negative count → null');
  assert.strictEqual(stats.laneShares(3, Infinity), null, 'a non-finite count → null');
  assert.strictEqual(stats.laneShares(10n, 5n), null,
    'THE PRE-G5 UNITS FORM ($WELL bigints) returns null — mixed-unit lanes never draw');
  assert.strictEqual(stats.laneShares(10n, null), null,
    'the pre-G5 live call shape (wei + null) stays null — pinned so it never sneaks back');
});

// ------------------------------------------------------------------
test('setBar stamps data-empty on the TRACK too (the absence register)', () => {
  const track = el('st-bar');
  const fill = el('st-bar-fill');
  fill.parentElement = track;
  fixture['st-lane-burn-bar'] = fill;

  stats.setBar('st-lane-burn-bar', null);
  assert.strictEqual(fill.attrs['style'], 'transform: scaleX(0)', 'empty keeps the fill at zero');
  assert.strictEqual(fill.attrs['data-empty'], 'true', 'empty stamps the fill');
  assert.strictEqual(track.attrs['data-empty'], 'true', 'empty stamps the TRACK (the dashed register lives there)');
  assert.ok(fill.attrs['title'] && track.attrs['title'], 'the honest empty title is set on both');

  // a real (even zero) share is a DRAWN bar, not an empty one
  stats.setBar('st-lane-burn-bar', 0.75);
  assert.strictEqual(fill.attrs['style'], 'transform: scaleX(0.75)');
  assert.ok(!('data-empty' in fill.attrs), 'live clears the fill stamp');
  assert.ok(!('data-empty' in track.attrs), 'live clears the TRACK stamp — the dashed absence register must not outlive its state');
  assert.ok(!('title' in fill.attrs) && !('title' in track.attrs), 'live clears the empty title everywhere it was set');

  stats.setBar('st-lane-burn-bar', 0);
  assert.strictEqual(fill.attrs['style'], 'transform: scaleX(0)');
  assert.ok(!('data-empty' in track.attrs), 'a real zero share is a drawn bar, not an empty one');

  // out-of-range → back to the absence register
  stats.setBar('st-lane-burn-bar', 1.5);
  assert.strictEqual(track.attrs['data-empty'], 'true', 'an out-of-range share re-stamps the TRACK');
});

// ------------------------------------------------------------------
test('setPendingRegister: pending shows the register, live clears every piece, error keeps title + grey but hides chips', () => {
  const chipT = el('st-pending-chip');
  const chipW = el('st-pending-chip');
  const lineT = el('st-pending-line');
  const lineW = el('st-pending-line');
  const unit = el('st-unit');
  fixture['st-pending-chip-total'] = chipT;
  fixture['st-pending-chip-window'] = chipW;
  fixture['st-pending-line-total'] = lineT;
  fixture['st-pending-line-window'] = lineW;
  fixture['st-unit-window'] = unit;

  stats.setPendingRegister('pending');
  assert.strictEqual(chipT.hidden, false, 'pending shows the all-time chip');
  assert.strictEqual(chipW.hidden, false, 'pending shows the windowed chip');
  assert.strictEqual(lineT.hidden, false, 'pending shows the all-time line');
  assert.strictEqual(lineW.hidden, false, 'pending shows the windowed line');
  assert.strictEqual(toggle.attrs['title'], 'applies once the roamer is live', 'pending sets the toggle title');
  assert.ok(unit.classList.contains('is-pending'), 'pending greys the windowed unit line');

  stats.setPendingRegister('live');
  assert.strictEqual(chipT.hidden, true, 'LIVE hides the all-time chip — a chip that outlives its state lies');
  assert.strictEqual(chipW.hidden, true, 'LIVE hides the windowed chip');
  assert.strictEqual(lineT.hidden, true, 'LIVE hides the all-time line');
  assert.strictEqual(lineW.hidden, true, 'LIVE hides the windowed line');
  assert.ok(!('title' in toggle.attrs), 'LIVE clears the toggle title');
  assert.ok(!unit.classList.contains('is-pending'), 'LIVE clears the windowed unit grey');

  stats.setPendingRegister('error');
  assert.strictEqual(chipT.hidden, true, 'error hides the chip (a failure is not pending)');
  assert.strictEqual(lineW.hidden, true, 'error hides the line');
  assert.strictEqual(toggle.attrs['title'], 'applies once the roamer is live', 'error keeps the toggle title (the window still cannot apply)');
  assert.ok(unit.classList.contains('is-pending'), 'error keeps the windowed unit grey');
});

// ------------------------------------------------------------------
test('the exported surface still carries the pure helpers (no regression in the public API)', () => {
  for (const fn of ['init', 'setWindow', 'sumBurnField', 'windowFromBlock', 'fmtWell', 'laneShares', 'setBar', 'setPendingRegister']) {
    assert.strictEqual(typeof stats[fn], 'function', 'statsPage exports ' + fn);
  }
  assert.strictEqual(stats.sumBurnField([], 1), 0n, 'an empty log set sums to zero (unchanged)');
  assert.strictEqual(stats.sumBurnField([{ data: '0xzz' }], 1), null, 'a malformed log poisons the read (unchanged)');
});
