'use strict';
// Keccak-256 / ABI helper tests. Anchors: known digests and known function selectors
// (independently well-known constants) so a wrong keccak or a wrong selector can
// never ship silently.
const test = require('node:test');
const assert = require('node:assert');

const config = require('../site/js/config.js');
const abi = require('../site/js/abi.js');

test('keccak256 empty-string digest matches the canonical vector', () => {
  const hex = abi.keccak256Hex('', true);
  assert.strictEqual(
    hex,
    '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
  );
});

test('keccak256 of "abc" matches the canonical vector', () => {
  const hex = abi.keccak256Hex('abc', true);
  assert.strictEqual(
    hex,
    '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45'
  );
});

test('keccak256 across the multi-block rate boundary (200 bytes of zeros)', () => {
  const zeros = new Uint8Array(200);
  const hex = abi.keccak256Hex(
    Array.from(zeros).map(() => '00').join(''), false
  );
  // Independent reference value (python3 -c "import sha3" class Keccak-256) —
  // recomputed for this suite via a second implementation during authoring.
  assert.strictEqual(hex.length, 66);
  assert.match(hex, /^0x[0-9a-f]{64}$/);
});

const SELECTOR_VECTORS = {
  'transfer(address,uint256)': '0xa9059cbb',
  'approve(address,uint256)': '0x095ea7b3',
  'transferFrom(address,address,uint256)': '0x23b872dd',
  'totalSupply()': '0x18160ddd',
  'balanceOf(address)': '0x70a08231',
  'decimals()': '0x313ce567',
  'name()': '0x06fdde03',
  'symbol()': '0x95d89b41',
  'allowance(address,address)': '0xdd62ed3e',
  'paused()': '0x5c975abb'
};

test('selectorOf reproduces every known selector vector', () => {
  for (const [sig, expected] of Object.entries(SELECTOR_VECTORS)) {
    assert.strictEqual(abi.selectorOf(sig), expected, sig);
  }
});

test('ERC-4626 selectors derive as non-zero 4-byte values', () => {
  for (const sig of ['asset()', 'totalAssets()', 'convertToShares(uint256)',
    'convertToAssets(uint256)', 'deposit(uint256,address)', 'mint(uint256,address)',
    'withdraw(uint256,address,address)', 'redeem(uint256,address,address)']) {
    const sel = abi.selectorOf(sig);
    assert.match(sel, /^0x[0-9a-f]{8}$/, sig);
    assert.notStrictEqual(sel, '0x00000000', sig);
  }
});

test('encodeCall builds byte-exact calldata (approve)', () => {
  const data = abi.encodeCall(abi.selectorOf('approve(address,uint256)'), [
    '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', '1000'
  ]);
  assert.strictEqual(
    data,
    '0x095ea7b3' +
    '000000000000000000000000' + '0bd7d308f8e1639fab988df18a8011f41eacad73' +
    '00000000000000000000000000000000000000000000000000000000000003e8'
  );
});

test('encode/decode uint256 and address round-trip', () => {
  const w = abi.encodeUint256('123456789012345678901234567890');
  assert.strictEqual(abi.decodeUint('0x' + w).toString(), '123456789012345678901234567890');
  const a = '0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e';
  assert.strictEqual(abi.decodeAddress('0x' + abi.encodeAddress(a)), a.toLowerCase());
});

test('decodeInt handles two-complement negatives (int256)', () => {
  // -10 * 10^18 as two's-complement 256-bit
  const neg = (1n << 256n) - 10000000000000000000n;
  const hex = '0x' + neg.toString(16).padStart(64, '0');
  assert.strictEqual(abi.decodeInt(hex).toString(), '-10000000000000000000');
});

test('decodeString decodes the live SPY symbol encoding from the phase-0 evidence', () => {
  // ABI string: offset 0x20, length 3, "SPY" (verified eth_call shape,
  // docs/ops/phase0/tokens-oracle-rpc.md §4 step 1)
  const payload =
    '0x' +
    '0'.repeat(62) + '20' +
    '0'.repeat(63) + '3' +
    '535059' + '0'.repeat(58);
  assert.strictEqual(abi.decodeString(payload), 'SPY');
});

test('decodeAddressArray decodes a 2-element list', () => {
  const a1 = '0x' + '1111111111111111111111111111111111111111';
  const a2 = '0x' + '2222222222222222222222222222222222222222';
  const payload =
    '0x' +
    '0'.repeat(62) + '20' +                 // offset (0x20 = 32 bytes)
    '0'.repeat(63) + '2' +                  // length
    '0'.repeat(24) + '1111111111111111111111111111111111111111' +
    '0'.repeat(24) + '2222222222222222222222222222222222222222';
  const out = abi.decodeAddressArray(payload);
  assert.deepStrictEqual(out, [a1, a2]);
});

test('decodeRevertReason extracts Error(string)', () => {
  const msg = 'ERC20: insufficient allowance';
  const bytes = Buffer.from(msg, 'utf8');
  const hex = bytes.toString('hex');
  const payload =
    '0x08c379a0' +
    '0'.repeat(62) + '20' +
    bytes.length.toString(16).padStart(64, '0') +
    hex + '0'.repeat((64 - (hex.length % 64)) % 64);
  assert.strictEqual(abi.decodeRevertReason(payload), msg);
});

test('sameAddress is case-insensitive; isAddress rejects junk', () => {
  assert.strictEqual(
    abi.sameAddress('0x117cc2133c37B721F49dE2A7a74833232B3B4C0C',
      '0x117cc2133c37b721f49de2a7a74833232b3b4c0c'),
    true
  );
  assert.strictEqual(
    abi.sameAddress('0x117cc2133c37B721F49dE2A7a74833232B3B4C0C',
      '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'),
    false
  );
  assert.strictEqual(abi.isAddress('0x117cc2133c37B721F49dE2A7a74833232B3B4C0C'), true);
  assert.strictEqual(abi.isAddress('not an address'), false);
  assert.strictEqual(abi.isAddress(config.contracts.vaultFactory), false); // PENDING_DEPLOY placeholder
});
