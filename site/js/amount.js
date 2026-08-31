/*
 * Wellstreet site — amount.js
 * Exact string→BigInt token-amount parsing and BigInt→string formatting.
 * WHY THIS EXISTS: the deposit/redeem inputs sit at the money boundary, and a
 * float-based parse (parseFloat + Math.round) silently loses precision at large
 * magnitudes and mis-reports tiny valid amounts. Parsing here is DECIMAL-EXACT:
 * the string is validated character-class-first, then converted to BigInt —
 * no float ever touches the value.
 */
(function (root, factory) {
  var api = factory();
  root.WS = root.WS || {};
  root.WS.amount = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';

  // Parse a decimal string into BigInt base units. Returns {ok:true, value:BigInt}
  // or {ok:false, reason} with a message written to be shown to a user as-is.
  // Rules: digits + at most one '.', no sign, no exponent, no whitespace,
  // at most `decimals` fractional digits, integer part capped at 30 digits.
  function parseUnits(str, decimals) {
    var d = decimals == null ? 18 : Number(decimals);
    if (!(d >= 0) || d > 36) { return { ok: false, reason: 'Unsupported token decimals.' }; }

    var s = String(str == null ? '' : str).trim();
    if (s === '') { return { ok: false, reason: 'Enter an amount first.' }; }
    if (/[eE]/.test(s)) { return { ok: false, reason: 'Enter the amount as a plain number — no exponent notation.' }; }
    if (s.indexOf('-') !== -1) { return { ok: false, reason: 'Amounts cannot be negative.' }; }
    if (s.indexOf('+') !== -1) { return { ok: false, reason: 'Enter the amount as a plain number — no plus sign.' }; }
    if (/\s/.test(s)) { return { ok: false, reason: 'Amount cannot contain spaces.' }; }
    if (!/^[0-9.]+$/.test(s)) { return { ok: false, reason: 'Only digits and one decimal point — no letters, commas, or currency symbols.' }; }
    var parts = s.split('.');
    if (parts.length > 2) { return { ok: false, reason: 'Only one decimal point is allowed.' }; }
    var intPart = parts[0] || '0';
    var fracPart = parts[1] || '';
    if (intPart.length > 30) { return { ok: false, reason: 'Amount is too large.' }; }
    if (fracPart.length > d) {
      return { ok: false, reason: 'At most ' + d + ' decimal place' + (d === 1 ? '' : 's') + ' are supported for this token.' };
    }

    var intClean = intPart.replace(/^0+(?=\d)/, '');
    var scaledInt = BigInt(intClean === '' ? '0' : intClean);
    var fracBase = BigInt('1' + new Array(d + 1).join('0')); // 10^d
    var fracValue = fracPart === ''
      ? 0n
      : BigInt(fracPart + new Array(d - fracPart.length + 1).join('0'));
    var value = scaledInt * fracBase + fracValue;
    return { ok: true, value: value };
  }

  // BigInt base units → display string. Exact integer part (no float), fraction
  // truncated to `maxFrac` digits (default 4) with trailing zeros trimmed and
  // thousands separators on the integer part. Returns '—' for null/undefined.
  function formatUnits(raw, decimals, maxFrac) {
    if (raw === null || raw === undefined) { return '—'; }
    var d = decimals == null ? 18 : Number(decimals);
    var mf = maxFrac == null ? 4 : Number(maxFrac);
    var v = typeof raw === 'bigint' ? raw : BigInt(raw);
    var neg = v < 0n;
    if (neg) { v = -v; }
    var base = BigInt('1' + new Array(d + 1).join('0'));
    var intPart = (v / base).toString();
    var frac = '';
    if (d > 0) {
      var rem = v % base;
      if (rem !== 0n) {
        frac = rem.toString().padStart(d, '0').slice(0, mf).replace(/0+$/, '');
      }
    }
    var grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + grouped + (frac ? '.' + frac : '');
  }

  return {
    parseUnits: parseUnits,
    formatUnits: formatUnits
  };
});
