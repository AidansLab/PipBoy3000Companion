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
 * map-deploy.js
 *
 * Pushes the corrected World Map / DLC map bitmaps (repo-root fixed-maps/)
 * to the Pip-Boy's SD card, replacing the stock factory maps.
 *
 * Runs as part of flashFirmware() rather than a "first install" flag, since
 * the app can't reliably tell a new device from a reflash. A version marker
 * on the SD card (MAP/<NV|F3>/.fixedmaps) lets every flash skip the ~6-7 MB
 * re-upload once it's already current.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Bump whenever fixed-maps/ output changes, to re-sync devices that already have an older copy. */
export const FIXED_MAPS_VERSION = 1;

const MARKER_NAME = '.fixedmaps';

/**
 * Repo-root fixed-maps directory per game mode. Only FNV has corrected maps
 * so far (see map-icon-tools/) - the F3 entry is here so pushing F3 DLC maps
 * later needs no changes beyond regenerating fixed-maps-f3/.
 */
const FIXED_MAPS_BY_MODE = {
  FNV: { localDirName: 'fixed-maps', deviceDir: 'MAP/NV' },
  F3: { localDirName: 'fixed-maps-f3', deviceDir: 'MAP/F3' },
};

/**
 * Resolve a repo-root directory next to FW/ (dev checkout vs packaged
 * Electron app) - mirrors flash-fw.js's resolveFirmwareDir().
 * @param {string} dirName
 * @returns {string|null} Absolute path, or null if not found anywhere.
 */
function resolveRepoRootDir(dirName) {
  const candidates = [
    path.resolve(__dirname, '../..', dirName),
    process.resourcesPath ? path.join(process.resourcesPath, dirName) : null,
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

/**
 * Build the {local, device} upload list for one game mode's fixed maps -
 * every *.MAP file under fixed-maps/<dlc>/*, flattened onto MAP/<NV|F3>/ on
 * the device (matching the stock SD layout, which has no per-DLC
 * subfolder - every *_ICON.MAP for every DLC sits directly in MAP/NV/).
 * @param {'FNV'|'F3'} gameMode
 * @returns {{ localDir: string, deviceDir: string, files: { local: string, device: string }[] }|null}
 */
export function buildFixedMapsFileList(gameMode) {
  const modeInfo = FIXED_MAPS_BY_MODE[gameMode];
  if (!modeInfo) return null;
  const localDir = resolveRepoRootDir(modeInfo.localDirName);
  if (!localDir) return null;

  const files = [];
  for (const dlcFolder of fs.readdirSync(localDir).sort()) {
    const dlcPath = path.join(localDir, dlcFolder);
    if (!fs.statSync(dlcPath).isDirectory()) continue;
    for (const name of fs.readdirSync(dlcPath).sort()) {
      if (!name.toUpperCase().endsWith('.MAP')) continue;
      files.push({
        local: path.join(dlcFolder, name),
        device: `${modeInfo.deviceDir}/${name}`,
      });
    }
  }

  return { localDir, deviceDir: modeInfo.deviceDir, files };
}

/**
 * Read the on-device version marker (small file, safe to pull into a JS
 * string - unlike the multi-hundred-KB/1MB+ map files themselves, see the
 * note on verification below).
 * @param {import('./serial-bridge.js').SerialBridge} bridge
 * @param {string} deviceDir
 * @returns {Promise<number|null>} The marker's version, or null if absent/unreadable.
 */
async function readDeviceMapsVersion(bridge, deviceDir) {
  const markerPath = `${deviceDir}/${MARKER_NAME}`;
  const expr =
    `(()=>{try{var f=E.openFile(${JSON.stringify(markerPath)},'r');var d=f.read(32);f.close();return d===undefined?null:d}catch(e){return null}})()`;
  try {
    const raw = await bridge.eval(expr, 8000);
    const text = String(raw).trim();
    const match = text.match(/-?\d+/);
    return match ? parseInt(match[0], 10) : null;
  } catch {
    return null;
  }
}

/**
 * Ensure a (possibly nested) SD directory exists, one segment at a time.
 * Uses eval(), not sendCommand(), so each mkdir is confirmed before the
 * next segment is attempted - sendCommand only waits for the USB write to
 * drain, not for the SD card to actually finish.
 * @param {import('./serial-bridge.js').SerialBridge} bridge
 * @param {string} dir - e.g. "MAP/NV"
 */
async function ensureSdDir(bridge, dir) {
  const parts = dir.split('/');
  let soFar = '';
  for (const part of parts) {
    soFar = soFar ? `${soFar}/${part}` : part;
    const expr =
      `(()=>{try{require('fs').statSync(${JSON.stringify(soFar)});return true}` +
      `catch(e){try{require('fs').mkdir(${JSON.stringify(soFar)});return true}catch(e2){return false}}})()`;
    const raw = await bridge.eval(expr, 8000);
    if (!/true/.test(String(raw))) {
      throw new Error(`Could not create SD directory "${soFar}"`);
    }
  }
}

/**
 * Push the corrected map bitmaps for the connected device's game mode, if
 * the device doesn't already have the current FIXED_MAPS_VERSION. Never
 * throws - a failure here shouldn't fail an otherwise-successful firmware
 * flash, since the maps are an ancillary asset, not core companion
 * functionality. Returns a short status string for logging.
 * @param {import('./serial-bridge.js').SerialBridge} bridge
 * @param {{ log?: Function, gameMode?: 'FNV'|'F3'|null }} [options] Omit
 *   gameMode entirely to have this call bridge.detectGameMode() itself; pass
 *   null to mean "already tried and couldn't" (skips without retrying).
 * @returns {Promise<{ pushed: boolean, reason: string }>}
 */
export async function deployFixedMapsIfNeeded(bridge, options = {}) {
  const log = options.log || (() => {});

  // undefined = caller didn't resolve one, try now. null = flashFirmware()
  // already tried and failed post-reset - don't retry, it'll fail again.
  let gameMode = options.gameMode;
  if (gameMode === undefined) {
    try {
      gameMode = await bridge.detectGameMode();
    } catch (err) {
      const reason = `could not detect game mode (${err.message})`;
      log('warn', `Skipping fixed map deployment - ${reason}`);
      return { pushed: false, reason };
    }
  } else if (!gameMode) {
    const reason = 'game mode unknown';
    log('warn', `Skipping fixed map deployment - ${reason}`);
    return { pushed: false, reason };
  }

  const listing = buildFixedMapsFileList(gameMode);
  if (!listing || listing.files.length === 0) {
    const reason = `no fixed maps available for ${gameMode} yet`;
    log('info', `Skipping map deployment - ${reason}`);
    return { pushed: false, reason };
  }

  const deviceVersion = await readDeviceMapsVersion(bridge, listing.deviceDir);
  if (deviceVersion === FIXED_MAPS_VERSION) {
    log('info', `Fixed maps already up to date on device (v${FIXED_MAPS_VERSION}) - skipping.`);
    return { pushed: false, reason: 'already up to date' };
  }

  log('info', `Pushing ${listing.files.length} corrected map file(s) for ${gameMode}...`);
  await ensureSdDir(bridge, listing.deviceDir);

  for (const entry of listing.files) {
    const localPath = path.join(listing.localDir, entry.local);
    const content = fs.readFileSync(localPath);
    log('info', `-> ${entry.device} (${(content.length / 1024).toFixed(0)} KB)`);

    const sendOptions = {
      fs: true,
      timeout: 15000,
      progress: (p) => {
        if (p.totalChunks > 1 && p.chunk % 50 === 0) {
          log('info', `   ${entry.device}: packet ${p.chunk}/${p.totalChunks}`);
        }
      },
    };

    // Map files are too large for a full E.CRC32 read-back on the STM32
    // (unlike flash-fw.js's few-KB firmware files), so verify by size instead.
    let verified = false;
    let lastProblem = null;
    for (let attempt = 1; attempt <= 3 && !verified; attempt++) {
      if (attempt > 1) {
        log('info', `   ${entry.device}: verification failed (${lastProblem}), re-uploading (attempt ${attempt}/3)...`);
      }
      await bridge.espruinoSendFile(entry.device, content, sendOptions);
      try {
        const sizeExpr = `(()=>{try{return require('fs').statSync(${JSON.stringify(entry.device)}).size}catch(e){return -1}})()`;
        const raw = await bridge.eval(sizeExpr, 10000);
        const match = String(raw).match(/-?\d+/);
        const deviceSize = match ? parseInt(match[0], 10) : -1;
        if (deviceSize === content.length) {
          verified = true;
        } else {
          lastProblem = `size mismatch (device ${deviceSize}, expected ${content.length})`;
        }
      } catch (err) {
        lastProblem = `size check failed: ${err.message}`;
      }
    }

    if (!verified) {
      throw new Error(`${entry.device} could not be verified after 3 attempts (${lastProblem}).`);
    }
    log('info', `✓ ${entry.device}`);
  }

  await bridge.espruinoSendFile(`${listing.deviceDir}/${MARKER_NAME}`, String(FIXED_MAPS_VERSION), {
    fs: true,
    timeout: 8000,
  });

  log('info', `Fixed map deployment complete (v${FIXED_MAPS_VERSION}).`);
  return { pushed: true, reason: 'deployed' };
}

export default deployFixedMapsIfNeeded;
