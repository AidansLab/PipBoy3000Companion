/**
 * flash-fw.js
 *
 * Upload modified firmware from the repo FW/ folder to the Pip-Boy SD card
 * over the USB serial REPL. Core firmware lives at FW.JS; menu scripts at
 * JS/<NAME>.JS on the device.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Core firmware — always uploaded to the device root */
export const FIRMWARE_CORE = {
  local: 'FW Build/FW.JS',
  device: 'FW.JS',
};

/** Built menu scripts — every other .JS here is uploaded to JS/ on device */
export const MENU_FIRMWARE_DIR = 'FW Build';

/**
 * Build the upload list: FW.JS plus every other .JS in FW Build/ → JS/<name>.
 * @param {string} fwDir - Root FW directory (contains FW Build/)
 * @returns {{ local: string, device: string }[]}
 */
export function buildFirmwareFileList(fwDir) {
  const coreLocal = path.join(fwDir, FIRMWARE_CORE.local);
  if (!fs.existsSync(coreLocal)) {
    throw new Error(`Missing core firmware file: ${coreLocal}`);
  }

  const menuBuildDir = path.join(fwDir, MENU_FIRMWARE_DIR);
  if (!fs.existsSync(menuBuildDir)) {
    throw new Error(`Missing firmware build directory: ${menuBuildDir}`);
  }

  const coreFileName = path.basename(FIRMWARE_CORE.local).toUpperCase();
  const entries = [{ ...FIRMWARE_CORE }];

  const menuFiles = fs
    .readdirSync(menuBuildDir)
    .filter((name) => {
      const upper = name.toUpperCase();
      return upper.endsWith('.JS') && upper !== coreFileName;
    })
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  for (const name of menuFiles) {
    entries.push({
      local: path.join(MENU_FIRMWARE_DIR, name),
      device: `JS/${name}`,
    });
  }

  return entries;
}

/**
 * Menu IDs (without .JS) included in this upload — for reloading an open menu.
 * @param {string} fwDir
 * @returns {string[]}
 */
export function listUploadedMenuIds(fwDir) {
  const coreFileName = path.basename(FIRMWARE_CORE.local).toUpperCase();
  const menuBuildDir = path.join(fwDir, MENU_FIRMWARE_DIR);
  return fs
    .readdirSync(menuBuildDir)
    .filter((name) => {
      const upper = name.toUpperCase();
      return upper.endsWith('.JS') && upper !== coreFileName;
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
 * Upload all modified menu firmware files to the Pip-Boy.
 * @param {import('./serial-bridge.js').SerialBridge} bridge
 * @param {{ log?: Function, fwDir?: string }} [options]
 */
export async function flashFirmware(bridge, options = {}) {
  const log = options.log || (() => { });
  const fwDir = options.fwDir || resolveFirmwareDir();
  const firmwareFiles = buildFirmwareFileList(fwDir);
  const menuIds = listUploadedMenuIds(fwDir);

  if (!bridge?.connected) {
    throw new Error('Pip-Boy is not connected. Plug in USB and wait for connection.');
  }

  const wasEnabled = options.syncEngine?.enabled;
  if (options.syncEngine) {
    options.syncEngine.setEnabled(false);
  }

  try {
    log('info', `Firmware source: ${fwDir}`);
    log('info', `Uploading ${firmwareFiles.length} file(s) to Pip-Boy...`);

    // Ensure JS directory exists on the device
    await bridge.sendCommand(`try{require('fs').statSync('JS')}catch(e){require('fs').mkdir('JS')}`);

    for (const entry of firmwareFiles) {
      const localPath = path.join(fwDir, entry.local);
      if (!fs.existsSync(localPath)) {
        throw new Error(`Missing firmware file: ${localPath}`);
      }

      const content = fs.readFileSync(localPath);
      log('info', `→ ${entry.device} (${(content.length / 1024).toFixed(1)} KB)`);

      await bridge.espruinoSendFile(entry.device, content, {
        fs: true,
        progress: (p) => {
          if (p.totalChunks > 1) {
            log('info', `   ${entry.device}: packet ${p.chunk}/${p.totalChunks}`);
          }
        }
      });

      log('info', `✓ ${entry.device}`);
    }

    // Reload open menu if we just replaced its script
    if (menuIds.length > 0) {
      const idList = menuIds.map((id) => `'${id}'`).join(',');
      await bridge.sendCommand(
        `if(Pip.CURRENT&&Pip.changeMenu&&[${idList}].indexOf(Pip.CURRENT.id)>=0)Pip.changeMenu()`
      );
    }

    // Erase the VERSION file in flash to force an upgrade sequence on next boot
    log('info', 'Erasing VERSION in flash to force upgrade on next boot...');
    await bridge.sendCommand(`try{require("Storage").erase("VERSION");}catch(e){}`);
    await bridge.sendCommand(`E.reboot();`);

    log('info', 'Firmware upload complete. Changes take effect immediately for open menus.');
    return { uploaded: firmwareFiles.length, files: firmwareFiles.map((f) => f.device) };
  } finally {
    if (options.syncEngine && wasEnabled) {
      options.syncEngine.setEnabled(true);
    }
  }
}

export default flashFirmware;
