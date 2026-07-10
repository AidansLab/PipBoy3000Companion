/**
 * flash-fw.js
 *
 * Deploy companion changes to the Pip-Boy over USB serial:
 *   - Menu scripts → SD card JS/*.JS (filesystem)
 *   - Core FW patches → Storage .boot0 (runs on boot, stock FW.JS unchanged)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Espruino Storage boot patch — overrides stock FW methods on boot */
export const BOOT0_FIRMWARE = {
  local: 'FW Build/.boot0',
  device: '.boot0',
  storage: true,
};

/** Built menu scripts — every .JS in FW Build/ except FW.JS → JS/<name> on SD */
export const MENU_FIRMWARE_DIR = 'FW Build';

const MENU_SKIP = new Set(['FW.JS']);

/** Re-upload-and-reverify attempts per file if the CRC32 doesn't match. */
const UPLOAD_VERIFY_MAX_ATTEMPTS = 3;

// Standard CRC-32 (zlib polynomial), matching the device's E.CRC32 — local
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

  // Boot patch last — writing Storage boot scripts mid-upload can reload hooks.
  entries.push({ ...BOOT0_FIRMWARE });

  return entries;
}

/**
 * Menu IDs (without .JS) included in this upload — for reloading an open menu.
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

    await bridge.sendCommand(`try{require('fs').statSync('JS')}catch(e){require('fs').mkdir('JS')}`);

    for (const entry of firmwareFiles) {
      const localPath = path.join(fwDir, entry.local);
      if (!fs.existsSync(localPath)) {
        throw new Error(`Missing firmware file: ${localPath}`);
      }

      const content = fs.readFileSync(localPath);
      const dest = entry.storage ? 'Storage' : 'SD';
      log('info', `→ ${entry.device} (${dest}, ${(content.length / 1024).toFixed(1)} KB)`);

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
      // CRC32 against the device's E.CRC32 of what actually landed — one
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
            ? `Do NOT reboot or power-cycle the Pip-Boy — the currently running firmware is unaffected until the ` +
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
