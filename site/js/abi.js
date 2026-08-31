/*
 * Wellstreet site — abi.js
 * Dependency-free Ethereum ABI helpers: Keccak-256 (original padding, 0x01/0x80),
 * function-selector derivation from signatures (no hardcoded, possibly-wrong
 * selectors anywhere in this site), and the small encode/decode surface the
 * vault reads and wallet flows need.
 *
 * Correctness anchors (asserted in site-tests/abi.test.js):
 *   keccak256("") === c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
 *   selectorOf("transfer(address,uint256)") === 0xa9059cbb  (and other known vectors)
 */
(function (root, factory) {
  var api = factory();
  root.WS = root.WS || {};
  root.WS.abi = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';

  var MASK64 = 0xFFFFFFFFFFFFFFFFn;

  // Keccak round constants (24 rounds)
  var RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808An, 0x8000000080008000n,
    0x000000000000808Bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008An, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000An,
    0x000000008000808Bn, 0x800000000000008Bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800An, 0x800000008000000An,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
  ];

  // Rho rotation offsets, flat-indexed by lane = x + 5y (matching every step below):
  //   index 0-4   (y=0): r[0..4][0] = 0, 1, 62, 28, 27
  //   index 5-9   (y=1): r[0..4][1] = 36, 44, 6, 55, 20
  //   index 10-14 (y=2): r[0..4][2] = 3, 10, 43, 25, 39
  //   index 15-19 (y=3): r[0..4][3] = 41, 45, 15, 21, 8
  //   index 20-24 (y=4): r[0..4][4] = 18, 2, 61, 56, 14
  var ROT = [
     0,  1, 62, 28, 27,
    36, 44,  6, 55, 20,
     3, 10, 43, 25, 39,
    41, 45, 15, 21,  8,
    18,  2, 61, 56, 14
  ];

  function rotl64(x, n) {
    var v = BigInt.asUintN(64, x);
    if (n === 0) return v;
    return BigInt.asUintN(64, (v << BigInt(n)) | (v >> BigInt(64 - n)));
  }

  function keccakF(state) {
    for (var round = 0; round < 24; round++) {
      var x, y;
      // theta
      var C = new Array(5);
      var D = new Array(5);
      for (x = 0; x < 5; x++) {
        C[x] = BigInt.asUintN(64, state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20]);
      }
      for (x = 0; x < 5; x++) {
        D[x] = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1);
      }
      for (x = 0; x < 5; x++) {
        for (y = 0; y < 5; y++) {
          state[x + 5 * y] = BigInt.asUintN(64, state[x + 5 * y] ^ D[x]);
        }
      }
      // rho + pi: B[y][(2x + 3y) mod 5] = rot(A[x][y], r[x][y])
      var B = new Array(25).fill(0n);
      for (x = 0; x < 5; x++) {
        for (y = 0; y < 5; y++) {
          var nx = y;
          var ny = (2 * x + 3 * y) % 5;
          B[nx + 5 * ny] = rotl64(state[x + 5 * y], ROT[x + 5 * y]);
        }
      }
      // chi
      for (y = 0; y < 5; y++) {
        for (x = 0; x < 5; x++) {
          var not1 = B[(x + 1) % 5 + 5 * y] ^ MASK64;
          state[x + 5 * y] = BigInt.asUintN(64, B[x + 5 * y] ^ (not1 & B[(x + 2) % 5 + 5 * y]));
        }
      }
      // iota
      state[0] = BigInt.asUintN(64, state[0] ^ RC[round]);
    }
  }

  function keccak256(bytes) {
    var rate = 136; // 1088-bit rate for 256-bit output
    var padded = Array.prototype.slice.call(bytes);
    var q = rate - (padded.length % rate);
    if (q === 1) {
      padded.push(0x81);
    } else {
      padded.push(0x01);
      for (var i = 1; i < q - 1; i++) { padded.push(0); }
      padded.push(0x80);
    }
    var state = new Array(25).fill(0n);
    for (var off = 0; off < padded.length; off += rate) {
      for (var lane = 0; lane < rate / 8; lane++) {
        var v = 0n;
        for (var b = 7; b >= 0; b--) {
          v = (v << 8n) | BigInt(padded[off + lane * 8 + b] & 0xff);
        }
        state[lane] = BigInt.asUintN(64, state[lane] ^ v);
      }
      keccakF(state);
    }
    var out = new Uint8Array(32);
    for (var l = 0; l < 4; l++) {
      var w = state[l];
      for (var b2 = 0; b2 < 8; b2++) {
        out[l * 8 + b2] = Number(w & 0xffn);
        w >>= 8n;
      }
    }
    return out;
  }

  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(str);
    }
    // Minimal UTF-8 fallback (ASCII-safe signatures only in practice)
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) { out.push(c); }
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
      else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    }
    return out;
  }

  function bytesToHex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) {
      s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    }
    return s;
  }

  function bytesFromHex(hex) {
    var h = hex.replace(/^0x/i, '');
    if (h.length % 2 !== 0) { throw new Error('odd-length hex'); }
    var out = new Uint8Array(h.length / 2);
    for (var i = 0; i < out.length; i++) { out[i] = parseInt(h.substr(i * 2, 2), 16); }
    return out;
  }

  function keccak256Hex(hexOrString, isString) {
    var bytes = isString ? utf8Bytes(hexOrString) : bytesFromHex(hexOrString);
    return '0x' + bytesToHex(keccak256(bytes));
  }

  // 4-byte function selector from a canonical signature, e.g. "transfer(address,uint256)"
  function selectorOf(signature) {
    return keccak256Hex(signature, true).slice(0, 10);
  }

  // ---------------- ABI encoding helpers ----------------

  function assertAddress(addr) {
    if (typeof addr !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      throw new Error('not an address: ' + addr);
    }
    return addr.toLowerCase();
  }

  function toBigInt(value) {
    if (typeof value === 'bigint') { return value; }
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) { throw new Error('unsafe integer (use BigInt): ' + value); }
      return BigInt(value);
    }
    if (typeof value === 'string') {
      if (/^-?[0-9]+$/.test(value)) { return BigInt(value); }
      if (/^0x[0-9a-fA-F]+$/.test(value)) { return BigInt(value); }
    }
    throw new Error('cannot coerce to BigInt: ' + String(value));
  }

  function hex32(value) {
    var v = toBigInt(value) & ((1n << 256n) - 1n);
    var s = v.toString(16);
    while (s.length < 64) { s = '0' + s; }
    return s;
  }

  function encodeAddress(addr) { return hex32(assertAddress(addr)); }
  function encodeUint256(value) { return hex32(value); }

  // selectorOrSig: '0x095ea7b3' or 'approve(address,uint256)'; args: addresses and uints
  function encodeCall(selectorOrSig, args) {
    var sel = /^0x[0-9a-fA-F]{8}$/.test(selectorOrSig) ? selectorOrSig : selectorOf(selectorOrSig);
    var data = sel.replace(/^0x/, '');
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)) { data += encodeAddress(a); }
      else { data += encodeUint256(a); }
    }
    return '0x' + data;
  }

  // ---------------- ABI decoding helpers ----------------

  function strip0x(hex) { return String(hex == null ? '' : hex).replace(/^0x/i, ''); }

  function word(hex, i) {
    var h = strip0x(hex);
    var start = i * 64;
    if (h.length < start + 64) { return null; }
    return '0x' + h.substr(start, 64);
  }

  function wordCount(hex) {
    var h = strip0x(hex);
    return Math.floor(h.length / 64);
  }

  function decodeUint(hex, i) {
    var w = word(hex, i == null ? 0 : i);
    if (w === null) { return null; }
    return BigInt(w);
  }

  function decodeBool(hex, i) {
    var v = decodeUint(hex, i == null ? 0 : i);
    return v !== null && v !== 0n;
  }

  function decodeInt(hex, i) {
    var v = decodeUint(hex, i == null ? 0 : i);
    if (v === null) { return null; }
    if (v >= (1n << 255n)) { return v - (1n << 256n); }
    return v;
  }

  function decodeAddress(hex, i) {
    var w = word(hex, i == null ? 0 : i);
    if (w === null) { return null; }
    return '0x' + strip0x(w).slice(24, 64);
  }

  // Dynamic string: word0 = offset (bytes), word at offset = length, then UTF-8 bytes
  function decodeString(hex) {
    var h = strip0x(hex);
    if (h.length < 128) { return null; }
    var off = Number(BigInt('0x' + h.substr(0, 64))) * 2;
    if (off + 64 > h.length) { return null; }
    var len = Number(BigInt('0x' + h.substr(off, 64)));
    if (off + 64 + len * 2 > h.length) { return null; }
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      bytes[i] = parseInt(h.substr(off + 64 + i * 2, 2), 16);
    }
    return new TextDecoder().decode(bytes);
  }

  // Dynamic address[]: word0 = offset, word at offset = length, then address words
  function decodeAddressArray(hex) {
    var h = strip0x(hex);
    if (h.length < 128) { return []; }
    var off = Number(BigInt('0x' + h.substr(0, 64))) * 2;
    if (off + 64 > h.length) { return []; }
    var len = Number(BigInt('0x' + h.substr(off, 64)));
    var out = [];
    for (var i = 0; i < len; i++) {
      var start = off + 64 + i * 64;
      if (start + 64 > h.length) { break; }
      out.push('0x' + h.substr(start + 24, 40));
    }
    return out;
  }

  // Error(string) revert reason — selector 0x08c379a0
  function decodeRevertReason(data) {
    var h = strip0x(data);
    if (h.slice(0, 8) !== '08c379a0') { return null; }
    return decodeString('0x' + h.slice(8));
  }

  function isAddress(value) {
    return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
  }

  function sameAddress(a, b) {
    return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
  }

  return {
    keccak256: keccak256,
    keccak256Hex: keccak256Hex,
    selectorOf: selectorOf,
    utf8Bytes: utf8Bytes,
    bytesToHex: bytesToHex,
    bytesFromHex: bytesFromHex,
    encodeAddress: encodeAddress,
    encodeUint256: encodeUint256,
    encodeCall: encodeCall,
    word: word,
    wordCount: wordCount,
    decodeUint: decodeUint,
    decodeInt: decodeInt,
    decodeBool: decodeBool,
    decodeAddress: decodeAddress,
    decodeString: decodeString,
    decodeAddressArray: decodeAddressArray,
    decodeRevertReason: decodeRevertReason,
    isAddress: isAddress,
    sameAddress: sameAddress
  };
});
