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
 * map-sync.js
 *
 * Resolves the player's live worldspace + world position to a Pip-Boy World
 * Map key + pixel coordinates on the fixed 2048x2048 map canvas.
 *
 * All values come from the game's own ESM WRLD records (MNAM/ONAM/NAM0/NAM9,
 * see map-icon-tools/mnam-calibration.mjs) or FalloutNV.exe's decompiled
 * World Map rescale constant - nothing here is empirically fitted. Every
 * worldspace, including a map's own root, goes through its own ONAM:
 *
 *   center = midpoint(worldspace's NAM0, NAM9)
 *   adjusted = center + (worldPos - center) * ONAM.scale + ONAM.offset
 *   norm = (adjusted - rootMNAM.min) / (rootMNAM.max - rootMNAM.min)
 *   pixel = (norm * 0.796875 + 0.1015625) * 2048
 */

const MAP_CANVAS_SIZE = 2048;

/**
 * gameMode -> plugin -> local worldspace form ID -> {mapKey, scale,
 * offsetX, offsetY, centerX, centerY}. mapKey is the map this worldspace
 * plots onto (not always its owning plugin's own map - e.g. Freeside plots
 * onto WMAP despite being part of falloutnv.esm). scale/offset is the
 * worldspace's own ONAM; center is its NAM0/NAM9 midpoint. FNV entries are
 * confirmed against real screenshots; F3 entries are real ESM data but
 * unverified on real hardware.
 */
const WORLDSPACE_MAP = {
  FNV: {
    'falloutnv.esm': {
      0x0da726: { mapKey: 'WMAP', scale: 1, offsetX: 0, offsetY: 0, centerX: 0, centerY: 0 }, // WastelandNV (root)
      0x10beea: { mapKey: 'WMAP', scale: 0.699999988079071, offsetX: -16000, offsetY: 103000, centerX: -6144, centerY: 8192 }, // FreesideWorld
      0x110628: { mapKey: 'WMAP', scale: 0.699999988079071, offsetX: -23000, offsetY: 90000, centerX: -6144, centerY: 12288 }, // GamorrahWorld
      0x12a914: { mapKey: 'WMAP', scale: 1, offsetX: -4800, offsetY: 88000, centerX: -2048, centerY: -2048 }, // GreenhouseWorld01
      0x12d94d: { mapKey: 'WMAP', scale: 0.699999988079071, offsetX: -16000, offsetY: 103000, centerX: -6144, centerY: 10240 }, // FreesideNorthWorld
      0x12d94e: { mapKey: 'WMAP', scale: 0.699999988079071, offsetX: -16000, offsetY: 103000, centerX: -6144, centerY: 12288 }, // FreesideFortWorld
      0x13b308: { mapKey: 'WMAP', scale: 1, offsetX: -20500, offsetY: 88000, centerX: 0, centerY: 0 }, // TheStripWorldNew
      0x13c0b6: { mapKey: 'WMAP', scale: 1, offsetX: 86000, offsetY: 45000, centerX: 2048, centerY: 2048 }, // TheFortWorld
      0x148c05: { mapKey: 'WMAP', scale: 1, offsetX: -16400, offsetY: 90000, centerX: 0, centerY: 0 }, // WastelandNVmini
      0x14c723: { mapKey: 'WMAP', scale: 1, offsetX: 58000, offsetY: 10000, centerX: 0, centerY: 6144 }, // BoulderCityWorld - DeadMoney.esm-override ONAM, see note above
      0x16d714: { mapKey: 'WMAP', scale: 1, offsetX: -16400, offsetY: 90000, centerX: 0, centerY: 0 }, // Lucky38World
    },
    'deadmoney.esm': {
      0x000bac: { mapKey: 'DLCDM', scale: 10, offsetX: 8000, offsetY: 32000, centerX: -8192, centerY: 14336 }, // NVDLC01Villa (root)
      0x001315: { mapKey: 'DLCDM', scale: 10, offsetX: -77000, offsetY: 74000, centerX: 4096, centerY: 8192 }, // NVDLC01WestTownN (Puesta del Sol North)
      0x006edb: { mapKey: 'DLCDM', scale: 10, offsetX: -78000, offsetY: 40000, centerX: 2048, centerY: 0 }, // NVDLC01WestTownS (Puesta del Sol South)
      0x00b050: { mapKey: 'DLCDM', scale: 10, offsetX: 36000, offsetY: 40000, centerX: 0, centerY: 6144 }, // NVDLC01EastTownN (Salida del Sol North)
      0x003575: { mapKey: 'DLCDM', scale: 10, offsetX: 36000, offsetY: 40000, centerX: 0, centerY: 6144 }, // NVDLC01EastTownS (Salida del Sol South)
      0x0076ba: { mapKey: 'DLCDM', scale: 10, offsetX: 8000, offsetY: 16000, centerX: -8192, centerY: 12288 }, // NVDLC01VillaDean (Residential District)
      0x0094e8: { mapKey: 'DLCDM', scale: 10, offsetX: -78000, offsetY: 154000, centerX: -6144, centerY: 14336 }, // NVDLC01VillaChristine (Medical District)
    },
    'honesthearts.esm': {
      0x00683b: { mapKey: 'DLCHH', scale: 1.100000023841858, offsetX: 500, offsetY: 2500, centerX: 0, centerY: 0 }, // NVDLC02ZionCanyon (root)
    },
    'oldworldblues.esm': {
      0x000e81: { mapKey: 'DLCOW', scale: 2.1700000762939453, offsetX: 0, offsetY: 32000, centerX: 0, centerY: 0 }, // NVDLC03BigMT (root)
    },
    'lonesomeroad.esm': {
      0x0004d5d: { mapKey: 'DLCLR', scale: 1.399999976158142, offsetX: -81700, offsetY: 12000, centerX: 0, centerY: 0 }, // NVDLC04DivideVistaWorld (root)
      0x002866: { mapKey: 'DLCLR', scale: 1.409999966621399, offsetX: -24900, offsetY: -6000, centerX: 32768, centerY: 14336 }, // NVDLC04Road01World (The Lonesome Road)
      0x002c7e: { mapKey: 'DLCLR', scale: 1.2999999523162842, offsetX: -6500, offsetY: 15000, centerX: 10240, centerY: -4096 }, // NVDLC04DivideWorld (The Divide)
      0x002f73: { mapKey: 'DLCLR', scale: 1.2999999523162842, offsetX: -8000, offsetY: -500, centerX: 18432, centerY: 26624 }, // NVDLC04Road02World (The High Road)
      0x00aa02: { mapKey: 'DLCLR', scale: 0.20000000298023224, offsetX: 18000, offsetY: 44000, centerX: 2048, centerY: -4096 }, // NVDLC04NukeSilo2 (Courier's Mile)
      0x00a9ed: { mapKey: 'WMAP', scale: 0.20000000298023224, offsetX: -112000, offsetY: -120000, centerX: 8192, centerY: 6144 }, // NVDLC04NukeNCR (Long 15) - plots onto WMAP, not DLCLR
      0x00aa01: { mapKey: 'WMAP', scale: 0.20000000298023224, offsetX: 88000, offsetY: -128000, centerX: 0, centerY: 4096 }, // NVDLC04NukeLegion (Dry Wells) - plots onto WMAP, not DLCLR
    },
  },
  F3: {
    'fallout3.esm': {
      0x00003c: { mapKey: 'WMAP', scale: 1, offsetX: 0, offsetY: 0, centerX: 0, centerY: 4096 }, // Wasteland (root)
      0x000a74: { mapKey: 'WMAP', scale: 1, offsetX: 0, offsetY: 0, centerX: 0, centerY: -14336 }, // MegatonWorld
      0x018de6: { mapKey: 'WMAP', scale: 0.5, offsetX: 2048, offsetY: 6076, centerX: 55296, centerY: -20480 }, // DCworld01 (Chevy Chase)
      0x01a25d: { mapKey: 'WMAP', scale: 0.3499999940395355, offsetX: -4000, offsetY: 10000, centerX: 34816, centerY: -45056 }, // DCworld18 (Arlington National Cemetery)
      0x01a25e: { mapKey: 'WMAP', scale: 0.5, offsetX: 0, offsetY: 2000, centerX: 26624, centerY: -53248 }, // DCworld17 (Falls Church)
      0x01a260: { mapKey: 'WMAP', scale: 0.30000001192092896, offsetX: 2132, offsetY: -22000, centerX: 30720, centerY: -36864 }, // DCworld15 (Mason District)
      0x01a263: { mapKey: 'WMAP', scale: 1, offsetX: 0, offsetY: 0, centerX: 53248, centerY: -26624 }, // DCworld11 (Georgetown)
      0x01a264: { mapKey: 'WMAP', scale: 0.4000000059604645, offsetX: -25200, offsetY: 5000, centerX: 104448, centerY: -49152 }, // DCworld12 (Seward Square)
      0x01a265: { mapKey: 'WMAP', scale: 0.5, offsetX: 1500, offsetY: -5000, centerX: 45056, centerY: -32768 }, // DCworld10 (L'Enfant Plaza) - BrokenSteel-expanded bounds, see note above
      0x01a266: { mapKey: 'WMAP', scale: 0.4000000059604645, offsetX: -2850, offsetY: -2248, centerX: 61440, centerY: -34816 }, // DCworld09 (The Mall)
      0x01a267: { mapKey: 'WMAP', scale: 0.5, offsetX: -800, offsetY: -1000, centerX: 55296, centerY: -26624 }, // DCworld08 (Pennsylvania Avenue) - BrokenSteel-expanded bounds, see note above
      0x01a269: { mapKey: 'WMAP', scale: 0.75, offsetX: -8000, offsetY: 1000, centerX: 65536, centerY: -18432 }, // DCworld06 (Vernon Square)
      0x01a26a: { mapKey: 'WMAP', scale: 0.4000000059604645, offsetX: -6096, offsetY: -6758, centerX: 88064, centerY: -12288 }, // DCworld05 (Takoma Park)
      0x01a26c: { mapKey: 'WMAP', scale: 0.5, offsetX: -2048, offsetY: -1500, centerX: 38912, centerY: -16384 }, // DCworld03 (Dupont Circle)
      0x01e37f: { mapKey: 'WMAP', scale: 1, offsetX: 0, offsetY: 0, centerX: 36864, centerY: -18432 }, // GNRroofWorld
      0x0271c0: { mapKey: 'WMAP', scale: 1, offsetX: 0, offsetY: 0, centerX: 73728, centerY: -36864 }, // MonumentWorld
      0x029aaa: { mapKey: 'WMAP', scale: 1, offsetX: -11000, offsetY: 2000, centerX: 79872, centerY: -26624 }, // StatesmanRoofWorld
      0x02f222: { mapKey: 'WMAP', scale: 1, offsetX: 0, offsetY: 0, centerX: -28672, centerY: 77824 }, // ParadiseFalls
      0x043ea6: { mapKey: 'WMAP', scale: 1, offsetX: 0, offsetY: 0, centerX: 63488, centerY: -55296 }, // NtlGuardDepotWorld
      0x04c4d1: { mapKey: 'WMAP', scale: 0.5, offsetX: -5000, offsetY: 17000, centerX: 22528, centerY: -65536 }, // MamaDolcesWorld
      0x04d49b: { mapKey: 'WMAP', scale: 1, offsetX: 0, offsetY: 0, centerX: -4096, centerY: 114688 }, // OasisHarold
      0x0a0c2b: { mapKey: 'WMAP', scale: 1, offsetX: 0, offsetY: 0, centerX: -6144, centerY: 61440 }, // Oasis
      0x0c617e: { mapKey: 'WMAP', scale: 0.4000000059604645, offsetX: 850, offsetY: -2248, centerX: 57344, centerY: -34816 }, // WashMonTop
    },
    'anchorage.esm': {
      0x000e28: { mapKey: 'DLCANCH', scale: 1.125, offsetX: -5000, offsetY: -35000, centerX: 8192, centerY: 30720 }, // DLC02AnchorageBattle (root)
      0x000804: { mapKey: 'WMAP', scale: 0.75, offsetX: -22000, offsetY: -35000, centerX: 26624, centerY: -24576 }, // DLC02BaileysCrossroads - plots onto WMAP, not DLCANCH
      0x000bf2: { mapKey: 'DLCANCH', scale: 1.5, offsetX: 95000, offsetY: -50000, centerX: 0, centerY: 10240 }, // DLC02Glacier (Anchorage Cliffs)
      0x000e27: { mapKey: 'DLCANCH', scale: 1, offsetX: 50000, offsetY: -20000, centerX: -4096, centerY: -2048 }, // DLC02Overlook (Artillery Overlook)
      0x00161b: { mapKey: 'DLCANCH', scale: 1, offsetX: -5000, offsetY: -35000, centerX: 30720, centerY: 18432 }, // DLC02ChineseHQ
    },
    'thepitt.esm': {
      0x0008c0: { mapKey: 'DLCPITT', scale: 2, offsetX: 1000, offsetY: 5000, centerX: 4096, centerY: 26624 }, // DLC01PittWorld (root)
      0x000d91: { mapKey: 'DLCPITT', scale: 2, offsetX: 18000, offsetY: 17500, centerX: 4096, centerY: 10240 }, // DLC01MarketSquare (Downtown)
      0x0011a9: { mapKey: 'DLCPITT', scale: 1.600000023841858, offsetX: -6000, offsetY: 20500, centerX: -4096, centerY: -12288 }, // DLC01SteelMillExterior (The Steelyard)
      0x0011aa: { mapKey: 'DLCPITT', scale: 2, offsetX: 14000, offsetY: 34500, centerX: 0, centerY: 4096 }, // DLC01Haven (Uptown)
    },
    'brokensteel.esm': {
      0x000803: { mapKey: 'DLC03', scale: 0.949999988079071, offsetX: 0, offsetY: 0, centerX: -8192, centerY: 0 }, // DLC03AdamsAFB (root, best guess - see note above)
      0x000b0d: { mapKey: 'DLC03', scale: 1.4500000476837158, offsetX: 800, offsetY: 600, centerX: 2048, centerY: 0 }, // DLC03RelayStation - no WNAM either way, see note above
    },
    'pointlookout.esm': {
      0x000802: { mapKey: 'DLC04', scale: 0.9100000262260437, offsetX: -3800, offsetY: 2200, centerX: 22528, centerY: 16384 }, // DLC4Pointlookout (root, best guess - see note above)
      0x00a88c: { mapKey: 'DLC04', scale: 5.21999979019165, offsetX: -44400, offsetY: 17800, centerX: 12288, centerY: 10240 }, // DLC4Bog (Sacred Bog) - no WNAM either way, see note above
    },
  },
};

/**
 * Per-map pure MNAM normalization - world units to 0..2048 pixel space,
 * with NO ONAM applied (that's already handled per-worldspace above).
 *
 *   minX = NWCellX*4096          maxX = SECellX*4096+4096
 *   minY = NWCellY*4096+4096     maxY = SECellY*4096
 *   norm = (0 - min) / (max - min)
 *   pixel = (norm * 0.796875 + 0.1015625) * 2048
 */
const MAP_CALIBRATION = {
  FNV: {
    WMAP: { scaleX: 0.0065317622950819675, offsetX: 1144.3934426229507, scaleY: -0.0065317622950819675, offsetY: 1171.1475409836066 },
    DLCDM: { scaleX: 0.0065317622950819675, offsetX: 1144.3934426229507, scaleY: -0.0065317622950819675, offsetY: 1171.1475409836066 },
    DLCHH: { scaleX: 0.018110795454545456, offsetX: 1024, scaleY: -0.0166015625, offsetY: 1024 },
    DLCOW: { scaleX: 0.018110795454545456, offsetX: 1024, scaleY: -0.0166015625, offsetY: 1024 },
    DLCLR: { scaleX: 0.018110795454545456, offsetX: 1024, scaleY: -0.0166015625, offsetY: 1024 },
  },
  F3: {
    WMAP: { scaleX: 0.0078125, offsetX: 1168, scaleY: -0.0078125, offsetY: 1200 },
    DLCANCH: { scaleX: 0.0078125, offsetX: 1008, scaleY: -0.0078125, offsetY: 1040 },
    DLCPITT: { scaleX: 0.018973214285714284, offsetX: 985.1428571428571, scaleY: -0.018973214285714284, offsetY: 1062.857142857143 },
    DLC03: { scaleX: 0.03622159090909091, offsetX: 1246.5454545454545, scaleY: -0.03622159090909091, offsetY: 1098.181818181818 },
    DLC04: { scaleX: 0.0265625, offsetX: 969.6, scaleY: -0.0265625, offsetY: 1187.1999999999998 },
  },
};

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Resolve a worldspace form ID (from the game snapshot) to a Pip-Boy map key
 * plus the world-space transform needed to place it correctly on that map,
 * using the live load order to identify which plugin owns it.
 * @param {number} worldspaceFormId - 0 means indoors/no worldspace
 * @param {Map<number,string>} loadOrder - gameModIndex -> normalized plugin name (FormIdMapper.loadOrder)
 * @param {'F3'|'FNV'} gameMode
 * @returns {{mapKey: string, transform: {scale:number, offsetX:number, offsetY:number, centerX:number, centerY:number}}|null}
 */
export function resolveWorldspace(worldspaceFormId, loadOrder, gameMode) {
  if (!worldspaceFormId) return null;
  const pluginTable = WORLDSPACE_MAP[gameMode];
  if (!pluginTable || !loadOrder) return null;
  const modIndex = (worldspaceFormId >>> 24) & 0xff;
  const pluginName = loadOrder.get(modIndex);
  if (!pluginName) return null;
  const localTable = pluginTable[pluginName];
  if (!localTable) return null; // untracked plugin - true interior or unaudited
  const localFormId = worldspaceFormId & 0x00ffffff;
  const entry = localTable[localFormId];
  if (!entry) return null; // tracked plugin, unrecognized worldspace - treat like a true interior
  return {
    mapKey: entry.mapKey,
    transform: { scale: entry.scale, offsetX: entry.offsetX, offsetY: entry.offsetY, centerX: entry.centerX, centerY: entry.centerY },
  };
}

/**
 * Convenience wrapper around resolveWorldspace() for callers that only need
 * the map key (e.g. deciding whether to switch the displayed map).
 * @returns {string|null}
 */
export function resolveMapKey(worldspaceFormId, loadOrder, gameMode) {
  const resolved = resolveWorldspace(worldspaceFormId, loadOrder, gameMode);
  return resolved ? resolved.mapKey : null;
}

/**
 * Convert live world X/Y into the map's fixed 0..2048 pixel space.
 * @param {number} worldX
 * @param {number} worldY
 * @param {'F3'|'FNV'} gameMode
 * @param {string} mapKey
 * @param {{scale:number, offsetX:number, offsetY:number, centerX:number, centerY:number}} [transform] - converts worldX/Y into the map's root worldspace coordinates first (identity if omitted)
 * @returns {{x: number, y: number}|null}
 */
export function worldToMapPixel(worldX, worldY, gameMode, mapKey, transform) {
  const calib = MAP_CALIBRATION[gameMode]?.[mapKey];
  if (!calib || typeof worldX !== 'number' || typeof worldY !== 'number') return null;
  const tf = transform || { scale: 1, offsetX: 0, offsetY: 0, centerX: 0, centerY: 0 };
  let x = worldX;
  let y = worldY;
  if (tf.scale !== 1 && tf.scale !== 0) {
    x = tf.centerX + (x - tf.centerX) * tf.scale;
    y = tf.centerY + (y - tf.centerY) * tf.scale;
  }
  const rootX = x + tf.offsetX;
  const rootY = y + tf.offsetY;
  // Deliberately not rounded here - rounding this early stutter-steps slow
  // walking motion; final pixel quantization happens on-device instead.
  const px = clamp(rootX * calib.scaleX + calib.offsetX, 0, MAP_CANVAS_SIZE - 1);
  const py = clamp(rootY * calib.scaleY + calib.offsetY, 0, MAP_CANVAS_SIZE - 1);
  return { x: px, y: py };
}

export { MAP_CANVAS_SIZE, WORLDSPACE_MAP, MAP_CALIBRATION };
