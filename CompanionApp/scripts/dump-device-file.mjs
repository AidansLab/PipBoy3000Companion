#!/usr/bin/env node
/**
 * dump-device-file.mjs - pull files off the Pip-Boy's SD card over USB serial.
 *
 * Read-only against the device. Reconnaissance tool for work that needs to
 * see stock firmware files the repo doesn't ship (e.g. JS/QUESTS.JS and any
 * DATA/NV/QUEST*.DAT) - see the quest sync plan, Phase 0.
 *
 *   node scripts/dump-device-file.mjs --ls JS
 *   node scripts/dump-device-file.mjs --ls DATA/NV
 *   node scripts/dump-device-file.mjs JS/QUESTS.JS
 *   node scripts/dump-device-file.mjs --dir DATA/NV --out ../FW/stock
 *   node scripts/dump-device-file.mjs --port COM5 JS/QUESTS.JS JS/NOTES.JS
 *
 * Files land under --out (default ../FW/stock) at their device path, e.g.
 * FW/stock/JS/QUESTS.JS. Menu .JS files come back Espruino-pretokenised
 * (binary) - decode them with untokenize.js from AidansLab/Pip-Boy-CFW-Builder.
 *
 * How it reads: each chunk is `E.openFile(p,'r').seek(off).read(n)` on the
 * device, base64'd there (btoa) and decoded here. That keeps the device from
 * ever holding a whole file in RAM (the OOM case boot0's Pip.launchApp exists
 * to avoid) and keeps the token bytes (>= 0x80) intact across the REPL, which
 * is text-only. bridge.eval() serialises against other serial traffic and
 * already handles the \x10 echo-suppress / \x04 response framing.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SerialBridge } from '../src/serial-bridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Bytes per device read. Base64 grows this ~4/3 on the way back; 1 KB keeps
 *  each eval response well under the bridge's response handling and gives the
 *  3 s default eval timeout plenty of slack at 19200 baud (~1.9 KB/s). */
const CHUNK_BYTES = 1024;
const EVAL_TIMEOUT_MS = 10000;

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    files: [], dirs: [], ls: [],
    out: path.resolve(__dirname, '../../FW/stock'), port: null,
    head: null, offset: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = path.resolve(argv[++i]);
    else if (a === '--port') opts.port = argv[++i];
    else if (a === '--dir') opts.dirs.push(argv[++i]);
    else if (a === '--ls') opts.ls.push(argv[++i]);
    else if (a === '--head') opts.head = parseInt(argv[++i], 10);
    else if (a === '--offset') opts.offset = parseInt(argv[++i], 10);
    else if (a === '-h' || a === '--help') opts.help = true;
    else opts.files.push(a);
  }
  if (opts.head !== null && !Number.isFinite(opts.head)) throw new Error('--head needs a byte count');
  if (!Number.isFinite(opts.offset)) throw new Error('--offset needs a byte count');
  return opts;
}

function usage() {
  console.log(`Usage: node scripts/dump-device-file.mjs [--port COM#] [--out DIR] (--ls DEVDIR | --dir DEVDIR | DEVPATH)...
  --ls DEVDIR    list a device directory (no download)
  --dir DEVDIR   download every file directly inside DEVDIR
  DEVPATH        download one file (e.g. JS/QUESTS.JS)
  --out DIR      host output root (default FW/stock)
  --port COM#    serial port override (default: auto-detect)
  --head BYTES   read only the first BYTES of each file (partial peek)
  --offset BYTES start reading at BYTES (use with --head)

Partial reads are saved with a .part-<offset>-<len> suffix so they are never
mistaken for a complete file. Handy for large catalogs: the DataFile header is
the first 8 bytes (recordCount u32, recordLen u32).`);
}

// ---------------------------------------------------------------------------
// device helpers
// ---------------------------------------------------------------------------

/**
 * bridge.eval() resolves with RAW response text and the REPL may prefix it
 * with banner noise (see parseDeviceJson in flash-fw.js). Our expressions
 * always yield a JSON string, array or null, so take the LAST such token.
 */
function parseLastJson(raw) {
  const text = String(raw).trim();
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/("(?:[^"\\]|\\.)*"|\[[^\]]*\]|null)\s*$/);
    if (!m) throw new Error(`Unparseable device response: ${JSON.stringify(text.slice(-160))}`);
    return JSON.parse(m[1]);
  }
}

async function deviceEval(bridge, expr) {
  return parseLastJson(await bridge.eval(expr, EVAL_TIMEOUT_MS));
}

async function listDir(bridge, devDir) {
  const d = JSON.stringify(devDir);
  const expr = `(()=>{try{return require('fs').readdirSync(${d})}catch(e){return null}})()`;
  const list = await deviceEval(bridge, expr);
  if (!Array.isArray(list)) throw new Error(`Cannot list ${devDir} (does it exist?)`);
  return list.filter((n) => n && n !== '.' && n !== '..');
}

async function statFile(bridge, devPath) {
  const p = JSON.stringify(devPath);
  const expr = `(()=>{try{var s=require('fs').statSync(${p});return s?JSON.stringify(s):null}catch(e){return null}})()`;
  const raw = await deviceEval(bridge, expr);
  return raw ? JSON.parse(raw) : null;
}

async function readChunk(bridge, devPath, offset, length) {
  const p = JSON.stringify(devPath);
  const expr =
    `(()=>{try{var f=E.openFile(${p},'r');if(!f)return null;f.seek(${offset});` +
    `var s=f.read(${length});f.close();return s===undefined?"":btoa(s)}catch(e){return null}})()`;
  const b64 = await deviceEval(bridge, expr);
  if (b64 === null) throw new Error(`Device could not open/read ${devPath} at offset ${offset}`);
  return Buffer.from(b64, 'base64');
}

async function downloadFile(bridge, devPath, outRoot, { head = null, offset = 0 } = {}) {
  const st = await statFile(bridge, devPath);
  if (!st) throw new Error(`${devPath}: not found on device`);
  if (st.dir) throw new Error(`${devPath}: is a directory (use --dir)`);

  const partial = head !== null || offset > 0;
  const start = offset;
  const end = head !== null ? Math.min(st.size, start + head) : st.size;
  if (start >= st.size && st.size > 0) throw new Error(`${devPath}: offset ${start} past end (${st.size} bytes)`);
  const want = Math.max(0, end - start);

  const chunks = [];
  let got = 0;
  process.stdout.write(`${devPath} (${want}${partial ? ` of ${st.size}` : ''} bytes) `);
  while (got < want) {
    const n = Math.min(CHUNK_BYTES, want - got);
    const buf = await readChunk(bridge, devPath, start + got, n);
    if (buf.length === 0) break; // EOF earlier than stat said - reported below
    chunks.push(buf);
    got += buf.length;
    process.stdout.write('.');
  }
  const data = Buffer.concat(chunks);
  if (data.length !== want) {
    console.log(` WARNING: read ${data.length} of ${want} bytes`);
  } else {
    console.log(' ok');
  }

  // Partial reads get a suffix so a peek is never mistaken for a whole file.
  const rel = devPath.split('/');
  if (partial) rel[rel.length - 1] += `.part-${start}-${data.length}`;
  const outPath = path.join(outRoot, ...rel);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, data);
  console.log(`  -> ${outPath}`);
  return { outPath, size: data.length };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || (!opts.files.length && !opts.dirs.length && !opts.ls.length)) {
    usage();
    process.exitCode = opts.help ? 0 : 1;
    return;
  }

  const bridge = new SerialBridge({ comPort: opts.port, autoReconnect: false });
  bridge.on('status', (m) => console.log(`[status] ${m}`));
  bridge.on('error', (e) => console.error(`[serial] ${e.message}`));

  try {
    await bridge.connect();

    for (const devDir of opts.ls) {
      const names = await listDir(bridge, devDir);
      console.log(`${devDir}/ (${names.length} entries)`);
      for (const n of names) {
        const st = await statFile(bridge, `${devDir}/${n}`);
        const info = st ? (st.dir ? '<dir>' : `${st.size} b`) : '?';
        console.log(`  ${n.padEnd(20)} ${info}`);
      }
    }

    const targets = [...opts.files];
    for (const devDir of opts.dirs) {
      for (const n of await listDir(bridge, devDir)) {
        const st = await statFile(bridge, `${devDir}/${n}`);
        if (st && !st.dir) targets.push(`${devDir}/${n}`);
      }
    }

    if (targets.length) {
      console.log(`Downloading ${targets.length} file(s) -> ${opts.out}`);
      let failed = 0;
      for (const t of targets) {
        try {
          await downloadFile(bridge, t, opts.out, { head: opts.head, offset: opts.offset });
        } catch (err) {
          failed++;
          console.log(`\n  FAILED ${t}: ${err.message}`);
        }
      }
      if (failed) {
        console.log(`${failed} file(s) failed`);
        process.exitCode = 1;
      }
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (bridge.connected) await bridge.disconnect();
  }
}

main();
