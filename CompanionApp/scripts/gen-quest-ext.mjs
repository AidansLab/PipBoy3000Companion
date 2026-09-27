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
 * gen-quest-ext.mjs - build a supplementary quest catalog for quests the
 * Pip-Boy's own DATA/<mode>/QUESTS.DAT does not contain.
 *
 * The device catalog is fixed game data from The Wand Company and does not
 * cover every quest: measured against a real load order, 168 of 192
 * displayable NV quests are present (88%). Most of the remainder are internal
 * (dialogue holders, achievements), but some are real - "Young Hearts",
 * "Wake Up the Sierra Madre", the Old World Blues repeatables - and mod-added
 * quests are never in it at all.
 *
 * Rather than overwrite TWC's file, this writes a SEPARATE supplement that the
 * QUESTS menu falls back to on a catalog miss. The output is per-playthrough
 * (it depends on load order and installed mods), so it is generated, never
 * committed.
 *
 *   node scripts/gen-quest-ext.mjs                 # write the file locally
 *   node scripts/gen-quest-ext.mjs --upload        # ...and send it to the device
 *   node scripts/gen-quest-ext.mjs --all           # include quests already in the catalog
 *
 * Input is FalloutPipBoyAllQuests.log, written beside the plugin DLL on every
 * game load while PIPBOY_ALLQUESTS_DEBUG is on. It carries the load order, so
 * the game does NOT need to be running when this is used; the Pip-Boy does
 * need to be connected (to read which quests its catalog already has), unless
 * --no-device is given.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SerialBridge } from '../src/serial-bridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Objective-state masks on the device are 64 bits; past that we cannot
 *  represent which objectives are done, so the quest is not worth supplying. */
const MAX_OBJECTIVES = 64;

const DEFAULT_LOG =
  'C:/Program Files (x86)/Steam/steamapps/common/Fallout New Vegas/Data/NVSE/Plugins/FalloutPipBoyAllQuests.log';

/**
 * Fixed Pip-Boy high byte per FNV plugin, mirroring FNV_PIPBOY_PLUGIN_HIGH_BYTE
 * in form-id-mapper.js. Duplicated rather than imported because that table is
 * not exported, and this script must keep working if it is refactored.
 */
const PIPBOY_HIGH_BYTE = {
  'falloutnv.esm': null, // keep the game's own index
  'tribalpack.esm': 0x01,
  'mercenarypack.esm': 0x02,
  'classicpack.esm': 0x03,
  'caravanpack.esm': 0x04,
  'deadmoney.esm': 0x05,
  'honesthearts.esm': 0x06,
  'oldworldblues.esm': 0x07,
  'lonesomeroad.esm': 0x08,
  'gunrunnersarsenal.esm': 0x09,
};

function parseArgs(argv) {
  const opts = { log: DEFAULT_LOG, out: null, upload: false, all: false, device: true, port: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--log') opts.log = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--port') opts.port = argv[++i];
    else if (a === '--upload') opts.upload = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--no-device') opts.device = false;
    else if (a === '-h' || a === '--help') opts.help = true;
  }
  return opts;
}

function usage() {
  console.log(`Usage: node scripts/gen-quest-ext.mjs [options]
  --log FILE    plugin quest dump (default: the NVSE Plugins folder)
  --out FILE    output path (default: <repo>/FW/generated/QUESTS_EXT.TXT)
  --upload      also upload the result to the Pip-Boy
  --all         include quests the device catalog already has
  --no-device   skip reading the device catalog; emit every displayable quest
  --port COM#   serial port override

Generates a supplementary quest catalog. Output is per-playthrough and is not
meant to be committed. Requires PIPBOY_ALLQUESTS_DEBUG=1 in the plugin so the
input log is produced on game load.`);
}

const norm = (s) => String(s).toLowerCase().replace(/^.*[\\/]/, '').trim();

function buildRemapper(loadOrder) {
  const byIndex = new Map();
  for (const entry of loadOrder || []) {
    if (entry && entry.name !== undefined && entry.index !== undefined) {
      byIndex.set(entry.index, norm(entry.name));
    }
  }
  return (formId) => {
    const id = formId >>> 0;
    const gameIndex = (id >>> 24) & 0xff;
    const local = id & 0x00ffffff;
    const plugin = byIndex.get(gameIndex);
    if (plugin === undefined) return { id, plugin: '<unknown>', mod: true };
    if (!Object.prototype.hasOwnProperty.call(PIPBOY_HIGH_BYTE, plugin)) {
      // A mod plugin: the Pip-Boy has no fixed slot, so keep the game's index.
      // These can never be in the stock catalog, which is exactly why the
      // supplement is worth having.
      return { id, plugin, mod: true };
    }
    const fixed = PIPBOY_HIGH_BYTE[plugin];
    const high = fixed === null ? gameIndex : fixed;
    return { id: (((high << 24) | local) >>> 0), plugin, mod: false };
  };
}

async function readDeviceCatalog(port) {
  const bridge = new SerialBridge({ comPort: port, autoReconnect: false });
  bridge.on('status', (m) => console.log('[device] ' + m));
  try {
    await bridge.connect();
    const ids = await bridge.getQuestCatalogIds();
    return { ids, bridge };
  } catch (err) {
    try { if (bridge.connected) await bridge.disconnect(); } catch {}
    throw err;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { usage(); return; }

  if (!fs.existsSync(opts.log)) {
    console.error(`Quest dump not found: ${opts.log}`);
    console.error('Load a save with the plugin installed (PIPBOY_ALLQUESTS_DEBUG=1) to produce it.');
    process.exitCode = 1;
    return;
  }

  const lines = fs.readFileSync(opts.log, 'utf8').split('\n').filter((l) => l.trim());
  let header = null;
  const quests = [];
  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.summary) continue;
    if (obj.loadOrder) { header = obj; continue; }
    quests.push(obj);
  }

  if (!header) {
    console.error('The dump has no load-order header - rebuild the plugin and reload a save.');
    process.exitCode = 1;
    return;
  }

  const remap = buildRemapper(header.loadOrder);
  // Only quests with a name AND objective text can be rendered.
  const displayable = quests.filter((q) => q.name && q.name.trim() && Array.isArray(q.obj) && q.obj.length);
  console.log(`quest records in dump : ${quests.length}`);
  console.log(`displayable           : ${displayable.length}`);

  let catalog = null;
  let bridge = null;
  if (opts.device) {
    try {
      const res = await readDeviceCatalog(opts.port);
      bridge = res.bridge;
      catalog = res.ids ? new Set(res.ids.map((n) => n >>> 0)) : null;
      console.log(`device catalog        : ${catalog ? catalog.size + ' quests' : 'UNREADABLE'}`);
    } catch (err) {
      console.error(`Could not read the device catalog: ${err.message}`);
      console.error('Re-run with --no-device to emit every displayable quest instead.');
      process.exitCode = 1;
      return;
    }
  }

  const records = [];
  let skipped = 0;
  let overLimit = 0;
  for (const q of displayable) {
    const raw = parseInt(q.formId, 16) >>> 0;
    const { id, plugin, mod } = remap(raw);
    if (!opts.all && catalog && catalog.has(id)) { skipped++; continue; }
    // The device stores objective state as two 64-bit masks, so a quest with
    // more objectives than that cannot be represented correctly no matter what
    // the catalog says. Such quests are internal anyway (Elijah Signal
    // Established has 108 "objectives"); including them would also put a very
    // long line in a file the device scans.
    if (q.obj.length > MAX_OBJECTIVES) { overLimit++; continue; }
    records.push({ i: id, txt: q.name.trim(), obj: q.obj, _plugin: plugin, _mod: mod });
  }
  records.sort((a, b) => a.i - b.i);

  console.log(`already in catalog    : ${skipped}`);
  if (overLimit) console.log(`over ${MAX_OBJECTIVES}-objective limit : ${overLimit}  (cannot be state-tracked)`);
  console.log(`supplement records    : ${records.length}`);
  const modCount = records.filter((r) => r._mod).length;
  if (modCount) console.log(`  (of which mod-added : ${modCount})`);

  // One JSON object per line so the device can scan for an id and parse only
  // the matching line - never the whole file into RAM.
  const body = records
    .map((r) => JSON.stringify({ i: r.i, txt: r.txt, obj: r.obj }))
    .join('\n') + (records.length ? '\n' : '');

  const outPath = opts.out
    ? path.resolve(opts.out)
    : path.resolve(__dirname, '../../FW/generated/QUESTS_EXT.TXT');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, body);
  console.log(`\nwrote ${body.length} bytes -> ${outPath}`);

  if (records.length) {
    console.log('\nquests this adds:');
    for (const r of records.slice(0, 40)) {
      console.log(`  0x${r.i.toString(16).padStart(8, '0')}  obj=${String(r.obj.length).padStart(3)}  ${r.txt}${r._mod ? '  [mod]' : ''}`);
    }
    if (records.length > 40) console.log(`  ... and ${records.length - 40} more`);
  }

  if (opts.upload) {
    if (!records.length) {
      // Espruino's file protocol NAKs a zero-length transfer, and an empty
      // supplement is meaningless anyway: either the device already covers
      // everything, or the catalog read was wrong. Say so instead of failing
      // in the transport.
      console.log('\nNothing to upload - the device catalog already covers every');
      console.log('displayable quest. If that is unexpected, the device may be reporting');
      console.log('a stale supplement; check DATA/<mode>/QUESTS_EXT.TXT on the device.');
    } else if (!bridge || !bridge.connected) {
      console.error('\n--upload needs the device; re-run without --no-device.');
      process.exitCode = 1;
    } else {
      const mode = header.game === 'F3' ? 'F3' : 'NV';
      const dest = `DATA/${mode}/QUESTS_EXT.TXT`;
      console.log(`\nuploading -> ${dest} (${body.length} bytes)...`);
      await bridge.espruinoSendFile(dest, Buffer.from(body, 'utf8'), { fs: true, timeout: 12000 });
      const crc = await bridge.getFileCRC32(dest, { fs: true, timeout: 10000 });
      console.log(`uploaded, device CRC32 = ${crc === null ? 'missing!' : crc.toString(16)}`);
    }
  }

  if (bridge && bridge.connected) await bridge.disconnect();
}

main().catch((err) => {
  console.error('Error: ' + err.message);
  process.exitCode = 1;
});
