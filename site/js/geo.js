/*
 * Wellstreet site — geo.js
 * Jurisdiction gate (F19 honest posture) + jurisdiction disclosure.
 *
 * ── VERBATIM DISCLOSURE (must never be reworded) ─────────────────────────────
 *   "geo-blocking has no adjudicated safe harbor — it reduces, not eliminates, exposure"
 * It is carried on the block page, in the IPFS-mirror banner, and as the constant
 * F19_DISCLOSURE below. site-tests/geo.test.js is the canonical verification surface
 * (per the spec's GATE FIX MAP FIX-5: the ONLY 403 verification surface is the gate's
 * unit test — there is NO live US-simulated 403 probe).
 *
 * ── VERCEL INTEGRATION CHOICE (documented for deploy-prep) ───────────────────
 * Two viable integrations on Vercel; the decision is recorded here for deploy-prep:
 *
 *   PRIMARY (spec-pinned): EDGE MIDDLEWARE reading `x-vercel-ip-country` and returning
 *   the 403 block page (this same template) for blocked codes on PRODUCTION ONLY.
 *   Pros: enforced server-side (the strongest posture — a block page served, not
 *   drawn), sub-ms at the edge, no client round-trip, works with curl/robots too.
 *   Con: on Vercel, middleware requires a framework wrapper around this pure-static
 *   site (e.g. a minimal Next.js shell with `middleware.ts`) — that wrapper must be
 *   accepted at deploy-prep and must NOT introduce any build step into THIS package
 *   (the wrapper would live in the deploy repo, not here; the IPFS mirror stays
 *   framework-free and static).
 *
 *   FALLBACK (framework-free): an `api/geo` EDGE FUNCTION in the deploy repo that
 *   reads `x-vercel-ip-country` server-side; the page calls it once and applies the
 *   client-side overlay below. Pros: zero framework, the repo stays dependency-free
 *   and byte-identical to the IPFS mirror. Cons: enforcement is client-side only
 *   (curl/JS-disabled traffic is not gated), one extra request, and it technically
 *   makes the canonical site carry one serverless route — acceptable under D8,
 *   because D8's serverless-clean rule governs VAULT READS (which stay pure
 *   eth_calls), not the jurisdiction gate.
 *
 *   EITHER WAY: (1) the gate DECISION logic is this module — pure, unit-tested,
 *   shared verbatim by middleware wrapper and overlay; (2) enforcement is
 *   PRODUCTION-ONLY (previews and the IPFS mirror are never gated) per the spec's
 *   GEO-GATE × VERIFY-GATE interaction pin (CI egresses from US IPs — GitHub-hosted
 *   runners — so the per-release serverless-clean Playwright gate MUST target a
 *   non-gated surface, never production); (3) FIX-5 holds: the middleware unit test
 *   is the only 403 verification surface.
 *
 * THIS PACKAGE wires no Vercel integration (no deploys in this scope). The client
 * side here provides: the pure gate (gateDecision), the block-page overlay
 * (applyGate) used as the middleware page template AND as the static-mirror
 * courtesy overlay, and mirror/banner detection (detectMirrorMode).
 */
(function (root, factory) {
  var api = factory(root);
  root.WS = root.WS || {};
  root.WS.geo = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {
  'use strict';

  var F19_DISCLOSURE = 'geo-blocking has no adjudicated safe harbor — it reduces, not eliminates, exposure';

  // PURE: normalize a country code ('us', ' US ', null). Unknown -> null.
  function normalizeCountry(code) {
    if (typeof code !== 'string') { return null; }
    var trimmed = code.trim().toUpperCase();
    return trimmed.length ? trimmed : null;
  }

  // PURE: the gate. country code + gate config {blockedCountries: [...]} -> decision.
  // A KNOWN blocked code -> blocked:true. Unknown/absent code -> allow (with the
  // disclosure banner by default) — the gate only ever acts on a known code.
  function gateDecision(countryCode, gate) {
    var list = (gate && Array.isArray(gate.blockedCountries)) ? gate.blockedCountries : [];
    var code = normalizeCountry(countryCode);
    var known = code !== null;
    var blocked = known && list.indexOf(code) !== -1;
    return {
      countryCode: code,
      known: known,
      blocked: blocked,
      disclosure: F19_DISCLOSURE
    };
  }

  // PURE-ish: mirror-mode detection for the disclosure banner. Config override wins.
  // Auto-heuristics: ENS gateways (.eth.limo / .eth.link) and ?mirror=1.
  function detectMirrorMode(cfg) {
    if (cfg && cfg.mirrorMode === true) { return true; }
    if (cfg && cfg.mirrorMode === false) { return false; }
    try {
      if (typeof location !== 'undefined' && location && location.hostname) {
        var host = location.hostname.toLowerCase();
        if (host.endsWith('.eth.limo') || host.endsWith('.eth.link') || host.endsWith('.eth')) {
          return true;
        }
        if (location.search && location.search.indexOf('mirror=1') !== -1) { return true; }
      }
    } catch (e) { /* non-browser: not mirror mode */ }
    return false;
  }

  // DOM: apply a decision. Blocked -> replace the page body with the block template
  // (#ws-geo-block) carrying the F19 disclosure verbatim. Non-blocked -> show the
  // jurisdiction banner when serving from a non-gating mirror. All DOM access is
  // guarded so this module stays safe to import in Node tests.
  function applyGate(decision, opts) {
    opts = opts || {};
    if (typeof document === 'undefined' || !document) { return { applied: 'noop' }; }

    if (decision && decision.blocked) {
      var tpl = document.getElementById('ws-geo-block');
      var countrySlot = null;
      var disclosureNodes = [];
      if (tpl) {
        var frag = tpl.content ? tpl.content.cloneNode(true) : null;
        if (frag) {
          countrySlot = frag.querySelector('[data-geo-country]');
          var disc = frag.querySelectorAll('[data-geo-disclosure]');
          for (var i = 0; i < disc.length; i++) { disclosureNodes.push(disc[i]); }
          document.body.textContent = '';
          document.body.appendChild(frag);
          document.body.setAttribute('data-geo-blocked', 'true');
          document.title = 'Access restricted — Wellstreet';
        }
      }
      if (countrySlot) { countrySlot.textContent = decision.countryCode || ''; }
      for (var d = 0; d < disclosureNodes.length; d++) {
        disclosureNodes[d].textContent = F19_DISCLOSURE;
      }
      return { applied: 'blocked' };
    }

    var banner = document.getElementById('ws-jurisdiction-banner');
    if (banner && (opts.mirrorMode || detectMirrorMode(opts.config))) {
      banner.hidden = false;
      var bannerDisc = banner.querySelectorAll('[data-geo-disclosure]');
      for (var b = 0; b < bannerDisc.length; b++) { bannerDisc[b].textContent = F19_DISCLOSURE; }
      return { applied: 'banner' };
    }
    return { applied: 'allow' };
  }

  return {
    F19_DISCLOSURE: F19_DISCLOSURE,
    normalizeCountry: normalizeCountry,
    gateDecision: gateDecision,
    detectMirrorMode: detectMirrorMode,
    applyGate: applyGate
  };
});
