#!/usr/bin/env node
/*
 * Copyright (c) 2026 Aidan Lee-Calamera (aka Aidan's Lab). 
 * All rights reserved.
 *
 * This source code is licensed under the Creative Commons
 * Attribution-NonCommercial-ShareAlike 4.0 International License (CC BY-NC-SA 4.0).
 *
 * You are free to share and adapt this code under the following conditions:
 *  - Attribution: You must give appropriate credit and provide a link to the license.
 *  - Non-Commercial: You may not use this material for commercial purposes.
 *  - ShareAlike: If you alter, transform, or build upon this work, you must
 *    distribute your contributions under the same CC BY-NC-SA 4.0 license.
 *
 * You may obtain a full copy of the License text in the LICENSE file in the
 * root directory of this project repository or online at:
 * https://creativecommons.org/licenses/by-nc-sa/4.0/
 */

/**
 * fw-port-check.mjs - screens a new Pip-Boy OS release against our patched FW.
 *
 * Usage:  node scripts/fw-port-check.mjs <newStockDir> [prevStockDir]
 *   e.g.  node scripts/fw-port-check.mjs ../FW/1.1.6 ../FW/1.1.5
 *
 * <newStockDir> holds the decoded stock files of the new release
 * (FW-decoded.js + the menu *-decoded.js files). [prevStockDir] is the kept
 * stock dir of the release currently ported (auto-detected as the
 * highest-versioned FW/<x.y.z>/ dir when omitted).
 *
 * Checks:
 *
 * 1. FW-decoded.js (kept as pristine stock in FW/): plain-diffed against the
 *    new stock. Changed lines are scanned for the stock symbols boot0
 *    monkey-patches - any hit means a boot0 patch target moved and needs a
 *    human look. No hits + small diff -> boot0 ports as-is.
 *
 * 2. Menus, stock-vs-stock (preferred): when a previous stock dir exists,
 *    each menu is plain-diffed against it - both sides are unmodified stock,
 *    so every real change shows up verbatim, including numeric-only tweaks
 *    that no literal heuristic can see (the 1.1.5 condition-bar shading
 *    change was exactly that). Each printed hunk must be hand-ported into
 *    our modified menu.
 *
 * 3. Menus, literal fallback (no previous stock dir): compares the SET of
 *    string literals per file against OUR menus. Survives mangling, but is
 *    blind to numeric/structural changes - treat a clean result as "probably
 *    untouched", not proof.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FW_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'FW');

// Stock symbols boot0 wraps/replaces/reads. If a new release touches lines
// mentioning any of these in FW.JS, the corresponding boot0 patch needs review.
const BOOT0_PATCH_TARGETS = [
  'DataFile', 'InvFile', 'createScroller', 'drawString', 'Pip.emit',
  'changeMenu', 'loadMenu', 'getinfo', 'setav', 'getMode', 'setTorch',
  'kickIdleTimer', 'setWatches', 'checkChargeStatus', 'VUSB_PRESENT',
  'loadHolotape', 'renderHeader', 'refreshEquip', 'Pip.inv',
];

const MENUS = ['AID', 'AMMO', 'APPAREL', 'GENERAL', 'MISC', 'PERKS',
  'SETTINGS', 'SKILLS', 'SPECIAL', 'STATUS_CND', 'WEAPONS'];

function literals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 2; if (i < 2) break; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') { s += src[j] + src[j + 1]; j += 2; continue; }
        if (c === '`' && src[j] === '$' && src[j + 1] === '{') {
          let d = 1; j += 2; s += '${…}';
          while (j < src.length && d > 0) { if (src[j] === '{') d++; if (src[j] === '}') d--; j++; }
          continue;
        }
        s += src[j]; j++;
      }
      out.push(s); i = j + 1; continue;
    }
    i++;
  }
  return out;
}

// Minimal line-level diff (LCS is overkill: stock releases are near-identical
// line-for-line, so anchor-resync on exact lines is fine for a screen).
function changedLines(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  const changed = [];
  let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (A[i] === B[j]) { i++; j++; continue; }
    // find next resync point
    let ri = -1, rj = -1;
    outer:
    for (let d = 1; d < 200; d++) {
      for (let x = 0; x <= d; x++) {
        if (A[i + x] !== undefined && A[i + x] === B[j + d - x]) { ri = i + x; rj = j + d - x; break outer; }
      }
    }
    if (ri < 0) { changed.push(...A.slice(i), ...B.slice(j)); break; }
    changed.push(...A.slice(i, ri), ...B.slice(j, rj));
    i = ri; j = rj;
  }
  return changed;
}

const newDir = process.argv[2];
if (!newDir || !fs.existsSync(newDir)) {
  console.error('Usage: node scripts/fw-port-check.mjs <newStockDir> [prevStockDir]');
  process.exit(1);
}

// Previous stock dir: explicit arg, else highest-versioned FW/<x.y.z>/ dir
// that isn't the new one.
let prevDir = process.argv[3];
if (prevDir && !fs.existsSync(prevDir)) {
  console.error(`prevStockDir not found: ${prevDir}`);
  process.exit(1);
}
if (!prevDir) {
  const verKey = (name) => name.split('.').map((n) => parseInt(n, 10) || 0);
  const candidates = fs.readdirSync(FW_DIR)
    .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
    .filter((name) => path.resolve(FW_DIR, name) !== path.resolve(newDir))
    .sort((a, b) => {
      const [x, y] = [verKey(a), verKey(b)];
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
  prevDir = candidates.length ? path.join(FW_DIR, candidates[candidates.length - 1]) : null;
}
console.log(prevDir
  ? `Previous stock baseline: ${prevDir} (menus diffed stock-vs-stock)`
  : 'No previous stock dir found - menus fall back to the literal-set check (blind to numeric-only changes).');

let actionNeeded = false;

// ── 1. Core firmware ─────────────────────────────────────────────────────────
const oldFw = fs.readFileSync(path.join(FW_DIR, 'FW-decoded.js'), 'utf8');
const newFw = fs.readFileSync(path.join(newDir, 'FW-decoded.js'), 'utf8');
if (oldFw === newFw) {
  console.log('FW.JS: identical - boot0 ports as-is.');
} else {
  const lines = changedLines(oldFw, newFw);
  console.log(`FW.JS: ${lines.length} changed/added lines.`);
  const hits = new Set();
  for (const line of lines)
    for (const t of BOOT0_PATCH_TARGETS)
      if (line.includes(t)) hits.add(t);
  if (hits.size) {
    actionNeeded = true;
    console.log(`  ⚠ boot0 patch targets touched: ${[...hits].join(', ')}`);
    console.log('    Review the matching boot0 patches before shipping.');
  } else {
    console.log('  ✓ no boot0 patch targets in the changed lines.');
  }
}

// ── 2. Menus ─────────────────────────────────────────────────────────────────
for (const m of MENUS) {
  const stockPath = path.join(newDir, `${m}-decoded.js`);
  if (!fs.existsSync(stockPath)) { console.log(`${m}: (not in new release)`); continue; }
  const newStock = fs.readFileSync(stockPath, 'utf8');

  const prevPath = prevDir && path.join(prevDir, `${m}-decoded.js`);
  if (prevPath && fs.existsSync(prevPath)) {
    // Stock-vs-stock: exact, catches everything.
    const prevStock = fs.readFileSync(prevPath, 'utf8');
    if (prevStock === newStock) { console.log(`${m}: ✓ identical to previous stock`); continue; }
    const lines = changedLines(prevStock, newStock);
    actionNeeded = true;
    console.log(`${m}: ⚠ ${lines.length} changed/added lines vs previous stock - port each into our menu:`);
    for (const line of lines) console.log(`    ${line.trimEnd()}`);
    continue;
  }

  // Fallback: literal-set heuristic against our modified menu.
  const oursPath = path.join(FW_DIR, `${m}-decoded.js`);
  const ours = new Set(literals(fs.readFileSync(oursPath, 'utf8')));
  const stockOnly = [...new Set(literals(newStock))]
    .filter((s) => !ours.has(s) && s.length > 1);
  if (stockOnly.length) {
    actionNeeded = true;
    console.log(`${m}: ⚠ stock-only literals (likely OS change to port):`);
    for (const s of stockOnly) console.log(`    ${JSON.stringify(s)}`);
  } else {
    console.log(`${m}: ✓ clean (literal check only - numeric-only changes not detectable)`);
  }
}

console.log(actionNeeded
  ? '\nResult: changes flagged above need porting. After porting, copy the new stock FW-decoded.js over FW/FW-decoded.js and keep the stock dir for the next check.'
  : '\nResult: no functional changes affect our patches. Copy the new stock FW-decoded.js over FW/FW-decoded.js and keep the stock dir for the next check.');
