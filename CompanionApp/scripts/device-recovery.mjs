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
 * device-recovery.mjs - talk to a Pip-Boy that is misbehaving or will not boot.
 *
 * Deliberately does NOT use SerialBridge: that waits for a healthy device and
 * a responsive companion patch. This drives the raw port so it still works
 * when the firmware is wedged.
 *
 *   node scripts/device-recovery.mjs status        # read-only report
 *   node scripts/device-recovery.mjs compact       # reclaim leaked Storage  <-- the important one
 *   node scripts/device-recovery.mjs erase-boot0   # remove the companion patch (revert to stock)
 *   node scripts/device-recovery.mjs wake          # unstick a device whose screen stays dark
 *   node scripts/device-recovery.mjs reboot        # clean reboot and verify
 *
 *   --port COM5   port override (default COM9 or $PIPBOY_PORT)
 *
 * See docs/device-recovery.md for the full background.
 */

import { SerialPort } from 'serialport';

const argv = process.argv.slice(2);
const CMD = argv.find((a) => !a.startsWith('-')) || 'status';
const portIdx = argv.indexOf('--port');
const PATH_ = portIdx >= 0 ? argv[portIdx + 1] : process.env.PIPBOY_PORT || 'COM9';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open() {
  const port = new SerialPort({ path: PATH_, baudRate: 19200, autoOpen: false });
  let rx = '';
  port.on('data', (d) => { rx += d.toString('utf8'); });
  port.on('error', () => {});
  await new Promise((res, rej) => port.open((e) => (e ? rej(e) : res())));
  return {
    port,
    get rx() { return rx; },
    clear() { rx = ''; },
    send: (s) => new Promise((res, rej) => port.write(s, (e) => (e ? rej(e) : res()))),
    close: async () => { if (port.isOpen) await new Promise((r) => port.close(r)); },
  };
}

async function ask(c, label, js, wait = 3000) {
  c.clear();
  await c.send('\x10print(' + js + ')\n');
  await sleep(wait);
  const out = c.rx.replace(/\r/g, '').split('\n')
    .filter((l) => l.trim() && l.trim() !== '>' && !/Function code is null/.test(l))
    .join(' | ');
  if (label) console.log(label.padEnd(24) + ': ' + out.slice(0, 220));
  return out;
}

async function status(c) {
  await ask(c, 'REPL', '"alive " + process.env.VERSION');
  await ask(c, 'firmware loaded', 'typeof Pip');
  await ask(c, 'Pip.sleeping', '(typeof Pip!=="undefined")?JSON.stringify(Pip.sleeping):"n/a"');
  await ask(c, 'current menu', '(typeof Pip!=="undefined"&&Pip.CURRENT&&Pip.CURRENT.id)||"none"');
  await ask(c, 'battery V', '(typeof Pip!=="undefined")?(Pip.battLevel||0).toFixed(2):"n/a"');
  await ask(c, 'companion patch', 'typeof cmode');
  await ask(c, 'Storage entries', "JSON.stringify(require('Storage').list())");
  await ask(c, 'Storage stats', "JSON.stringify(require('Storage').getStats())");
  await ask(c, 'SD JS/ count', "(function(){try{return require('fs').readdirSync('JS').length}catch(e){return 'ERR'}})()");
}

/**
 * THE IMPORTANT ONE.
 *
 * Espruino Storage is append-only: every .boot0 rewrite leaves the previous
 * copy as trash until compaction. Calling compact() during normal operation
 * silently does nothing - which is exactly what flash-fw.js's
 * ensureStorageSpace() does today. Five reflashes leaked 61 KB and eventually
 * broke the boot.
 *
 * reset() is what makes compaction work: it reinitialises the interpreter and
 * drops its references to flash-resident code, freeing compaction to relocate
 * entries. Bare compact() was called three times without it and moved nothing
 * (trashBytes stayed at 61,184); with reset() first it went to 0 immediately.
 *
 * The Ctrl-C spam below is belt-and-braces, NOT the mechanism - the firmware
 * reloads across reset() regardless (typeof Pip === 'function' throughout) and
 * compaction still succeeds.
 */
async function compact(c) {
  console.log('before  : ' + (await ask(c, null, "JSON.stringify(require('Storage').getStats())")));

  console.log('\nreset() + interrupting boot code...');
  await c.send('\x10reset()\n');
  for (let i = 0; i < 30; i++) { await c.send('\x03'); await sleep(100); }
  await sleep(800);
  await ask(c, 'firmware loaded?', 'typeof Pip', 2000);

  console.log('\ncompacting...');
  await ask(c, 'compact', "(function(){try{require('Storage').compact();return 'ok'}catch(e){return 'ERR '+e}})()", 12000);
  const after = await ask(c, null, "JSON.stringify(require('Storage').getStats())", 4000);
  console.log('after   : ' + after);

  try {
    const stats = JSON.parse(after.split('|').pop().trim());
    if (stats.trashBytes > 0) {
      console.log(`\nWARNING: ${stats.trashBytes} bytes of trash remain - compaction did not fully succeed.`);
    } else {
      console.log(`\nOK: trash reclaimed, ${stats.freeBytes} bytes free.`);
    }
  } catch {}

  console.log('\nrebooting back into firmware...');
  await c.send('\x10E.reboot()\n');
  await sleep(5000);
}

async function eraseBoot0(c) {
  await ask(c, 'before', "JSON.stringify(require('Storage').list())");
  await ask(c, 'erase .boot0', "(function(){try{require('Storage').erase('.boot0');return 'erased'}catch(e){return 'ERR '+e}})()", 4000);
  await ask(c, 'after', "JSON.stringify(require('Storage').list())");
  // .boot0's retry timer holds a function body that lived in the erased entry,
  // so it now throws once a second and FW logs each error to Storage. Left
  // alone it eats flash continuously.
  await ask(c, 'stop orphaned timers', 'clearInterval();clearTimeout();"cleared"');
  await ask(c, 'drop the error log',
    "(function(){var S=require('Storage'),n=0;try{S.open('log.txt','r').erase();n++}catch(e){}" +
    "S.list().forEach(function(f){if(/^(log|debug)\\.txt/.test(f)||f==='ERROR'){try{S.erase(f);n++}catch(e){}}});return 'cleaned '+n})()", 4000);
  console.log('\n.boot0 removed. The device now boots stock firmware.');
  console.log('NOTE: the companion menu scripts on the SD (WEAPONS/APPAREL/SETTINGS) need the');
  console.log('globals .boot0 defines, so they will report "unable to load" until it is back.');
}

/**
 * A device whose screen stays dark with the power button doing nothing.
 * Two separate causes seen in the field:
 *   - Pip.sleeping left as a STRING ('WAKING_UP'/'GOING_TO_SLEEP'): FW ignores
 *     the power button entirely while it is one (FW-decoded.js:700).
 *   - Pip.wakeUp() aborting at Pip.setVol() with "Can't change volume when DAC
 *     is powered off", so the wake never reaches the display bring-up.
 */
async function wake(c) {
  await ask(c, 'Pip.sleeping', 'JSON.stringify(Pip.sleeping)');
  await ask(c, 'battery V', '(Pip.battLevel||0).toFixed(2)');
  await ask(c, 'wake (setVol stubbed)',
    '(function(){var s=Pip.setVol;Pip.setVol=function(){};try{Pip.sleeping=false;Pip.wakeUp();return "ok"}' +
    'catch(e){return "ERR "+e}finally{Pip.setVol=s}})()', 8000);
  await sleep(2500);
  await ask(c, 'backlight', '(function(){try{LCD_BL.set();return "on"}catch(e){return "ERR "+e}})()');
  await ask(c, 'menu', '(Pip.CURRENT&&Pip.CURRENT.id)||"none"');
  console.log('\nIf the screen is lit but blank, run: node scripts/device-recovery.mjs reboot');
}

async function reboot() {
  let c = await open();
  await c.send('\x03');
  await sleep(500);
  console.log('rebooting...');
  await c.send('\x10E.reboot()\n');
  await sleep(1500);
  await c.close();

  console.log('waiting for re-enumeration...');
  for (let i = 1; i <= 20; i++) {
    await sleep(3000);
    try {
      c = await open();
      console.log(`reconnected after ~${i * 3}s\n`);
      await sleep(3000);
      await c.send('\x03');
      await sleep(600);
      await status(c);
      await c.close();
      return;
    } catch { process.stdout.write('.'); }
  }
  console.log('\nDid not come back within 60s.');
  console.log('Try a DIFFERENT USB port - a failed enumeration ("Device Descriptor Request');
  console.log('Failed", no COM port) has been seen to clear only by changing ports.');
  process.exitCode = 1;
}

if (CMD === 'reboot') {
  await reboot();
} else {
  let c;
  try {
    c = await open();
    await c.send('\x03');
    await sleep(600);
    if (CMD === 'status') await status(c);
    else if (CMD === 'compact') await compact(c);
    else if (CMD === 'erase-boot0') await eraseBoot0(c);
    else if (CMD === 'wake') await wake(c);
    else {
      console.log('Unknown command: ' + CMD);
      console.log('Use: status | compact | erase-boot0 | wake | reboot');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('FAILED: ' + err.message);
    console.error('If the port is missing entirely, try a different USB port.');
    process.exitCode = 1;
  } finally {
    if (c) await c.close();
  }
}
