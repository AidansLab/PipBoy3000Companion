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
 * glyph-probe.mjs - print Pip-Boy font glyphs as ASCII art over USB serial.
 *
 * Useful when a menu needs a character the stock firmware never uses: the
 * objective markers, for instance, are a matched pair - \x81 is a filled 8x9
 * box and \x80 the hollow one, both stringWidth 8, so swapping between them
 * never reflows wrapped text.
 *
 *   node scripts/glyph-probe.mjs                 # control 'A' plus 0x80..0x8F
 *   node scripts/glyph-probe.mjs 80 81           # specific code points (hex)
 *   node scripts/glyph-probe.mjs --range 90 9f   # an inclusive hex range
 *   node scripts/glyph-probe.mjs --font Monofonto18 81
 *
 * SAFE TO RUN ANY TIME: each glyph is drawn into a small offscreen Graphics
 * buffer created on the device and read back with getPixel. The real display
 * (global `h`) is never touched, nothing is written to Storage or the SD card,
 * and the buffer is garbage-collected when the expression returns. Close the
 * Electron app first so the COM port is free.
 */

import { SerialBridge } from '../src/serial-bridge.js';

/** Probe canvas. Wide/tall enough for the largest Monofonto face in use. */
const W = 24;
const H = 28;
const EVAL_TIMEOUT_MS = 15000;

function parseArgs(argv) {
  const opts = { codes: [], font: 'Monofonto14', port: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--font') opts.font = argv[++i];
    else if (a === '--port') opts.port = argv[++i];
    else if (a === '--range') {
      const lo = parseInt(argv[++i], 16);
      const hi = parseInt(argv[++i], 16);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) {
        throw new Error('--range needs two hex code points, low first');
      }
      for (let c = lo; c <= hi; c++) opts.codes.push(c);
    } else if (a === '-h' || a === '--help') opts.help = true;
    else {
      const c = parseInt(a, 16);
      if (!Number.isFinite(c)) throw new Error(`Not a hex code point: ${a}`);
      opts.codes.push(c);
    }
  }
  if (!opts.codes.length) {
    // 'A' first as a control: if it renders, the font and pixel readback work.
    opts.codes = [0x41, ...Array.from({ length: 16 }, (_, i) => 0x80 + i)];
  }
  return opts;
}

function usage() {
  console.log(`Usage: node scripts/glyph-probe.mjs [--port COM#] [--font NAME] [--range LO HI] [CODE...]
  CODE         hex code point, e.g. 81 (repeatable)
  --range LO HI  inclusive hex range
  --font NAME  font face (default Monofonto14; the firmware also has
               Monofonto16/18/23/28)
  --port COM#  serial port override (default: auto-detect)

Draws into an offscreen buffer on the device - the screen is never touched.`);
}

/**
 * Build the device-side expression. setFont<Name>() are built-in methods in
 * this firmware's Espruino build, so any Graphics instance can use them -
 * no need to borrow the live display object.
 */
function probeExpr(code, font) {
  return (
    `(()=>{try{` +
    `var gp=Graphics.createArrayBuffer(${W},${H},1,{msb:true});` +
    `gp.setFont${font}();` +
    `var ch=String.fromCharCode(${code});` +
    `var w=gp.stringWidth(ch);` +
    `gp.setColor(0).fillRect(0,0,${W - 1},${H - 1}).setColor(1);` +
    `gp.setFontAlign(-1,-1).drawString(ch,0,0);` +
    `var rows=[];` +
    `for(var y=0;y<${H};y++){var r='';` +
    `for(var x=0;x<${W};x++){r+=gp.getPixel(x,y)?'#':'.';}rows.push(r);}` +
    `return JSON.stringify({w:w,rows:rows});` +
    `}catch(e){return 'ERR '+e.toString()}})()`
  );
}

/**
 * bridge.eval() resolves with the RAW response and the REPL may prefix banner
 * noise (same case flash-fw.js handles). Our expression always returns a JSON
 * string, so take the last quoted token.
 */
function parseLastJson(raw) {
  const text = String(raw).trim();
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/("(?:[^"\\]|\\.)*")\s*$/);
    if (!m) throw new Error(`Unparseable device response: ${JSON.stringify(text.slice(-160))}`);
    return JSON.parse(m[1]);
  }
}

/** Trim fully blank rows top and bottom so the art is compact. */
function trimBlank(rows) {
  let top = 0;
  let bottom = rows.length - 1;
  while (top <= bottom && !rows[top].includes('#')) top++;
  while (bottom >= top && !rows[bottom].includes('#')) bottom--;
  return top > bottom ? [] : rows.slice(top, bottom + 1);
}

/**
 * Classify a shape so a matched filled/hollow pair is obvious without
 * eyeballing every glyph: a hollow shape has at least one row whose interior
 * between the outermost lit pixels is entirely unlit.
 */
function classify(rows) {
  if (!rows.length) return 'blank';
  const hollow = rows.some((row) => {
    const first = row.indexOf('#');
    const last = row.lastIndexOf('#');
    return first >= 0 && last > first + 1 &&
      row.slice(first + 1, last).split('').every((c) => c === '.');
  });
  return hollow ? 'outlined (has hollow rows)' : 'solid';
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    usage();
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    usage();
    return;
  }

  const bridge = new SerialBridge({ comPort: opts.port, autoReconnect: false });
  bridge.on('status', (m) => console.log(`[status] ${m}`));
  bridge.on('error', (e) => console.error(`[serial] ${e.message}`));

  const summary = [];
  try {
    await bridge.connect();
    for (const code of opts.codes) {
      const hex = '0x' + code.toString(16).padStart(2, '0');
      const inner = parseLastJson(await bridge.eval(probeExpr(code, opts.font), EVAL_TIMEOUT_MS));
      if (typeof inner === 'string' && inner.startsWith('ERR')) {
        console.log(`\n=== ${hex} === ${inner}`);
        continue;
      }
      const g = JSON.parse(inner);
      const rows = trimBlank(g.rows);
      const kind = classify(rows);
      summary.push({ hex, w: g.w, kind });

      console.log(`\n=== ${hex}  width=${g.w}  ${kind} ===`);
      if (!rows.length) console.log('  (no glyph at this code point)');
      else for (const r of rows) console.log('  ' + r.replace(/\.+$/, ''));
    }

    console.log('\n--- summary ---');
    for (const s of summary) {
      console.log(`${s.hex}  width=${String(s.w).padEnd(3)} ${s.kind}`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (bridge.connected) await bridge.disconnect();
  }
}

main();
