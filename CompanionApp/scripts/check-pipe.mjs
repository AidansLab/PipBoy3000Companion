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
 * check-pipe.mjs - validate the game plugin's snapshot JSON straight off the
 * named pipe, without the Pip-Boy or the companion app in the way.
 *
 *   node scripts/check-pipe.mjs              # listen 8s, summarise
 *   node scripts/check-pipe.mjs --seconds 20
 *   node scripts/check-pipe.mjs --dump snap.json   # also save the last snapshot
 *
 * Needs Fallout NV running via nvse_loader.exe with a save loaded (the plugin
 * sends nothing from the main menu). Read-only: it opens the pipe like the
 * companion app does and never writes a command back.
 *
 * A parse failure here is serious: pipe-client.js parses each line the same
 * way, so a malformed snapshot breaks ALL sync - items and stats included -
 * not just whatever field introduced it.
 */

import fs from 'fs';
import net from 'net';

const PIPE = '\\\\.\\pipe\\FalloutPipBoySync';

function parseArgs(argv) {
  const opts = { seconds: 8, pipe: PIPE, dump: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seconds') opts.seconds = parseInt(argv[++i], 10);
    else if (a === '--pipe') opts.pipe = argv[++i];
    else if (a === '--dump') opts.dump = argv[++i];
    else if (a === '-h' || a === '--help') opts.help = true;
  }
  if (!Number.isFinite(opts.seconds) || opts.seconds < 1) opts.seconds = 8;
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log(`Usage: node scripts/check-pipe.mjs [--seconds N] [--dump FILE] [--pipe NAME]
Listens to the game plugin's snapshot pipe and reports JSON health.
Requires the game running via nvse_loader.exe with a save loaded.`);
  process.exit(0);
}

/** Fields every snapshot quest entry must carry, per the wire contract. */
const QUEST_KEYS = 'disp,done,flags,formId,objCount,stage';

let buffer = '';
let lines = 0, parsed = 0, failed = 0, biggest = 0;
let events = [];
let lastSnapshot = null;
let sawQuestsField = 0;
const badLines = [];
const questIssues = [];

const sock = net.createConnection(opts.pipe, () => {
  console.log(`connected to ${opts.pipe} - listening ${opts.seconds}s...`);
});

sock.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    lines++;
    biggest = Math.max(biggest, line.length);

    let obj;
    try {
      obj = JSON.parse(line);
      parsed++;
    } catch (e) {
      failed++;
      if (badLines.length < 3) badLines.push({ err: e.message, line });
      continue;
    }

    if (obj.event) { events.push(obj.event); continue; }
    lastSnapshot = obj;
    if (!Array.isArray(obj.quests)) continue;
    sawQuestsField++;

    // Contract checks on the quest rows.
    for (const q of obj.quests) {
      const keys = Object.keys(q).sort().join(',');
      if (keys !== QUEST_KEYS) {
        questIssues.push(`keys ${keys} on ${q.formId}`);
        continue;
      }
      // done must be a subset of disp: an objective cannot be completed
      // without having been displayed, and the renderer relies on it.
      const disp = BigInt('0x' + (q.disp || '0'));
      const done = BigInt('0x' + (q.done || '0'));
      if ((done & ~disp) !== 0n) {
        questIssues.push(`${q.formId}: done 0x${q.done} not a subset of disp 0x${q.disp}`);
      }
      // Mask must fit the objective count the catalog will have.
      if (q.objCount > 0 && disp >= (1n << BigInt(q.objCount))) {
        questIssues.push(`${q.formId}: disp 0x${q.disp} exceeds objCount ${q.objCount}`);
      }
    }
  }
});

sock.on('error', (e) => {
  console.error('pipe error: ' + e.message +
    (e.code === 'ENOENT' ? '  (is the game running via nvse_loader.exe?)' : ''));
  process.exitCode = 1;
});

setTimeout(() => {
  sock.destroy();
  const q = lastSnapshot && Array.isArray(lastSnapshot.quests) ? lastSnapshot.quests : [];

  console.log('\n--- results ---');
  console.log('lines received      : ' + lines);
  console.log('parsed as JSON      : ' + parsed);
  console.log('PARSE FAILURES      : ' + failed);
  console.log('events              : ' + (events.join(', ') || 'none'));
  console.log('snapshots w/ quests : ' + sawQuestsField);
  console.log('quests in last snap : ' + q.length);
  console.log('largest line        : ' + biggest + ' bytes');

  for (const b of badLines) {
    console.log('\n!!! parse failure: ' + b.err);
    console.log('    ' + b.line.slice(0, 300));
  }

  if (q.length) {
    console.log('\nsample quest entries:');
    for (const e of q.slice(0, 3)) console.log('  ' + JSON.stringify(e));
  }

  console.log('\nquest contract issues: ' + (questIssues.length || 'none'));
  for (const i of questIssues.slice(0, 10)) console.log('  ' + i);
  if (questIssues.length > 10) console.log('  (' + (questIssues.length - 10) + ' more)');

  if (opts.dump && lastSnapshot) {
    fs.writeFileSync(opts.dump, JSON.stringify(lastSnapshot, null, 2));
    console.log('\nlast snapshot written to ' + opts.dump);
  }

  const ok = failed === 0 && questIssues.length === 0 && parsed > 0;
  console.log('\n' + (ok ? 'PASS' : 'PROBLEMS FOUND - see above'));
  if (!ok) process.exitCode = 1;
}, opts.seconds * 1000);
