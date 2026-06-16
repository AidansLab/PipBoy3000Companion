/**
 * form-id-mapper.js
 * 
 * Maps Fallout game form IDs to the Pip-Boy 3000's internal form IDs.
 * 
 * The Pip-Boy device has its own pre-built item database stored as .DAT files
 * on its SD card (e.g., /DATA/F3/MISC.DAT, /DATA/FNV/WEAP.DAT). The form IDs
 * used in these files may or may not match the game's form IDs directly.
 * 
 * For the initial version, we assume the Pip-Boy uses the same form IDs as the
 * base game (Fallout3.esm / FalloutNV.esm). This is likely correct for base game
 * items since The Wand Company sourced their data from the official game files.
 * 
 * For mod-added items, form IDs won't match and those items will be skipped.
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

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
   * Resolve a game form ID to a Pip-Boy form ID
   * 
   * @param {string|number} gameFormId - The form ID from the game
   * @param {'F3'|'FNV'} gameMode - Which game's ID space to use
   * @returns {string|number|null} The Pip-Boy form ID, or null if unknown
   */
  resolve(gameFormId, gameMode) {
    if (!this.loaded) {
      // Pass-through mode — assume IDs match
      return gameFormId;
    }

    const db = this.databases[gameMode];
    if (!db) return gameFormId;

    const entry = db.get(gameFormId);
    if (entry) {
      return entry.pipboyFormId;
    }

    // Not in our database — might be a mod item
    // Return the raw ID anyway, the Pip-Boy will just ignore unknown IDs
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
    if (!this.loaded) return pipboyFormId;
    const rev = this.reverse[gameMode];
    if (!rev) return pipboyFormId;
    return rev.get(String(pipboyFormId).toLowerCase()) ?? pipboyFormId;
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
    };
  }
}

export { ITEM_CATEGORIES };
export default FormIdMapper;
