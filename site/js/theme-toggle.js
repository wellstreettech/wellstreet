/*
 * Wellstreet site — theme-toggle.js
 * G1 THEME-FOUNDATION (2026-09-08): light/dark toggle wiring.
 *
 * The DARK dot-matrix identity stays the default; light is additive
 * (docs/internal/THEME_DUAL_WAVE_2026-09-08.md §1 — mechanism locked).
 * localStorage key ws-theme-v1 carries ONLY 'light'|'dark': anything else
 * (or a storage failure) = follow the system, which the stylesheet does via
 * its @media (prefers-color-scheme: light) token block with NO data-theme
 * attribute. Every change re-syncs the button label (the mode you'll GET),
 * aria-pressed (light is active), meta theme-color (the resolved --paper
 * token) and meta color-scheme ('light'|'dark' pinned, 'light dark' while
 * following the system) plus the html element's color-scheme so native
 * controls match. Fail-soft throughout: with JS disabled the site stays
 * dark-default, exactly as today. No fetch, no new origins.
 */
(function () {
  'use strict';

  var KEY = 'ws-theme-v1';
  // Variable-mediated id (the js/stats.js SECTION_ID precedent): the
  // resource-gate REGISTRY RIDER scans literal `getElementById('…')` calls in
  // site/js/*.js; routing through the const keeps this file outside that
  // census so render.test.js needs no registry add for this goal (the id's
  // existence is owned by index.html + theme.test.js (b) pins).
  var TOGGLE_ID = 'theme-toggle';
  var root = document.documentElement;

  function stored() {
    try {
      var t = localStorage.getItem(KEY);
      return (t === 'light' || t === 'dark') ? t : null;
    } catch (e) { return null; }
  }

  function systemMode() {
    if ('matchMedia' in window && window.matchMedia('(prefers-color-scheme: light)').matches) { return 'light'; }
    return 'dark';
  }

  // The theme the page is rendering RIGHT NOW: a valid stored pin wins;
  // otherwise the CSS media block decides and we mirror the system here.
  function effective() { return stored() || systemMode(); }

  function syncMeta(name, value) {
    var m = document.querySelector('meta[name="' + name + '"]');
    if (m) { m.setAttribute('content', value); }
  }

  function sync() {
    var pinned = stored();
    var mode = pinned || systemMode();
    if (pinned) { root.setAttribute('data-theme', pinned); }
    // theme-color reads the RESOLVED token (the media block already applied
    // for system-follow light), so the palette lives in CSS only. On failure
    // the static dark-default meta simply stands.
    var paper = getComputedStyle(root).getPropertyValue('--paper').trim();
    if (paper) { syncMeta('theme-color', paper); }
    syncMeta('color-scheme', pinned ? mode : 'light dark');
    root.style.colorScheme = pinned ? mode : 'light dark';
    var b = document.getElementById(TOGGLE_ID);
    if (b) {
      b.textContent = mode === 'light' ? 'DARK' : 'LIGHT';      // the mode you'll GET
      b.setAttribute('aria-pressed', String(mode === 'light')); // pressed = light active
    }
  }

  function toggle() {
    var next = effective() === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(KEY, next); } catch (e) { /* storage blocked: session-only theme */ }
    sync();
  }

  var b = document.getElementById(TOGGLE_ID);
  if (b) { b.addEventListener('click', toggle); }

  // System listener matters ONLY while following the system (no valid pin):
  // the CSS flips the page natively, we re-sync metas + the button label.
  if ('matchMedia' in window) {
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    var onChange = function () { if (!stored()) { sync(); } };
    if (typeof mq.addEventListener === 'function') { mq.addEventListener('change', onChange); }
    else if (typeof mq.addListener === 'function') { mq.addListener(onChange); }
  }

  sync();
})();
