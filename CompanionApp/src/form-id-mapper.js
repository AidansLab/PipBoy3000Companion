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
 * form-id-mapper.js
 *
 * Maps Fallout game form IDs to the Pip-Boy 3000's internal form IDs.
 *
 * The Pip-Boy device has its own pre-built item database stored as .DAT files
 * on its SD card (e.g., /DATA/F3/MISC.DAT, /DATA/FNV/WEAP.DAT). Form IDs in
 * those files use fixed plugin offsets baked into the replica firmware - they
 * do NOT follow the player's live mod load order.
 *
 * Both game plugins emit a `loadOrder` array so we can identify which plugin
 * owns a form ID. The Pip-Boy then uses a fixed high byte per plugin
 * (independent of where that plugin sits in the player's load order).
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

// Fixed Pip-Boy high byte per FNV plugin (from Wand Company data layout).
// null = use the game's mod index as-is (FalloutNV / TribalPack share 0x00).
const FNV_PIPBOY_PLUGIN_HIGH_BYTE = {
  'falloutnv.esm': null,
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

/** @deprecated Use FNV_PIPBOY_PLUGIN_HIGH_BYTE */
const FNV_PIPBOY_PLUGIN_OFFSETS = FNV_PIPBOY_PLUGIN_HIGH_BYTE;

// Fixed Pip-Boy high byte per FO3 plugin, same idea as FNV above. Verified
// directly against a real replica firmware dump (FW/1.1.6/DATA/F3/*.DAT,
// parsed per the DataFile format in FW-decoded.js: u32 recordCount, u32
// recordSize, then recordCount form IDs, then recordCount JSON records) by
// grouping items by form-ID high byte and matching known per-DLC item names
// (e.g. high byte 0x02 held Tesla Cannon/Tri-beam Laser Rifle/Callahan's
// Magnum - all Broken Steel exclusives) across WEAPONS.DAT and APPAREL.DAT.
// The order is alphabetical by .esm filename (Anchorage, BrokenSteel,
// PointLookout, ThePitt, Zeta) - NOT DLC release order - matching how a
// vanilla FO3 install with no load-order manager sorts master files.
const FO3_PIPBOY_PLUGIN_HIGH_BYTE = {
  'fallout3.esm': null,
  'anchorage.esm': 0x01,
  'brokensteel.esm': 0x02,
  'pointlookout.esm': 0x03,
  'thepitt.esm': 0x04,
  'zeta.esm': 0x05,
};

// Tale of Two Wastelands runs FO3's plugins inside FNV. Their items keep
// their FO3 Pip-Boy high byte with this bit added, so the device (in NV mode)
// can tell them apart and look them up in DATA/F3. Must stay below 0x80: the
// firmware's InvFile.get() rebuilds ids with a signed `<< 24`.
const TTW_PIPBOY_FLAG = 0x40;

// Game items the Pip-Boy's DAT knows under a different form ID, as
// [gamePlugin, gameLocalId, datPlugin, datLocalId] (plugins by lowercase file
// name; the DAT's plugin can differ from the game item's). Game -> Pip-Boy
// always sends the DAT's ID; Pip-Boy -> game sends the DAT's item if the
// player holds it, otherwise whichever listed variant they hold (see
// setHeldItems), otherwise the DAT's item. Variants of one item have the same
// name and are never meant to be held together except where noted below.
//   Neural Interface Suit: the DAT only has the in-simulation suit
//     (DLC02ArmorSimSuit 00A6C0); leaving the sim swaps it for the otherwise
//     identical DLC02ArmorSimSuit2 (00BB28).
//   Operation Anchorage rewards: the DAT has the Capital Wasteland versions
//     (...Wasteland); inside the simulation the player holds the sim versions
//     of the same items (e.g. DLC02WeapGaussRifle 003A04 vs 00C07D).
//   Anchorage sim copies of base-game and Zeta items: the sim hands the player
//     its own DLC02* copy of e.g. the 10mm Pistol; the DAT only has the
//     original.
//   Other duplicates (several records, one name): head wraps, Merc outfits,
//     the Armored Vault 101 Jumpsuit, Broken Steel's Composite Recon Helmet,
//     Zeta's Sheriff's Hat. Players can hold these together - e.g. head wraps
//     of different colours - so they share one Pip-Boy row (counts are merged
//     by the sync engine).
const ID_ALIASES = [
  // Neural Interface Suit (post-sim -> sim)
  ['anchorage.esm', 0x00bb28, 'anchorage.esm', 0x00a6c0],
  // Anchorage rewards (sim -> wasteland)
  ['anchorage.esm', 0x003a04, 'anchorage.esm', 0x00c07d], // Gauss Rifle
  ['anchorage.esm', 0x003f44, 'anchorage.esm', 0x00c07b], // Trench Knife
  ['anchorage.esm', 0x00b554, 'anchorage.esm', 0x00c07c], // Jingwei's Shocksword
  ['anchorage.esm', 0x003a02, 'anchorage.esm', 0x00c18f], // Chinese Stealth Armor
  ['anchorage.esm', 0x003af9, 'anchorage.esm', 0x00c18b], // Winterized Combat Armor
  ['anchorage.esm', 0x003afc, 'anchorage.esm', 0x00c18c], // Winterized Combat Helmet
  ['anchorage.esm', 0x001f09, 'anchorage.esm', 0x00c18d], // Winterized T-51b Power Armor
  ['anchorage.esm', 0x001f08, 'anchorage.esm', 0x00c18e], // Winterized T-51b Power Helmet
  // Anchorage sim copies of base-game items
  ['anchorage.esm', 0x003f49, 'fallout3.esm', 0x00434f], // 10mm Pistol
  ['anchorage.esm', 0x003f4a, 'fallout3.esm', 0x004350], // Silenced 10mm Pistol
  ['anchorage.esm', 0x003f72, 'fallout3.esm', 0x004321], // 10mm Submachine Gun
  ['anchorage.esm', 0x003f3e, 'fallout3.esm', 0x01ffec], // Assault Rifle
  ['anchorage.esm', 0x003f3f, 'fallout3.esm', 0x00080b], // Chinese Assault Rifle
  ['anchorage.esm', 0x003f40, 'fallout3.esm', 0x02b3cb], // Chinese Officer's Sword
  ['anchorage.esm', 0x003f41, 'fallout3.esm', 0x004325], // Chinese Pistol
  ['anchorage.esm', 0x003f42, 'fallout3.esm', 0x00432d], // Flamer
  ['anchorage.esm', 0x003f43, 'fallout3.esm', 0x004330], // Frag Grenade
  ['anchorage.esm', 0x003f45, 'fallout3.esm', 0x00433c], // Frag Mine
  ['anchorage.esm', 0x003f46, 'fallout3.esm', 0x004340], // Missile Launcher
  ['anchorage.esm', 0x003f47, 'fallout3.esm', 0x00433f], // Minigun
  ['anchorage.esm', 0x003f48, 'fallout3.esm', 0x004353], // Sniper Rifle
  ['anchorage.esm', 0x00c6f0, 'fallout3.esm', 0x004347], // Power Fist
  ['anchorage.esm', 0x00c7c2, 'fallout3.esm', 0x004327], // Combat Shotgun
  ['anchorage.esm', 0x00cbfc, 'fallout3.esm', 0x004336], // Laser Rifle
  ['anchorage.esm', 0x00cdde, 'fallout3.esm', 0x020426], // Combat Helmet
  ['anchorage.esm', 0x00c1ca, 'fallout3.esm', 0x0340d2], // Chinese Jumpsuit
  ['anchorage.esm', 0x00ad7b, 'zeta.esm', 0x00ab6d], // General Chase's Overcoat
  // Other duplicates
  ['fallout3.esm', 0x06c587, 'fallout3.esm', 0x034121], // Armored Vault 101 Jumpsuit
  ['brokensteel.esm', 0x0088b5, 'fallout3.esm', 0x0cb5fb], // Composite Recon Helmet
  ['zeta.esm', 0x003305, 'fallout3.esm', 0x02dd80], // Sheriff's Hat
  ['fallout3.esm', 0x074334, 'fallout3.esm', 0x074296], // Head Wrap (dark gray)
  ['fallout3.esm', 0x074335, 'fallout3.esm', 0x074296], // Head Wrap (plaid)
  ['fallout3.esm', 0x074336, 'fallout3.esm', 0x074296], // Head Wrap (gray)
  ['fallout3.esm', 0x0cb606, 'fallout3.esm', 0x034122], // Merc Charmer Outfit
  ['fallout3.esm', 0x0cb607, 'fallout3.esm', 0x034123], // Merc Troublemaker Outfit
  ['fallout3.esm', 0x0cb608, 'fallout3.esm', 0x034124], // Merc Adventurer Outfit
  ['fallout3.esm', 0x0cb60a, 'fallout3.esm', 0x0a3045], // Merc Grunt Outfit
  ['fallout3.esm', 0x0cb60b, 'fallout3.esm', 0x0c5d34], // Merc Cruiser Outfit
];
const aliasKey = (plugin, localId) => `${plugin}:${localId}`;
const ALIAS_BY_GAME = new Map(ID_ALIASES.map((a) => [aliasKey(a[0], a[1]), a]));
const ALIASED_ITEMS = new Set(ID_ALIASES.flatMap((a) => [aliasKey(a[0], a[1]), aliasKey(a[2], a[3])]));

const PIPBOY_PLUGIN_HIGH_BYTE_BY_MODE = {
  F3: FO3_PIPBOY_PLUGIN_HIGH_BYTE,
  FNV: FNV_PIPBOY_PLUGIN_HIGH_BYTE,
};

function pipboyHighByteForPlugin(pluginName, gameModIndex, gameMode = 'FNV') {
  const table = PIPBOY_PLUGIN_HIGH_BYTE_BY_MODE[gameMode];
  if (!table || !Object.prototype.hasOwnProperty.call(table, pluginName)) {
    return null;
  }
  const fixed = table[pluginName];
  return fixed === null ? gameModIndex & 0xff : fixed;
}

function normalizePluginName(name) {
  return String(name).toLowerCase().replace(/^.*[\\/]/, '').trim();
}

function parseFormId(formId) {
  if (formId === undefined || formId === null) return null;
  if (typeof formId === 'number' && Number.isFinite(formId)) return formId >>> 0;
  const trimmed = String(formId).trim().toLowerCase();
  if (trimmed.startsWith('0x')) {
    const parsed = parseInt(trimmed, 16);
    return Number.isNaN(parsed) ? null : parsed >>> 0;
  }
  const parsed = parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? null : parsed >>> 0;
}

function buildFormId(modIndex, localId) {
  return (((modIndex & 0xff) << 24) | (localId & 0x00ffffff)) >>> 0;
}

/** Format a form ID for the game plugin pipe (always 0x + 8 hex digits). */
function formatGameFormId(formId) {
  const parsed = parseFormId(formId);
  if (parsed === null) return String(formId);
  return '0x' + parsed.toString(16).padStart(8, '0');
}

// Item type categories matching the game engine's record types
const ITEM_CATEGORIES = [
  'WEAP',  // Weapons
  'ARMO',  // Armor & Clothing
  'AMMO',  // Ammunition
  'MISC',  // Miscellaneous items
  'AID',   // Aid items (stimpaks, food, etc.)
  'NOTE',  // Notes & Holotapes
  'BOOK',  // Books & Magazines
  'KEYM',  // Keys
];

export class FormIdMapper {
  constructor() {
    // Maps: gameMode -> formId -> { name, type, pipboyFormId }
    this.databases = {
      F3: new Map(),
      FNV: new Map(),
    };
    // Reverse maps: gameMode -> pipboyFormId -> gameFormId
    this.reverse = {
      F3: new Map(),
      FNV: new Map(),
    };
    this.loaded = false;

    // Perk databases
    this.perks = {
      F3: new Map(),
      FNV: new Map(),
    };

    // Runtime load order from the game plugin: mod index -> plugin filename.
    this.loadOrder = new Map();
    this.loadOrderByName = new Map();
    this.loadOrderSignature = '';

    // Game IDs (uint32) of ID_ALIASES items (either variant) the player holds.
    this.heldAliased = new Set();
  }

  /**
   * Record which aliased item variants the player holds, from a game snapshot,
   * so a Pip-Boy action on the shared device item reaches the right game item.
   */
  setHeldItems(snapshot) {
    const held = new Set();
    const note = (formId) => {
      const id = parseFormId(formId);
      if (id === null) return;
      const pluginName = this.loadOrder.get((id >>> 24) & 0xff);
      if (pluginName && ALIASED_ITEMS.has(aliasKey(pluginName, id & 0x00ffffff))) held.add(id);
    };
    for (const item of snapshot?.inventory || []) note(item.formId);
    const player = snapshot?.player;
    for (const src of [snapshot, player]) {
      if (Array.isArray(src?.equippedapparel)) src.equippedapparel.forEach(note);
      note(src?.equippedweap);
    }
    this.heldAliased = held;
  }

  /**
   * The Pip-Boy form ID (high byte included) for a plugin's local ID, or null
   * when that plugin has no Pip-Boy byte in this game mode.
   */
  _pipboyId(pluginName, gameModIndex, localId, gameMode) {
    let highByte = pipboyHighByteForPlugin(pluginName, gameModIndex, gameMode);
    if (highByte === null && this.isTTW(gameMode) && pluginName in FO3_PIPBOY_PLUGIN_HIGH_BYTE) {
      // fallout3.esm's FO3 byte is "its own index", which natively is 0x00.
      highByte = TTW_PIPBOY_FLAG | (FO3_PIPBOY_PLUGIN_HIGH_BYTE[pluginName] ?? 0);
    }
    return highByte === null ? null : buildFormId(highByte, localId);
  }

  /**
   * Pip-Boy -> game: the aliased variant the player holds for this device
   * item, as a game form ID. Null when none applies (the DAT's own item is
   * held, or no variant is) and the normal mapping should be used.
   */
  _heldVariantFor(pipboyId, gameMode) {
    for (const [fromPlugin, fromLocal, toPlugin, toLocal] of ID_ALIASES) {
      const toIndex = this.loadOrderByName.get(toPlugin);
      if (this._pipboyId(toPlugin, toIndex, toLocal, gameMode) !== pipboyId) continue;
      if (toIndex !== undefined && this.heldAliased.has(buildFormId(toIndex, toLocal))) return null;
      const fromIndex = this.loadOrderByName.get(fromPlugin);
      if (fromIndex === undefined) continue;
      const gameId = buildFormId(fromIndex, fromLocal);
      if (this.heldAliased.has(gameId)) return gameId;
    }
    return null;
  }

  /**
   * Load the item databases from JSON files
   */
  async load() {
    try {
      await this._loadDatabase('F3', 'fo3-items.json');
      await this._loadDatabase('FNV', 'fonv-items.json');
      await this._loadPerks('F3', 'fo3-perks.json');
      await this._loadPerks('FNV', 'fonv-perks.json');
      this.loaded = true;
    } catch (err) {
      // Databases are optional - mapper still works in pass-through mode
      console.warn(`[FormIdMapper] Warning: Could not load item databases: ${err.message}`);
      console.warn('[FormIdMapper] Running in pass-through mode (game form IDs used directly)');
      this.loaded = false;
    }
  }

  async _loadDatabase(mode, filename) {
    const filepath = join(DATA_DIR, filename);
    try {
      const data = JSON.parse(await readFile(filepath, 'utf8'));
      for (const item of data) {
        const pipboyFormId = item.pipboyFormId || item.formId;
        this.databases[mode].set(item.formId, {
          name: item.name,
          type: item.type,
          pipboyFormId,
        });
        this.reverse[mode].set(String(pipboyFormId).toLowerCase(), item.formId);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      // File doesn't exist - that's OK, just means no mapping data yet
    }
  }

  async _loadPerks(mode, filename) {
    const filepath = join(DATA_DIR, filename);
    try {
      const data = JSON.parse(await readFile(filepath, 'utf8'));
      for (const perk of data) {
        this.perks[mode].set(perk.formId, {
          name: perk.name,
          pipboyFormId: perk.pipboyFormId || perk.formId,
        });
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  /**
   * Update runtime mod load order from a game snapshot.
   * @param {Array<{index:number,name:string}>|null|undefined} plugins
   * @returns {boolean} true when the load order changed
   */
  setLoadOrder(plugins) {
    if (!Array.isArray(plugins) || plugins.length === 0) {
      const changed = this.loadOrder.size > 0;
      this.loadOrder.clear();
      this.loadOrderByName.clear();
      this.loadOrderSignature = '';
      return changed;
    }

    const signature = plugins
      .map((p) => `${p.index}:${normalizePluginName(p.name)}`)
      .join('|');
    if (signature === this.loadOrderSignature) return false;

    this.loadOrder.clear();
    this.loadOrderByName.clear();
    for (const entry of plugins) {
      if (entry.index === undefined || entry.index === null || !entry.name) continue;
      const name = normalizePluginName(entry.name);
      this.loadOrder.set(entry.index, name);
      this.loadOrderByName.set(name, entry.index);
    }
    this.loadOrderSignature = signature;
    return true;
  }

  /** True when Tale of Two Wastelands is loaded (FO3's master inside FNV). */
  isTTW(gameMode) {
    return gameMode === 'FNV' && this.loadOrderByName.has('fallout3.esm');
  }

  _resolveByLoadOrder(gameFormId, gameMode) {
    const table = PIPBOY_PLUGIN_HIGH_BYTE_BY_MODE[gameMode];
    if (!table || this.loadOrder.size === 0) return null;

    const id = parseFormId(gameFormId);
    if (id === null) return null;

    const gameModIndex = (id >>> 24) & 0xff;
    const pluginName = this.loadOrder.get(gameModIndex);
    if (!pluginName) return null;
    const localId = id & 0x00ffffff;

    // Aliased item: use the DAT's plugin and ID (which can be another plugin).
    const alias = ALIAS_BY_GAME.get(aliasKey(pluginName, localId));
    if (alias) {
      const aliasIndex = this.loadOrderByName.get(alias[2]) ?? gameModIndex;
      const aliased = this._pipboyId(alias[2], aliasIndex, alias[3], gameMode);
      if (aliased !== null) return aliased;
    }

    return this._pipboyId(pluginName, gameModIndex, localId, gameMode);
  }

  _resolveToGameByLoadOrder(pipboyFormId, gameMode) {
    const table = PIPBOY_PLUGIN_HIGH_BYTE_BY_MODE[gameMode];
    if (!table || this.loadOrder.size === 0) return null;

    const id = parseFormId(pipboyFormId);
    if (id === null) return null;

    const localId = id & 0x00ffffff;
    const pipboyModIndex = (id >>> 24) & 0xff;

    const variant = this._heldVariantFor(id, gameMode);
    if (variant !== null) return variant;

    if (pipboyModIndex & TTW_PIPBOY_FLAG && this.isTTW(gameMode)) {
      const fo3Byte = pipboyModIndex & ~TTW_PIPBOY_FLAG;
      for (const [pluginName, fixed] of Object.entries(FO3_PIPBOY_PLUGIN_HIGH_BYTE)) {
        if ((fixed ?? 0) !== fo3Byte) continue;
        const gameModIndex = this.loadOrderByName.get(pluginName);
        return gameModIndex === undefined ? null : buildFormId(gameModIndex, localId);
      }
      return null;
    }

    for (const pluginName of Object.keys(table)) {
      const gameModIndex = this.loadOrderByName.get(pluginName);
      if (gameModIndex === undefined) continue;
      if (pipboyHighByteForPlugin(pluginName, gameModIndex, gameMode) === pipboyModIndex) {
        return buildFormId(gameModIndex, localId);
      }
    }

    return null;
  }

  /**
   * Resolve a game form ID to a Pip-Boy form ID
   *
   * @param {string|number} gameFormId - The form ID from the game
   * @param {'F3'|'FNV'} gameMode - Which game's ID space to use
   * @returns {string|number|null} The Pip-Boy form ID, or null if unknown
   */
  resolve(gameFormId, gameMode) {
    const db = this.databases[gameMode];
    if (this.loaded && db) {
      const entry = db.get(gameFormId);
      if (entry?.pipboyFormId !== undefined && entry.pipboyFormId !== entry.formId) {
        return entry.pipboyFormId;
      }
    }

    const remapped = this._resolveByLoadOrder(gameFormId, gameMode);
    if (remapped !== null) return remapped;

    if (this.loaded && db?.get(gameFormId)) {
      return db.get(gameFormId).pipboyFormId;
    }

    return gameFormId;
  }

  /**
   * Resolve a Pip-Boy form ID back to a game form ID (reverse of resolve()).
   * Used for device-initiated actions (item used/equipped on the Pip-Boy).
   * Falls back to pass-through when no mapping is known.
   *
   * @param {string|number} pipboyFormId
   * @param {'F3'|'FNV'} gameMode
   * @returns {string|number} The game form ID
   */
  resolveToGame(pipboyFormId, gameMode) {
    if (this.loaded) {
      const rev = this.reverse[gameMode];
      const mapped = rev?.get(String(pipboyFormId).toLowerCase());
      if (mapped) return mapped;
    }

    const remapped = this._resolveToGameByLoadOrder(pipboyFormId, gameMode);
    if (remapped !== null) return remapped;

    return pipboyFormId;
  }

  /**
   * Look up item info by form ID
   */
  getItemInfo(gameFormId, gameMode) {
    const db = this.databases[gameMode];
    if (!db) return null;
    return db.get(gameFormId) || null;
  }

  /**
   * Look up perk info by form ID
   */
  getPerkInfo(gameFormId, gameMode) {
    const db = this.perks[gameMode];
    if (!db) return null;
    return db.get(gameFormId) || null;
  }

  /**
   * Get all known items for a game mode
   */
  getAllItems(gameMode) {
    const db = this.databases[gameMode];
    if (!db) return [];
    return Array.from(db.entries()).map(([formId, info]) => ({
      formId,
      ...info,
    }));
  }

  /**
   * Get all known items of a specific type
   */
  getItemsByType(gameMode, type) {
    return this.getAllItems(gameMode).filter(item => item.type === type);
  }

  /**
   * Get stats about loaded databases
   */
  getStats() {
    return {
      fo3Items: this.databases.F3.size,
      fonvItems: this.databases.FNV.size,
      fo3Perks: this.perks.F3.size,
      fonvPerks: this.perks.FNV.size,
      loaded: this.loaded,
      loadOrderPlugins: this.loadOrder.size,
    };
  }
}

export {
  ID_ALIASES,
  ITEM_CATEGORIES,
  FNV_PIPBOY_PLUGIN_HIGH_BYTE,
  FNV_PIPBOY_PLUGIN_OFFSETS,
  FO3_PIPBOY_PLUGIN_HIGH_BYTE,
  TTW_PIPBOY_FLAG,
  normalizePluginName,
  parseFormId,
  buildFormId,
  formatGameFormId,
  pipboyHighByteForPlugin,
};
export default FormIdMapper;
