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
 * flash-fw.js
 *
 * Deploy companion changes to the Pip-Boy over USB serial:
 *   - Menu scripts -> SD card JS/*.JS (filesystem)
 *   - Core FW patches -> Storage .boot0 (runs on boot, stock FW.JS unchanged)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Espruino Storage boot patch - overrides stock FW methods on boot */
export const BOOT0_FIRMWARE = {
  local: 'FW Build/.boot0',
  device: '.boot0',
  storage: true,
};

/** Built menu scripts - every .JS in FW Build/ except FW.JS -> JS/<name> on SD */
export const MENU_FIRMWARE_DIR = 'FW Build';

const MENU_SKIP = new Set(['FW.JS']);

/** Re-upload-and-reverify attempts per file if the CRC32 doesn't match. */
const UPLOAD_VERIFY_MAX_ATTEMPTS = 3;

/**
 * Floor for free internal Storage before uploading .boot0. Espruino needs
 * contiguous room for the whole new copy during the write, even when
 * replacing an existing .boot0.
 *
 * This is only a floor: ensureStorageSpace() prefers the ACTUAL size of the
 * .boot0 being uploaded plus STORAGE_WRITE_SLACK_BYTES. A fixed constant had
 * already drifted stale once - the patch grew from 15.8 KB to 18.0 KB when
 * quest sync landed, leaving the old 17 KB value smaller than the file it was
 * meant to guarantee room for.
 */
export const STORAGE_MIN_FREE_BYTES = 21 * 1024;

/** Headroom beyond the file size itself, for flash page granularity. */
export const STORAGE_WRITE_SLACK_BYTES = 3 * 1024;

/**
 * Reclaimable device files: crash report + the stock firmware's debug/log
 * appenders (FW.JS debug() writes to debug.txt on battery power until free
 * Storage drops to ~4 KB, which is exactly the state that starves a .boot0
 * install - seen in the field on a device with 63 KB of debug.txt).
 *
 * Deletion walks Storage.list() and erases every entry whose base name
 * matches, rather than going through the StorageFile API: the logs are
 * usually chunked StorageFiles (entries named "debug.txt\1", "\2", ... -
 * each chunk is an ordinary Storage entry underneath, so plain erase works
 * on them), but a plain "debug.txt" written by other firmware variants gets
 * caught by the exact-name match too. An earlier revision used
 * Storage.open(name,'r').getLength() to probe before erasing and left a
 * field device's debug.txt untouched - enumerating what actually exists
 * makes no assumptions about which form the file takes.
 */
// NOTE: deletion walks Storage.list() and picks the erase API per entry
// form, because field devices have held BOTH forms of these logs:
//   - plain records named exactly "debug.txt"  -> Storage.erase(name)
//     (the StorageFile API can never delete these),
//   - chunked StorageFiles ("debug.txt\1", "\2", ...) -> the documented
//     Storage.open(base,'r').erase(), which drops every chunk (the
//     Reference explicitly says not to use Storage.erase on StorageFiles).
// open() MUST get its mode argument - open(name) without one throws.
// Erase failures are returned in `failed` instead of being swallowed - a
// silent catch here cost several support round-trips.
const STORAGE_RECLAIM_EXPR =
  "(()=>{var s=require('Storage');var f=s.getFree();" +
  `if(f>=${STORAGE_MIN_FREE_BYTES})return{free:f,cleaned:[],failed:[],skipped:true};` +
  "var t=['ERROR','debug.txt','log.txt'];var c=[],fl=[];" +
  "s.list().forEach(x=>{" +
  "var b=x,sf=false;" +
  "if(x.length&&x.charCodeAt(x.length-1)<32){b=x.substr(0,x.length-1);sf=true}" +
  "if(t.indexOf(b)<0)return;" +
  "try{" +
  "if(sf){if(c.indexOf(b)<0){s.open(b,'r').erase();c.push(b)}}" +
  "else{s.erase(x);if(c.indexOf(b)<0)c.push(b)}" +
  "}catch(e){fl.push(b+': '+e.message)}" +
  "});" +
  "s.compact();" +
  "return{free:s.getFree(),cleaned:c,failed:fl}})()";

/**
 * Storage.getStats() reports trash directly - space held by superseded copies
 * of entries that have not been compacted away. getFree() alone cannot see it,
 * which is why a leak went unnoticed until a device stopped booting.
 * Returns null on firmware without getStats.
 */
const STORAGE_STATS_EXPR =
  "(()=>{try{var s=require('Storage').getStats();" +
  'return{total:s.totalBytes,free:s.freeBytes,files:s.fileBytes,' +
  'trash:s.trashBytes,trashCount:s.trashCount}}catch(e){return null}})()';

/** Compact alone; see compactStorage() for why reset() has to precede it. */
const STORAGE_COMPACT_EXPR =
  "(()=>{try{require('Storage').compact();return true}catch(e){return false}})()";

/**
 * Trash above this is worth reclaiming before a flash. One .boot0 is ~18 KB,
 * so this triggers after roughly half an install's worth has accumulated -
 * well before it can threaten a write.
 */
export const STORAGE_TRASH_COMPACT_BYTES = 8 * 1024;

/** Storage listing with per-entry byte sizes, for the too-full error message. */
const STORAGE_LISTING_EXPR =
  "require('Storage').list().map(n=>{" +
  "try{var d=require('Storage').read(n);return n+' ('+(d===undefined?'?':d.length)+' b)'}" +
  "catch(e){return n+' (?)'}})";

/**
 * bridge.eval() resolves with the RAW response text, and the REPL may prefix
 * it with boot-banner noise (the prepare step's reset() prints the Espruino
 * banner, which lands in the first eval's buffer) - same issue
 * SerialBridge.getFileCRC32 handles for numeric results. The JSON payload is
 * always last in the buffer, so parse from the latest '{'/'[' that yields
 * valid JSON. Returns undefined if nothing parses.
 */
function parseDeviceJson(raw) {
  const text = String(raw).trim();
  try {
    return JSON.parse(text);
  } catch {
    // Candidate start positions, latest first (banner noise precedes JSON;
    // note the banner itself contains '[' inside ANSI escapes, so scanning
    // from the end is what makes this safe).
    const starts = [text.lastIndexOf('{'), text.lastIndexOf('[')]
      .filter((i) => i >= 0)
      .sort((a, b) => b - a);
    for (const i of starts) {
      try {
        return JSON.parse(text.slice(i));
      } catch {
        // Try the next candidate.
      }
    }
    return undefined;
  }
}

/** Read Storage.getStats(), or null if unsupported/unreadable. */
async function readStorageStats(bridge) {
  try {
    const parsed = parseDeviceJson(await bridge.eval(STORAGE_STATS_EXPR, 10000));
    return parsed && typeof parsed.free === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Reclaim trash left by superseded Storage entries.
 *
 * Espruino Storage is append-only: every .boot0 rewrite leaves the old copy as
 * trash until compaction. A bare compact() during normal operation does
 * NOTHING - it was called three times on a device holding 61 KB of trash and
 * moved none of it. reset() first is what makes it work: it reinitialises the
 * interpreter and drops its references to flash-resident code, freeing
 * compaction to relocate entries. (The firmware reloads across reset() and
 * compaction still succeeds, so stopping it is not the point.)
 *
 * This is why a device broke: five reflashes leaked 61 KB unnoticed because
 * the old check only compacted once free space was already critical.
 */
async function compactStorage(bridge, log) {
  log('info', 'Reinitialising interpreter so Storage can be compacted...');
  try {
    await bridge.sendCommand('reset()');
  } catch {
    // reset() drops the REPL mid-command; not an error.
  }
  await bridge._sleep(2500);
  try {
    await bridge.eval(STORAGE_COMPACT_EXPR, 20000);
  } catch (err) {
    log('warn', `Compaction call failed: ${err.message}`);
  }
  await bridge._sleep(500);
}

/**
 * Ensure internal Storage has room for the .boot0 patch, and that it is not
 * quietly filling with trash.
 *
 * Throws with a diagnostic listing if Storage is still too full - failing here
 * beats uploading the SD menus and then dying on .boot0, which would leave
 * menus and boot patch at mismatched versions.
 * @param {import('./serial-bridge.js').SerialBridge} bridge
 * @param {Function} log
 */
export async function ensureStorageSpace(bridge, log, requiredBytes) {
  // Derive the requirement from the .boot0 actually being uploaded rather
  // than trusting the constant alone: the patch grew past a stale
  // STORAGE_MIN_FREE_BYTES once already (15.8 KB -> 18.0 KB when quest sync
  // landed), which would have let the pre-flight pass a device with no room.
  // The constant stays as the floor for callers that don't pass a size.
  const needed = Math.max(
    STORAGE_MIN_FREE_BYTES,
    Number.isFinite(requiredBytes) ? Math.ceil(requiredBytes + STORAGE_WRITE_SLACK_BYTES) : 0
  );
  // Check trash BEFORE worrying about free space. The old code only compacted
  // once free fell below the threshold, so trash accumulated invisibly across
  // flashes and was never reclaimed until it was already too late.
  const stats = await readStorageStats(bridge);
  if (stats) {
    log(
      'info',
      `Storage: ${stats.free} free, ${stats.files} in files, ` +
        `${stats.trash} trash (${stats.trashCount} entries) of ${stats.total}`
    );
    if (stats.trash >= STORAGE_TRASH_COMPACT_BYTES) {
      await compactStorage(bridge, log);
      const after = await readStorageStats(bridge);
      if (!after) {
        log('warn', 'Could not confirm compaction - continuing on the free-space check alone.');
      } else if (after.trash >= stats.trash) {
        // Verify rather than assume: silently ineffective compaction is the
        // exact failure that leaked 61 KB and broke a device's boot.
        throw new Error(
          `Storage compaction did not reclaim anything (${after.trash} bytes of trash ` +
            `in ${after.trashCount} entries remain, ${after.free} free). Flashing now would ` +
            `leak more. Recover with: node scripts/device-recovery.mjs compact`
        );
      } else {
        log('info', `Reclaimed ${stats.trash - after.trash} bytes (now ${after.free} free)`);
      }
    }
  } else {
    log('info', 'Storage.getStats() unavailable - falling back to free-space checks only.');
  }

  // compact() rewrites flash pages, so allow well beyond the eval default.
  const raw = await bridge.eval(STORAGE_RECLAIM_EXPR, 20000);
  const result = parseDeviceJson(raw);
  if (!result || typeof result.free !== 'number' || !Array.isArray(result.cleaned)) {
    throw new Error(
      `Storage space check returned unexpected result: ${JSON.stringify(String(raw).slice(0, 200))}`
    );
  }

  if (result.cleaned.length > 0) {
    log('info', `Storage was low - deleted ${result.cleaned.join(', ')} and compacted (${result.free} bytes free now)`);
  }
  if (Array.isArray(result.failed) && result.failed.length > 0) {
    log('warn', `Storage cleanup could not erase: ${result.failed.join('; ')}`);
  }

  if (result.free < needed) {
    let listing = '';
    let hint = '';
    try {
      const list = parseDeviceJson(await bridge.eval(STORAGE_LISTING_EXPR, 10000));
      if (Array.isArray(list)) {
        // JSON-escape each name: StorageFile chunk entries end in control
        // chars ("debug.txt\1") that would otherwise print invisibly and
        // make the listing lie about what's on the device.
        listing = ` Storage contains: ${list.map((n) => JSON.stringify(n)).join(', ')}.`;
        if (list.some((n) => String(n).startsWith('.bootcde'))) {
          hint =
            ` .bootcde is code saved from the Espruino IDE ("Save on Send") - if you don't need it, ` +
            `free its space with require('Storage').erase('.bootcde').`;
        }
      }
    } catch {
      // Listing is best-effort diagnostics only.
    }
    throw new Error(
      `Not enough free Pip-Boy Storage for the .boot0 patch: ${result.free} bytes free, ` +
      `need ${needed}.${listing} Connect with the Espruino Web IDE to see ` +
      `what is using the space, then retry.${hint}`
    );
  }
}

// Standard CRC-32 (zlib polynomial), matching the device's E.CRC32 - local
// table-based implementation rather than node:zlib's crc32, which only
// exists from Node 20.15+ while package.json supports >=18.
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** Stop menus/timers so file-upload packets are not interrupted by running FW code. */
export const PREPARE_FOR_FLASH_CMD =
  "(()=>{try{if(typeof Pip==='undefined')return;Pip.remove&&Pip.remove();Pip.audioStop&&Pip.audioStop();if(Pip._fade&&Pip._fade.timer){require('timer').remove(Pip._fade.timer);Pip._fade.timer=null}}catch(e){}typeof cmode!=='undefined'&&(cmode=!1);reset();})()";

/**
 * Build upload list: menu .JS files to SD JS/, then .boot0 to Storage (boot patch last).
 * @param {string} fwDir - Root FW directory (contains FW Build/)
 * @returns {{ local: string, device: string, storage?: boolean }[]}
 */
export function buildFirmwareFileList(fwDir) {
  const boot0Local = path.join(fwDir, BOOT0_FIRMWARE.local);
  if (!fs.existsSync(boot0Local)) {
    throw new Error(`Missing boot patch file: ${boot0Local} (run npm run build-fw)`);
  }

  const menuBuildDir = path.join(fwDir, MENU_FIRMWARE_DIR);
  if (!fs.existsSync(menuBuildDir)) {
    throw new Error(`Missing firmware build directory: ${menuBuildDir}`);
  }

  const entries = [];

  const menuFiles = fs
    .readdirSync(menuBuildDir)
    .filter((name) => {
      const upper = name.toUpperCase();
      return upper.endsWith('.JS') && !MENU_SKIP.has(upper);
    })
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  for (const name of menuFiles) {
    entries.push({
      local: path.join(MENU_FIRMWARE_DIR, name),
      device: `JS/${name}`,
      storage: false,
    });
  }

  // Boot patch last - writing Storage boot scripts mid-upload can reload hooks.
  entries.push({ ...BOOT0_FIRMWARE });

  return entries;
}

/**
 * Menu IDs (without .JS) included in this upload - for reloading an open menu.
 * @param {string} fwDir
 * @returns {string[]}
 */
export function listUploadedMenuIds(fwDir) {
  const menuBuildDir = path.join(fwDir, MENU_FIRMWARE_DIR);
  return fs
    .readdirSync(menuBuildDir)
    .filter((name) => {
      const upper = name.toUpperCase();
      return upper.endsWith('.JS') && !MENU_SKIP.has(upper);
    })
    .map((name) => path.basename(name, path.extname(name)).toUpperCase());
}

/**
 * Resolve the FW directory (dev checkout vs packaged Electron app).
 */
export function resolveFirmwareDir() {
  const candidates = [
    process.env.PIPBOY_FW_DIR,
    path.resolve(__dirname, '../../FW'),
    process.resourcesPath ? path.join(process.resourcesPath, 'FW') : null,
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }

  throw new Error(
    'FW folder not found. Expected ../FW relative to CompanionApp or bundled resources/FW.'
  );
}

/**
 * Upload companion menu scripts and .boot0 patch to the Pip-Boy.
 * @param {import('./serial-bridge.js').SerialBridge} bridge
 * @param {{ log?: Function, fwDir?: string, syncEngine?: import('./sync-engine.js').SyncEngine }} [options]
 */
export async function flashFirmware(bridge, options = {}) {
  const log = options.log || (() => { });
  const fwDir = options.fwDir || resolveFirmwareDir();
  const firmwareFiles = buildFirmwareFileList(fwDir);
  const menuIds = listUploadedMenuIds(fwDir);

  if (!bridge?.connected) {
    throw new Error('Pip-Boy is not connected. Plug in USB and wait for connection.');
  }

  if (options.syncEngine) {
    options.syncEngine.setEnabled(false);
  }

  bridge._firmwareUploadInProgress = true;

  try {
    log('info', `Firmware source: ${fwDir}`);
    log('info', `Uploading ${firmwareFiles.length} file(s) (menus + .boot0 patch)...`);

    log('info', 'Pausing Pip-Boy UI before upload...');
    await bridge.sendCommand(PREPARE_FOR_FLASH_CMD);
    await bridge._sleep(400);

    log('info', 'Checking free device Storage...');
    // Size the check against the .boot0 actually about to be written.
    const boot0Entry = firmwareFiles.find((f) => f.storage);
    let boot0Bytes = 0;
    if (boot0Entry) {
      const boot0Path = path.join(fwDir, boot0Entry.local);
      if (fs.existsSync(boot0Path)) boot0Bytes = fs.statSync(boot0Path).size;
      log('info', `.boot0 is ${(boot0Bytes / 1024).toFixed(1)} KB`);
    }
    await ensureStorageSpace(bridge, log, boot0Bytes);

    await bridge.sendCommand(`try{require('fs').statSync('JS')}catch(e){require('fs').mkdir('JS')}`);

    for (const entry of firmwareFiles) {
      const localPath = path.join(fwDir, entry.local);
      if (!fs.existsSync(localPath)) {
        throw new Error(`Missing firmware file: ${localPath}`);
      }

      const content = fs.readFileSync(localPath);
      const dest = entry.storage ? 'Storage' : 'SD';
      log('info', `-> ${entry.device} (${dest}, ${(content.length / 1024).toFixed(1)} KB)`);

      const packetTimeout = entry.storage || content.length > 12000 ? 12000 : 8000;
      const sendOptions = {
        fs: !entry.storage,
        timeout: packetTimeout,
        progress: (p) => {
          if (p.totalChunks > 1) {
            log('info', `   ${entry.device}: packet ${p.chunk}/${p.totalChunks}`);
          }
        },
      };

      // Every uploaded file is verified by comparing a locally computed
      // CRC32 against the device's E.CRC32 of what actually landed - one
      // small eval round-trip per file, catching truncated/corrupted
      // uploads that per-packet ACKs alone can miss (they carry no
      // checksum, and a lost ACK can duplicate a chunk on retry).
      const localCrc = crc32(content);
      let verified = false;
      let lastProblem = null;
      for (let attempt = 1; attempt <= UPLOAD_VERIFY_MAX_ATTEMPTS && !verified; attempt++) {
        if (attempt > 1) {
          log('info', `   ${entry.device}: verification failed (${lastProblem}), re-uploading (attempt ${attempt}/${UPLOAD_VERIFY_MAX_ATTEMPTS})...`);
        }
        await bridge.espruinoSendFile(entry.device, content, sendOptions);
        try {
          const deviceCrc = await bridge.getFileCRC32(entry.device, {
            fs: !entry.storage,
            timeout: 10000,
          });
          if (deviceCrc === localCrc) {
            verified = true;
          } else if (deviceCrc === null) {
            lastProblem = 'file missing on device';
          } else {
            lastProblem = `CRC mismatch (device ${deviceCrc.toString(16)}, expected ${localCrc.toString(16)})`;
          }
        } catch (err) {
          lastProblem = `CRC check failed: ${err.message}`;
        }
      }

      if (!verified) {
        // .boot0 patches the running firmware on every boot, so a corrupt
        // copy is dangerous the moment the device restarts; a menu script
        // just fails to open. Warn accordingly.
        throw new Error(
          `${entry.device} could not be verified after ${UPLOAD_VERIFY_MAX_ATTEMPTS} attempts (${lastProblem}). ` +
          (entry.storage
            ? `Do NOT reboot or power-cycle the Pip-Boy - the currently running firmware is unaffected until the ` +
              `next boot, but Storage now holds a possibly-corrupt patch. Reconnect and try uploading again.`
            : `Check the USB cable/connection and try uploading again.`)
        );
      }

      log('info', `✓ ${entry.device} (CRC verified)`);
    }

    if (menuIds.length > 0) {
      const idList = menuIds.map((id) => `'${id}'`).join(',');
      await bridge.sendCommand(
        `if(Pip.CURRENT&&Pip.changeMenu&&[${idList}].indexOf(Pip.CURRENT.id)>=0)Pip.changeMenu()`
      );
    }

    log('info', 'Rebooting so .boot0 patch loads on next boot...');
    await bridge.sendCommand('E.reboot();');

    log('info', 'Companion firmware upload complete. Waiting for reboot...');
    return { uploaded: firmwareFiles.length, files: firmwareFiles.map((f) => f.device), rebooted: true };
  } finally {
    bridge._firmwareUploadInProgress = false;
    if (options.syncEngine) {
      options.syncEngine.setEnabled(false);
    }
  }
}

export default flashFirmware;
