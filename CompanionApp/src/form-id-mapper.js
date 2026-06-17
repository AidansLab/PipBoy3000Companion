/**
 * form-id-mapper.js
 *
 * Maps Fallout game form IDs to the Pip-Boy 3000's internal form IDs.
 *
 * The Pip-Boy device has its own pre-built item database stored as .DAT files
 * on its SD card (e.g., /DATA/F3/MISC.DAT, /DATA/FNV/WEAP.DAT). Form IDs in
 * those files use fixed plugin offsets baked into the replica firmware — they
 * do NOT follow the player's live mod load order.
 *
 * For FNV, the game plugin emits a `loadOrder` array so we can identify which
 * plugin owns a form ID. The Pip-Boy then uses a fixed high byte per plugin
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
  'tribalpack.esm': null,
  'mercenarypack.esm': 0x01,
  'classicpack.esm': 0x02,
  'caravanpack.esm': 0x03,
  'deadmoney.esm': 0x04,
  'honesthearts.esm': 0x05,
  'oldworldblues.esm': 0x06,
  'lonesomeroad.esm': 0x07,
  'gunrunnersarsenal.esm': 0x09,
};

/** @deprecated Use FNV_PIPBOY_PLUGIN_HIGH_BYTE */
const FNV_PIPBOY_PLUGIN_OFFSETS = FNV_PIPBOY_PLUGIN_HIGH_BYTE;

function pipboyHighByteForPlugin(pluginName, gameModIndex) {
  if (!Object.prototype.hasOwnProperty.call(FNV_PIPBOY_PLUGIN_HIGH_BYTE, pluginName)) {
    return null;
  }
  const fixed = FNV_PIPBOY_PLUGIN_HIGH_BYTE[pluginName];
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
      // Databases are optional — mapper still works in pass-through mode
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
      // File doesn't exist — that's OK, just means no mapping data yet
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

  _resolveByLoadOrder(gameFormId, gameMode) {
    if (gameMode !== 'FNV' || this.loadOrder.size === 0) return null;

    const id = parseFormId(gameFormId);
    if (id === null) return null;

    const localId = id & 0x00ffffff;
    const gameModIndex = (id >>> 24) & 0xff;
    const pluginName = this.loadOrder.get(gameModIndex);
    if (!pluginName) return null;

    const highByte = pipboyHighByteForPlugin(pluginName, gameModIndex);
    if (highByte === null) return null;

    return buildFormId(highByte, localId);
  }

  _resolveToGameByLoadOrder(pipboyFormId, gameMode) {
    if (gameMode !== 'FNV' || this.loadOrder.size === 0) return null;

    const id = parseFormId(pipboyFormId);
    if (id === null) return null;

    const localId = id & 0x00ffffff;
    const pipboyModIndex = (id >>> 24) & 0xff;

    for (const pluginName of Object.keys(FNV_PIPBOY_PLUGIN_HIGH_BYTE)) {
      const gameModIndex = this.loadOrderByName.get(pluginName);
      if (gameModIndex === undefined) continue;
      if (pipboyHighByteForPlugin(pluginName, gameModIndex) === pipboyModIndex) {
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
  ITEM_CATEGORIES,
  FNV_PIPBOY_PLUGIN_HIGH_BYTE,
  FNV_PIPBOY_PLUGIN_OFFSETS,
  normalizePluginName,
  parseFormId,
  buildFormId,
  pipboyHighByteForPlugin,
};
export default FormIdMapper;
