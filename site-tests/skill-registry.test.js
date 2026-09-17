'use strict';
// SKILL REGISTRY GATE (PARITY-REGISTRY-TEETH, 2026-09-16) — the machine-consumable
// skill registry (skills/registry.json, served byte-identical at
// site/skills/registry.json → wellstreet.tech/skills/registry.json) is the
// agent-registry face of the wellstreet skill. It is eyebrow-discover-adapter-
// aligned: an external consumer reads name/scope/status/triggers from this file,
// takes ADDRESSES only from site/js/config.js (the registry carries ZERO hex
// literals — the scam-drainer rule), quotes the fleet feed through the
// provenance contract, and treats the guardrails as deploy-verified truth.
// Dependency-free node:test, __dirname-relative fs reads (resource-gate.test.js
// convention). EXACTLY 7 test blocks, T1–T7 (the shipped riders at
// resource-gate.test.js:318/:351 already pin the served SKILL.md mirrors; this
// gate pins the registry). Contract:
// docs/inventory/GOALS_FROM_INVENTORY_2026-09-15_agentskills.md §PARITY-REGISTRY-TEETH
// (VIBE repo, read-only, outside this repo). CHANGE PROTOCOL (T4): the ceilings
// are the immutable anchors; the operating values are Safe-settable within them —
// a future governance change re-pins registry.json AND this test together in the
// same commit, never one alone, never the runbook alone.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const REGISTRY_PATH = path.join(ROOT, 'skills', 'registry.json');
const MIRROR_PATH = path.join(ROOT, 'site', 'skills', 'registry.json');
const SKILL_PATH = path.join(ROOT, 'skills', 'wellstreet-vaults', 'SKILL.md');
const FLEET_PATH = path.join(ROOT, 'site', 'data', 'fleet.json');
const CONFIG_PATH = path.join(ROOT, 'site', 'js', 'config.js');

// The canonical RoamVault pin — lives in site/js/config.js ONLY (the registry
// itself must stay hex-free; this cross-check is the addressSource discipline).
const VAULT_ADDRESS = '0xefA732aF74CaC318414BE8A1D645F3Ca5AB72E86';

function loadRegistry() {
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
}

// Frontmatter = the bytes between the first two '---' lines of the canonical
// SKILL.md (the landed post-S2 skill; S2-LANDED GATE held at dispatch).
function frontmatterLines() {
  const lines = fs.readFileSync(SKILL_PATH, 'utf8').split('\n');
  assert.strictEqual(lines[0].trim(), '---',
    'SKILL.md opens with a YAML frontmatter fence');
  const close = lines.indexOf('---', 1);
  assert.ok(close > 1, 'SKILL.md frontmatter closes with a second --- fence');
  return lines.slice(1, close);
}

// ---------------- T1 ----------------
test('T1 registry exists, parses, and carries the required single-entry shape', () => {
  const reg = loadRegistry();
  assert.strictEqual(typeof reg.version, 'string', 'registry version present');
  assert.match(reg.version, /^\d+\.\d+\.\d$/, 'registry version is semver');
  assert.ok(Array.isArray(reg.skills), 'skills is an array');
  assert.strictEqual(reg.skills.length, 1,
    'exactly one skill entry (a second skill later is additive)');
  const e = reg.skills[0];
  for (const field of ['name', 'description', 'triggers', 'scope', 'addressSource',
    'feed', 'guardrails', 'status', 'version']) {
    assert.ok(Object.prototype.hasOwnProperty.call(e, field),
      'entry carries required field: ' + field);
  }
  assert.ok(Array.isArray(e.triggers) && e.triggers.length >= 3,
    'triggers is an array of length >= 3');
  for (const t of e.triggers) {
    assert.strictEqual(typeof t, 'string');
    assert.ok(t.length > 0, 'every trigger is a non-empty string');
  }
  assert.ok(e.triggers.some((t) => /fleet feed/i.test(t)),
    'at least one trigger mentions the fleet feed');
  assert.ok(e.triggers.some((t) => /roaming|\bLP\b/i.test(t)),
    'at least one trigger mentions roaming/LP');
  assert.ok(['read', 'read-write'].includes(e.scope),
    'scope is one of read | read-write');
  assert.ok(['live', 'staging', 'deprecated'].includes(e.status),
    'status is one of live | staging | deprecated');
  assert.match(e.version, /^\d+\.\d+\.\d$/, 'entry version is semver');
});

// ---------------- T2 ----------------
test('T2 registry name and description are byte-equal to the SKILL.md frontmatter lines', () => {
  const fm = frontmatterLines();
  const nameLine = fm.find((l) => l.startsWith('name: '));
  const descLine = fm.find((l) => l.startsWith('description: '));
  assert.ok(nameLine, 'frontmatter carries a single-line "name: " entry');
  assert.ok(descLine, 'frontmatter carries a single-line "description: " entry');
  const e = loadRegistry().skills[0];
  assert.strictEqual(e.name, nameLine.slice('name: '.length),
    'registry name equals the frontmatter name line exactly');
  assert.strictEqual(e.description, descLine.slice('description: '.length),
    'registry description equals the frontmatter description line byte-for-byte ' +
    '(the same mirror discipline as the two shipped skill copies)');
});

// ---------------- T3 ----------------
test('T3 the registry carries ZERO 0x-hex address literals (addressSource is site/js/config.js)', () => {
  const e = loadRegistry().skills[0];
  assert.strictEqual(e.addressSource, 'site/js/config.js',
    'addressSource names site/js/config.js as the only address source');
  const bytes = fs.readFileSync(REGISTRY_PATH, 'utf8');
  const hexLiterals = bytes.match(/0x[0-9a-fA-F]{40}/g) || [];
  assert.deepStrictEqual(hexLiterals, [],
    'no 0x + 40-hex literals anywhere in the registry bytes — addresses come ' +
    'only from site/js/config.js per the scam-drainer rule');
});

// ---------------- T4 ----------------
test('T4 guardrail values are hard-pinned to deploy-verified truth and config.js carries the vault address', () => {
  const g = loadRegistry().skills[0].guardrails;
  // Operating values (Safe-settable within the ceilings; authority:
  // docs/ops/roamer-deploy-runbook.md + script/DeployRoamers.s.sol).
  assert.strictEqual(g.minHoldSeconds, 604800, 'MIN_HOLD 7d (604800s)');
  assert.strictEqual(g.maxMigrationsPerPeriod, 4, 'MAX_MIGRATIONS 4');
  assert.strictEqual(g.maxMigrationsPeriodDays, 365,
    'migration period stated WITH its unit (365d — src/RoamingHarvester.sol MIGRATION_PERIOD)');
  assert.strictEqual(g.minExpectedGainBps, 3911, 'MIN_EXPECTED_GAIN 3911 bps');
  assert.strictEqual(g.minExpectedGainAttestation, true,
    'migrate() expectedGainBps attestation is fail-closed by design');
  assert.strictEqual(g.depositCapUsdg, 25000, 'DEPOSIT_CAP 25000 USDG (mutable)');
  // Immutable ceilings (authority: src/RoamingHarvester.sol:162-174 ceilings,
  // src/RoamVault.sol DEPOSIT_CAP_CEILING).
  assert.strictEqual(g.ceilings.minHoldDays, 30, 'minHold ceiling 30d');
  assert.strictEqual(g.ceilings.maxMigrationsPerPeriod, 52, 'maxMigrations ceiling 52');
  assert.strictEqual(g.ceilings.minExpectedGainBps, 31286, 'minExpectedGain ceiling 31286 bps');
  assert.strictEqual(g.ceilings.depositCapUsdg, 250000, 'depositCap ceiling 250000 USDG');
  // addressSource cross-check: the canonical vault pin lives in config.js.
  const config = fs.readFileSync(CONFIG_PATH, 'utf8');
  assert.ok(config.indexOf(VAULT_ADDRESS) !== -1,
    'site/js/config.js pins the RoamVault address the registry points at');
});

// ---------------- T5 ----------------
test('T5 SKILL.md names each guardrail constant (contract vocabulary, case-insensitive)', () => {
  const skill = fs.readFileSync(SKILL_PATH, 'utf8').toLowerCase();
  for (const token of ['min_hold', 'max_migrations', 'min_expected_gain', 'deposit_cap']) {
    assert.ok(skill.indexOf(token) !== -1,
      'SKILL.md names the guardrail constant ' + token.toUpperCase());
  }
});

// ---------------- T6 ----------------
test('T6 the feed pin resolves: fleet.json parses, carries books and provenance, freshness names the truth', () => {
  const feedPin = loadRegistry().skills[0].feed;
  assert.strictEqual(feedPin.path, 'site/data/fleet.json');
  assert.strictEqual(feedPin.servedAt, '/data/fleet.json');
  const fleetPath = path.join(ROOT, feedPin.path);
  assert.ok(fs.existsSync(fleetPath), 'feed.path resolves on disk: ' + feedPin.path);
  const fleet = JSON.parse(fs.readFileSync(fleetPath, 'utf8'));
  assert.ok(Array.isArray(fleet.books) && fleet.books.length >= 1,
    'feed books array carries at least one book');
  assert.strictEqual(typeof fleet.provenance.generated, 'string');
  assert.ok(fleet.provenance.generated.length > 0,
    'provenance.generated is a non-empty string');
  assert.ok(feedPin.freshness.indexOf('provenance.generated') !== -1,
    'feed.freshness names provenance.generated as the freshness signal');
  // S2's landed FRESHNESS GATE documents NO operator re-screen cadence — the
  // freshness string states the truth (re-verify against on-chain state before
  // any write) and never asserts a weekly claim without an operated cadence.
  assert.ok(feedPin.freshness.indexOf('on-chain') !== -1,
    'feed.freshness carries the on-chain re-verify-before-write language');
  assert.ok(/\bweek/i.test(feedPin.freshness) === false,
    'feed.freshness never claims a weekly cadence (none is operated in-repo)');
});

// ---------------- T7 ----------------
test('T7 served-mirror rider: site/skills/registry.json byte-equals skills/registry.json', () => {
  assert.ok(fs.existsSync(MIRROR_PATH),
    'site/skills/registry.json exists (the served mirror path)');
  const canonical = fs.readFileSync(REGISTRY_PATH);
  const mirror = fs.readFileSync(MIRROR_PATH);
  assert.strictEqual(Buffer.compare(canonical, mirror), 0,
    'served mirror bytes equal the canonical registry byte-for-byte ' +
    '(re-copy fresh at build time — the repository copy is truth)');
});
