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
 * sync-engine.js
 * 
 * The core synchronization engine. Takes game state snapshots from the pipe
 * client, diffs them against the previous state, and generates the minimal set
 * of Pip-Boy console commands needed to bring the device in sync.
 * 
 * Key design decisions:
 * - Only sends commands for values that actually changed (diff-based)
 * - Batches inventory changes to minimize serial traffic
 * - Throttles player.sync() calls to protect the Pip-Boy's SD card
 * - Handles full inventory resets when the game changes drastically
 */

import { EventEmitter } from 'events';

const SYNC_FLUSH_INTERVAL_MS = 10000; // How often to call player.sync() on device
const MAX_INVENTORY_DELTA = 50;       // If more than this many items change, do a full reset
// Coalesce rapid game snapshots; leading edge still processes the first change immediately.
// Matches the game plugin's SNAPSHOT_INTERVAL_MS so a second change lands right after that poll.
const SYNC_DEBOUNCE_MS = 150;

// player.setav markers for S.P.E.C.I.A.L. - refreshed softly on the SPECIAL tab.
const SPECIAL_SETAV_MARKERS = [
  "player.setav('strength'",
  "player.setav('perception'",
  "player.setav('endurance'",
  "player.setav('charisma'",
  "player.setav('intelligence'",
  "player.setav('agility'",
  "player.setav('luck'",
];

const SPECIAL_SOFT_REFRESH_CMD = 'player.refreshspecial();';

const SKILLS_SOFT_REFRESH_CMD =
  `if(typeof Pip!=='undefined'&&Pip.CURRENT&&Pip.CURRENT.id==='SKILLS'&&Pip.emit)Pip.emit('skills');`;

// HP lives in the shared Pip-Boy header; redraw it without rebuilding pages.
const HP_HEADER_SOFT_REFRESH_CMD = 'player.renderheader();';

// AP recharges/drains continuously in real time, which without chunking means
// a device write on almost every snapshot. Only push once AP has moved this
// many points from the last value actually sent - see _diffAP.
const AP_SYNC_CHUNK = 5;

// Caps/Wg/HP in the ITEMS chrome - header only, no tab rebuild.
const ITEMS_HEADER_SOFT_REFRESH_CMD = 'player.renderheader(!0);';

/** Full menu rebuild for STATS sub-tabs except GENERAL/SPECIAL/SKILLS (soft refresh). */
const STATS_TAB_FULL_REFRESH_CMD =
  `if(typeof Pip!=='undefined'&&Pip.CURRENT&&Pip.MODE===0&&Pip.changeMenu&&` +
  `Pip.CURRENT.id!=='GENERAL'&&Pip.CURRENT.id!=='SPECIAL'&&Pip.CURRENT.id!=='SKILLS')Pip.changeMenu();`;

/** Used after full sync - inventory tabs still get changeMenu; STATS uses soft where possible. */
const FULL_SYNC_UI_REFRESH_CMD = 'player.fullsyncrefresh();';

const INVENTORY_CATEGORIES = ['AID', 'AMMO', 'APPAREL', 'MISC', 'WEAPONS'];

// Perks and Skills are InvFile-backed on the device now (INV/{m}/PERKS.INV,
// SKILLS.INV - same shape as the item categories), so pre-sync backup/restore
// treats them as two more INV categories instead of separate JSON files.
const PRESYNC_CATEGORIES = [...INVENTORY_CATEGORIES, 'PERKS', 'SKILLS'];

// Weapon DAM (skill/condition-adjusted display damage) lives in a side
// *_DAM.INV file, mirrored via batched player.setdams()/setdamsbulk_* calls so
// the device opens and flash-writes the file once per batch instead of once
// per entry.
// Entries per setdams command. Each `[id,cnd,dam],` triple is ~16 chars and the
// serial bridge packs lines into 512-byte chunks - 24 keeps a full command
// safely inside one chunk so it never floods the device's USB RX buffer.
const MAX_DAM_BATCH = 24;
// Same rationale as MAX_DAM_BATCH, for player.additemsbulk()/removeitemsbulk()
// batches: N items changing in the same category cost the device one flash
// write per batch instead of one per item.
const MAX_ITEM_BATCH = 24;
const REFRESH_WEAPON_DAM_CMD = 'player.refreshweapondam()';
/** Refresh open WEAPONS/APPAREL scroller after remote equip; safe if .boot0 not loaded */
const REFRESH_EQUIP_CMD = 'player.refreshequip()';

export class SyncEngine extends EventEmitter {
  constructor(serialBridge, formIdMapper) {
    super();
    this.bridge = serialBridge;
    this.mapper = formIdMapper;
    this.previousState = null;
    this.lastSyncFlush = 0;
    this.gameMode = null; // 'F3' or 'FNV'
    this.enabled = false;
    this.bypassMismatchCheck = false;
    this._lastMismatchWarning = null;
    // When on, game ↔ Pip-Boy torch LED stay in sync. Defaults to on; toggle in app.
    this.torchSyncEnabled = true;
    this._processingSnapshot = false;
    this._pendingSnapshot = null;
    this._debounceTimer = null;
    this._debouncedSnapshot = null;
    this._inventorySyncPaused = false;
    this._needsWeaponAmmoRefresh = false;
    // Device-initiated consumptions (e.g. stimpak used on the Pip-Boy) that
    // we expect to see echoed back in an upcoming game snapshot.
    // gameFormId (lowercase) -> { count, time }
    this._deviceConsumed = new Map();
    // Device-initiated equip/unequip - suppress bag-count echoes (equip moves 1
    // to worn without reducing total owned; unequip returns 1 to bag).
    // gameFormId (lowercase) -> { action: 'equip'|'unequip', count, time }
    this._deviceEquipPending = new Map();
    // Device-initiated torch toggles - don't let a stale game snapshot turn the LED off.
    this._deviceTorchPending = null;
    this._resyncEquipAfterInventory = false;
    // Last AP value actually pushed to the device - see _diffAP. Reset
    // alongside previousState so a full resync always pushes the current AP.
    this._lastSentAp = undefined;
    // Bumped on save load / forced resync. A snapshot that began processing
    // under an older generation must not write its (now stale) state back into
    // previousState, or it would downgrade the next post-load full sync to an
    // incremental diff and leave inventory out of sync.
    this._stateGeneration = 0;
    this.stats = {
      snapshotsProcessed: 0,
      commandsSent: 0,
      errors: 0,
    };
  }

  /**
   * Set the active game mode (determines which form IDs are valid)
   * @param {'F3'|'FNV'} mode
   */
  setGameMode(mode) {
    if (mode !== 'F3' && mode !== 'FNV') {
      throw new Error(`Invalid game mode: ${mode}. Must be 'F3' or 'FNV'.`);
    }
    this.gameMode = mode;
    this.previousState = null; // Force full sync on game mode change
    this._lastSentAp = undefined;
    this._lastMismatchWarning = null;
    this.emit('game-mode-changed', mode);
  }

  /** Clear cached mode so the next connect re-reads NV from the device. */
  clearGameMode() {
    if (!this.gameMode) return;
    this.gameMode = null;
    this.previousState = null;
    this._lastSentAp = undefined;
    this._lastMismatchWarning = null;
    this.emit('game-mode-changed', null);
  }

  /**
   * Enable or disable syncing
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.emit('status', 'Sync paused');
    } else {
      this.emit('status', 'Sync active');
    }
  }

  /**
   * Enable or disable bidirectional flashlight sync (game ↔ Pip-Boy torch LED).
   * @param {boolean} enabled
   */
  setTorchSyncEnabled(enabled) {
    this.torchSyncEnabled = !!enabled;
    if (!this.torchSyncEnabled) {
      this._deviceTorchPending = null;
    }
    this.emit(
      'status',
      this.torchSyncEnabled ? 'Flashlight sync enabled' : 'Flashlight sync disabled'
    );
  }

  /**
   * Device user toggled the torch. Returns true if the game should receive TORCH ON/OFF.
   * @param {boolean} on
   * @returns {boolean}
   */
  handleDeviceTorch(on) {
    if (!this.torchSyncEnabled) return false;
    this.notifyDeviceTorch(on);
    return true;
  }

  /**
   * Process a new game state snapshot, debouncing rapid changes
   * @param {object} snapshot - The full player/inventory state from the game
   */
  async processSnapshot(snapshot) {
    if (!this.enabled || !this.bridge.connected) return;

    if (!this.bypassMismatchCheck && this.gameMode && snapshot.game && this.gameMode !== snapshot.game) {
      if (!this._lastMismatchWarning || this._lastMismatchWarning !== snapshot.game) {
        this._lastMismatchWarning = snapshot.game;
        const pipBoyLabel = this.gameMode === 'FNV' ? 'Fallout: New Vegas' : 'Fallout 3';
        const gameLabel = snapshot.game === 'FNV' ? 'Fallout: New Vegas' : 'Fallout 3';
        this.emit('warning', `Game/Pip-Boy mode mismatch: Pip-Boy is in ${pipBoyLabel} mode, but game is ${gameLabel}. Sync disabled.`);
      }
      this.setEnabled(false);
      try {
        await this.bridge.sendCommand('cmode = !1');
      } catch (_) {}
      return;
    }

    if (snapshot.game && this.gameMode === snapshot.game) {
      this._lastMismatchWarning = null;
    }

    if (this._hasEquipChange(snapshot)) {
      if (this._debounceTimer) {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = null;
      }
      this._debouncedSnapshot = null;
      await this._processSnapshotInternal(snapshot);
      return;
    }

    if (!this._debounceTimer) {
      // First instance: update Pip-Boy immediately (leading edge)
      this._debounceTimer = setTimeout(() => this._flushDebounced(), SYNC_DEBOUNCE_MS);
      await this._processSnapshotInternal(snapshot);
    } else {
      // Occurred again within the debounce window: hold the latest snapshot
      this._debouncedSnapshot = snapshot;
    }
  }

  async _flushDebounced() {
    this._debounceTimer = null;
    if (this._debouncedSnapshot) {
      const snap = this._debouncedSnapshot;
      this._debouncedSnapshot = null;
      // Chain another debounce window if more snapshots arrived during processing
      this._debounceTimer = setTimeout(() => this._flushDebounced(), SYNC_DEBOUNCE_MS);
      await this._processSnapshotInternal(snap);
    }
  }

  /**
   * Internal processor for a snapshot
   */
  async _processSnapshotInternal(snapshot) {
    if (!this.enabled || !this.bridge.connected) return;
    if (this._processingSnapshot) {
      // The game only sends snapshots when something changed, so we can't just
      // drop this one - park it (keeping only the newest) and process it as
      // soon as the current batch finishes.
      this._pendingSnapshot = snapshot;
      return;
    }

    this._processingSnapshot = true;
    this.stats.snapshotsProcessed++;

    // Capture the generation this snapshot is processed under. If a save load
    // (or forced resync) bumps the generation mid-flight, we must not let this
    // snapshot's stale state overwrite the freshly-reset previousState.
    const processingGeneration = this._stateGeneration;

    // Remap form IDs when runtime load order differs from Pip-Boy fixed offsets.
    if (snapshot.loadOrder && this.mapper?.setLoadOrder) {
      const loadOrderChanged = this.mapper.setLoadOrder(snapshot.loadOrder);
      if (loadOrderChanged && this.previousState) {
        this.previousState = null;
        this._lastSentAp = undefined;
        this.emit('status', 'Load order updated - forcing full resync');
      }
    }

    // Use snapshot game id when mode not set yet (e.g. before Pip-Boy detection).
    if (!this.gameMode && snapshot.game) {
      this.setGameMode(snapshot.game);
    }

    const isFullSync = !this.previousState;
    try {
      if (isFullSync) {
        // Lock the game (disable controls + "please wait" message) for the
        // heavy initial sync. Incremental syncs are tiny and don't lock.
        this.emit('initial-sync-start');
        await this._backupPresyncData();
      }

      const commands = this._generateCommands(snapshot);

      if (isFullSync && this.gameMode === 'FNV' && !this._getFactions(snapshot).length) {
        this.emit(
          'warning',
          'Game plugin did not send faction data - rebuild FalloutPipBoySync.dll (v6+) and restart the game'
        );
      }

      if (commands.length > 0) {
        const factionCmd = commands.find((c) => c.startsWith('player.syncfactions('));
        if (factionCmd) {
          const discovered = this._normalizeFactions(this._getFactions(snapshot)).filter(
            (f) => f.discovered
          );
          this.emit(
            'status',
            `Faction sync: ${discovered.length} discovered (${discovered.map((f) => f.name).join(', ') || 'none'})`
          );
        }

        // Automatically refresh Pip-Boy inventory UI if needed
        const hasInvChanges = commands.some((c) => this._isInventoryRefreshCommand(c));

        // Refresh open inventory tab UI; disk writes happen in add/remove commands
        // only when that category is not the active menu (page exit syncs otherwise).
        if (hasInvChanges) {
          const catsArray = Array.from(this._lastChangedCategories || [])
            .filter((c) => INVENTORY_CATEGORIES.includes(c))
            .map((c) => "'" + c + "'")
            .join(',');
          if (catsArray.length > 0) {
            commands.push(`player.sortandrefreshinv([${catsArray}])`);
          }
          // Caps and carry weight live in the ITEMS header - only refresh on inventory tabs.
          commands.push(ITEMS_HEADER_SOFT_REFRESH_CMD);
        }

        /* SYNC-DISABLED: batch inv.sync + sort stack guard
        if (hasInvChanges) {
          commands.unshift('var _isrt = InvFile.prototype.sort; InvFile.prototype.sort = function(){};');
          const catsArray = Array.from(this._lastChangedCategories || []).map(c => "'" + c + "'").join(',');
          if (catsArray.length > 0) {
            commands.push('InvFile.prototype.sort = _isrt;');
            commands.push(`[${catsArray}].forEach(...i._requiresSync=true;i._requiresSort=true;i.sync();...)`);
          } else {
            commands.shift();
          }
        }
        */

        this.emit('syncing', { commandCount: commands.length });

        const guardActive =
          typeof this.bridge.isAudioGuardActive === 'function' &&
          this.bridge.isAudioGuardActive();

        if (guardActive) {
          // A device sound is playing: keep the per-command path so equip
          // confirmations bypass the guard while regular commands wait it out.
          for (const cmd of commands) {
            if (this._isEquipCommand(cmd)) {
              await this.bridge.sendEquipCommand(cmd);
            } else {
              await this.bridge.sendCommand(cmd);
            }
            this.stats.commandsSent++;
          }
        } else {
          // Common case (game-driven sync, no sound playing): send the whole
          // ordered list as a batch. The device receives the exact same framed
          // lines, just without the 25ms inter-command spacing - collapsing a
          // typical 6–10 command sync from ~150–250ms of pure spacing to one or
          // two writes. Equip vs regular distinction is irrelevant here since the
          // guard is closed and everything may flow immediately.
          await this.bridge.sendBatch(commands);
          this.stats.commandsSent += commands.length;
        }

        // SYNC-DISABLED: player.sync() - inventory menus flush .INV on page exit
        // const now = Date.now();
        // if (now - this.lastSyncFlush >= SYNC_FLUSH_INTERVAL_MS) {
        //   await this.bridge.sendCommand('player.sync()');
        //   this.lastSyncFlush = now;
        //   this.emit('flushed');
        // }

        this.emit('synced', { commandCount: commands.length, fullSync: isFullSync });
      } else if (isFullSync) {
        this.emit('synced', { commandCount: 0, fullSync: true });
      }

      if (isFullSync) {
        this.emit('initial-sync-complete');
      }

      // Only cache this snapshot as previousState if no save load / forced
      // resync happened while we were processing it. Otherwise a stale pre-load
      // snapshot would clobber the null reset and turn the next post-load
      // snapshot into an incremental diff (inventory ends up out of sync).
      if (processingGeneration === this._stateGeneration) {
        this.previousState = this._cloneSnapshot(snapshot);
      }
    } catch (err) {
      this.stats.errors++;
      this.emit('error', err);
    } finally {
      // Always release the game lock for a full sync, even if it errored, so
      // the player is never left with disabled controls.
      if (isFullSync) {
        this.emit('initial-sync-end');
      }
      this._processingSnapshot = false;
    }

    // Process any snapshot that arrived while we were busy
    if (this._pendingSnapshot) {
      const pending = this._pendingSnapshot;
      this._pendingSnapshot = null;
      await this._processSnapshotInternal(pending);
    }
  }

  /**
   * Generate the list of Pip-Boy commands needed to sync from previous to current state
   */
  _generateCommands(snapshot) {
    const commands = [];
    const prev = this.previousState;

    if (!prev) {
      // First snapshot - do a full sync
      return this._generateFullSync(snapshot);
    }

    // --- Player attribute diffs ---
    const player = snapshot.player || {};
    const prevPlayer = prev.player || {};

    if (!this._inventorySyncPaused) {
      // Simple scalar attributes
      // 'hp' is the game's true health pool (kAV_Health) - the Pip-Boy firmware
      // uses it directly instead of averaging limb conditions when present.
      // maxHP is NOT synced: the Pip-Boy derives it correctly from endurance/level.
      const scalarAttrs = ['name', 'level', 'hp', 'karma', 'perceptioncondition', 'endurancecondition', 'leftattackcondition', 'rightattackcondition', 'leftmobilitycondition', 'rightmobilitycondition'];
      for (const attr of scalarAttrs) {
        let current = player[attr];
        let previous = prevPlayer[attr];

        // FNV regenerates health in fractional ticks; only whole-HP changes
        // are worth a serial round-trip to the device. Ceil matches the game
        // HUD, which always rounds displayed health up.
        if (attr === 'hp') {
          current = current !== undefined ? Math.ceil(current) : undefined;
          previous = previous !== undefined ? Math.ceil(previous) : undefined;
        }

        if (current !== undefined && current !== previous) {
          if (attr === 'level') {
            commands.push(`player.setlevel(${player.level})`);
            // Also push XP on level-up so the display reflects the new total.
            // setav() only marks the player object modified - sync() is what
            // actually flushes it to PLAYER.JSON, so without it XP sits
            // unpersisted until some unrelated action (equip, settings edit)
            // happens to call sync() next.
            if (player.xp !== undefined) {
              commands.push(`player.setav('xp',${player.xp},!0)`);
              commands.push('player.sync()');
            }
          } else if (attr === 'name') {
            commands.push(`player.setav('name', ${JSON.stringify(player.name)}, !0)`);
          } else {
            commands.push(`player.setav('${attr}', ${JSON.stringify(current)}, ${attr === 'hp' ? '!1' : '!0'})`);
          }
          if (attr === 'hp' || attr === 'level') {
            commands.push(ITEMS_HEADER_SOFT_REFRESH_CMD);
          }
        }
      }

      // S.P.E.C.I.A.L. stats
      const specialMap = { ST: 'strength', PE: 'perception', EN: 'endurance', CH: 'charisma', IN: 'intelligence', AG: 'agility', LK: 'luck' };
      if (player.special) {
        const prevSpecial = prevPlayer.special || {};
        for (const [stat, value] of Object.entries(player.special)) {
          if (value !== prevSpecial[stat]) {
            const mappedStat = specialMap[stat] || stat;
            commands.push(`player.setav('${mappedStat}', ${value}, !1)`);
          }
        }
      }

    }

    // Carry weight + AP - game-authoritative; always sync (not gated on inventory pause)
    commands.push(...this._diffWeight(player, prevPlayer));
    commands.push(...this._diffAP(player, prevPlayer));

    // --- Inventory diffs ---
    const invCommands = this._diffInventory(
      snapshot.inventory || [],
      prev.inventory || []
    );

    // --- Equip diffs ---
    // Run inventory diff first so _resyncEquipAfterInventory is set, then
    // decide ordering: equip command goes BEFORE inventory changes (fast split
    // on device) unless this is an authoritative re-sync after removals (it
    // must come after so the device sees the correct post-removal state).
    if (!this._inventorySyncPaused) {
      if (this._resyncEquipAfterInventory) {
        // Inventory removed items - push inventory first, then re-authorise equip
        this._resyncEquipAfterInventory = false;
        commands.push(...invCommands);
        commands.push(...this._buildAuthoritativeEquipCommands(player, prevPlayer));
      } else {
        // Normal case: equip command first so split appears as fast as possible,
        // then inventory count updates follow.
        commands.push(...this._diffEquipped(player, prevPlayer));
        commands.push(...invCommands);
      }
    } else {
      commands.push(...invCommands);
    }

    // Weapon DAM (skill/condition-adjusted) - mirror per-stack deltas. Self-gated
    // on inventory pause; placed after inventory so the rows it annotates exist.
    commands.push(...this._diffWeaponDamage(snapshot.inventory || [], prev.inventory || []));

    // Weapon ammo - ephemeral UI state; always sync (not gated on inventory pause)
    commands.push(...this._diffWeaponAmmo(player, prevPlayer));

    if (!this._inventorySyncPaused) {

      // --- Perk diffs ---
      const perkCommands = this._diffPerks(
        snapshot.perks || [],
        prev.perks || []
      );
      commands.push(...perkCommands);

      // --- Skill diffs (written to INV/*/SKILLS.INV on device) ---
      commands.push(...this._diffSkills(player, prevPlayer));
    }

    // Faction reputation - always sync (not gated on inventory pause)
    commands.push(...this._diffFactions(this._getFactions(snapshot), this._getFactions(prev)));

    // Pip-Boy flashlight LED - game -> device only (independent of inventory pause)
    if (
      this.torchSyncEnabled &&
      player.torch !== undefined &&
      player.torch !== prevPlayer.torch &&
      !this._shouldSuppressGameToDeviceTorch(player.torch)
    ) {
      commands.push(
        `player.settorch(${player.torch ? '!0' : '!1'})`
      );
    }

    // Force STATS tab refresh only when stats changed (not equip/inventory).
    // SPECIAL/SKILLS use Pip.emit soft refresh when already on that screen.
    const hasSpecialChange = commands.some((c) =>
      SPECIAL_SETAV_MARKERS.some((m) => c.includes(m))
    );
    const hasHpChange = commands.some((c) => c.includes("player.setav('hp'"));
    const hasOtherStatsChange = commands.some(
      (c) =>
        (c.includes('player.setlevel') ||
          c.includes("player.setav('name'") ||
          c.includes('perceptioncondition') ||
          c.includes('endurancecondition') ||
          c.includes('attackcondition') ||
          c.includes('mobilitycondition') ||
          c.includes("player.setav('karma'")) &&
        !SPECIAL_SETAV_MARKERS.some((m) => c.includes(m))
    );
    if (hasSpecialChange) {
      commands.push(SPECIAL_SOFT_REFRESH_CMD);
    }
    if (hasHpChange) {
      commands.push(HP_HEADER_SOFT_REFRESH_CMD);
    }
    if (hasOtherStatsChange) {
      if (this.gameMode === 'FNV') {
        commands.push(STATS_TAB_FULL_REFRESH_CMD);
      } else {
        commands.push(
          `if(typeof Pip!=='undefined'&&Pip.CURRENT&&Pip.MODE===0&&Pip.changeMenu&&` +
            `Pip.CURRENT.id!=='SPECIAL'&&Pip.CURRENT.id!=='SKILLS')Pip.changeMenu();`
        );
      }
    }

    return commands;
  }

  /**
   * Generate commands for a full sync (first snapshot or after reset)
   */
  _generateFullSync(snapshot) {
    const commands = [];
    const player = snapshot.player || {};

    if (!this._inventorySyncPaused) {
      // Set player name
      if (player.name) {
        commands.push(`player.setav('name', ${JSON.stringify(player.name)}, !0)`);
      }

      // Set level
      if (player.level) {
        commands.push(`player.setlevel(${player.level})`);
      }

      // XP - pushed on first sync and save-loads (full syncs only). sync()
      // flushes it to PLAYER.JSON immediately rather than leaving it
      // unpersisted until an unrelated action happens to call sync() later.
      if (player.xp !== undefined) {
        commands.push(`player.setav('xp',${player.xp},!0)`);
        commands.push('player.sync()');
      }

      // Set all scalar attributes (hp = true health pool from the game;
      // maxHP is omitted - the Pip-Boy calculates it itself)
      const attrs = ['hp', 'karma', 'perceptioncondition', 'endurancecondition', 'leftattackcondition', 'rightattackcondition', 'leftmobilitycondition', 'rightmobilitycondition'];
      for (const attr of attrs) {
        if (player[attr] !== undefined) {
          const value = attr === 'hp' ? Math.ceil(player[attr]) : player[attr];
          commands.push(`player.setav('${attr}', ${JSON.stringify(value)}, ${attr === 'hp' ? '!1' : '!0'})`);
        }
      }

      // S.P.E.C.I.A.L.
      const specialMapFull = { ST: 'strength', PE: 'perception', EN: 'endurance', CH: 'charisma', IN: 'intelligence', AG: 'agility', LK: 'luck' };
      if (player.special) {
        for (const [stat, value] of Object.entries(player.special)) {
          const mappedStat = specialMapFull[stat] || stat;
          commands.push(`player.setav('${mappedStat}', ${value}, !1)`);
        }
      }

      // Carry weight - game-authoritative (see _diffWeight)
      commands.push(...this._diffWeight(player, {}));

      // Skills - stored in INV/*/SKILLS.INV (not player.setav)
      if (player.skills) {
        const skillCmd = this._buildSyncSkillsCommand(player.skills);
        if (skillCmd) commands.push(skillCmd);
      }

      // Reconcile every category to exactly this snapshot's contents (device
      // diffs in place - see setitemsbulk_begin/chunk/end), rather than
      // clearing every category's file and readding, so a full sync only
      // flash-writes categories whose contents actually changed. Every
      // category runs even if empty in this snapshot - that's what removes
      // stale rows from a category the player emptied out.
      const inventory = snapshot.inventory || [];
      const addBatches = new Map(); // cat -> [formId,count,cnd][]
      for (const item of inventory) {
        const formId = this._resolveFormId(item.formId);
        if (formId === null) continue;
        const cat = this._toPipBoyCategory(item.type);
        if (!cat) continue;
        const list = addBatches.get(cat) || addBatches.set(cat, []).get(cat);
        list.push(this._toItemEntry(formId, item.count || 1, item.condition));
      }
      for (const cat of INVENTORY_CATEGORIES) {
        commands.push(...this._buildSetItemsBulkCommands(cat, addBatches.get(cat) || []));
      }

      // Reconcile weapon DAM (skill/condition-adjusted display damage) the
      // same way, instead of clearing *_DAM.INV and rewriting it whole.
      const damEntries = [];
      for (const item of inventory) {
        if (item.dam == null) continue;
        const formId = this._resolveFormId(item.formId);
        if (formId === null) continue;
        damEntries.push(this._toDamEntry(formId, item.condition, item.dam));
      }
      commands.push(...this._buildSetDamsBulkCommands(damEntries));
      // SYNC-DISABLED: calculateInvWeight() writes every .INV file
      // commands.push('player.calculateInvWeight()');

      // Equipped items - after inventory is populated
      commands.push(...this._diffEquipped(player, {}, true));
    }

    // Action Points - always sync on full sync
    commands.push(...this._diffAP(player, {}));

    // Weapon ammo - ephemeral UI state for AMMO tab dimming/selection
    commands.push(...this._diffWeaponAmmo(player, {}, true));

    if (!this._inventorySyncPaused) {
      // Reconcile PERKS.INV to exactly this set in one pass (setperksbulk),
      // instead of clearing it to empty and rebuilding it from scratch. A
      // clear+rebuild rewrites the file at a different size on every full
      // sync even when the perk list hasn't changed at all - three separate
      // device crashes were traced to a PERKS.INV write during exactly this
      // clear-then-regrow sequence, so this now only touches rows that
      // actually changed (and skips the flash write entirely if nothing did).
      const perks = snapshot.perks || [];
      const perkFormIds = [];
      for (const perk of perks) {
        const formIdStr = typeof perk === 'string' ? perk : perk.formId;
        const formId = this._toFormIdInt(formIdStr);
        if (formId === null) continue;
        perkFormIds.push(formId);
      }
      commands.push(this._buildSetPerksBulkCommand(perkFormIds));
    }

    // Faction reputation - always sync (not gated on inventory pause)
    const factions = this._getFactions(snapshot);
    if (factions.length) {
      const factionCmd = this._buildSyncFactionsCommand(factions);
      if (factionCmd) commands.push(factionCmd);
    }

    // Force UI refresh if currently on any STATS tab or INVENTORY tab
    commands.push(FULL_SYNC_UI_REFRESH_CMD);

    // Match in-game flashlight to the physical torch LED
    if (this.torchSyncEnabled && player.torch !== undefined) {
      commands.push(
        `player.settorch(${player.torch ? '!0' : '!1'})`
      );
    }

    return commands;
  }

  /**
   * Record that an item was consumed on the Pip-Boy itself. The device has
   * already decremented its local count, so when the game snapshot echoes the
   * same decrement back, we must NOT send a removal command (it would
   * double-decrement the device). Also used for device-initiated drops
   * (count > 1 for a whole-stack drop).
   * @param {string|number} gameFormId
   * @param {number} [count]
   */
  notifyDeviceConsumed(gameFormId, count = 1) {
    const key = String(gameFormId).toLowerCase();
    const entry = this._deviceConsumed.get(key) || { count: 0, time: 0 };
    entry.count += count;
    entry.time = Date.now();
    this._deviceConsumed.set(key, entry);
  }

  /**
   * User equipped an item on the Pip-Boy. The game moves one unit to the worn
   * slot but total owned is unchanged - do not mirror a bag-count drop on device.
   */
  notifyDeviceEquipped(gameFormId) {
    const key = String(gameFormId).toLowerCase();
    const entry = this._deviceEquipPending.get(key) || { action: 'equip', count: 0, time: 0 };
    entry.action = 'equip';
    entry.count++;
    entry.time = Date.now();
    this._deviceEquipPending.set(key, entry);
  }

  /**
   * User unequipped on the Pip-Boy. The game returns one unit to the bag but
   * total owned is unchanged - do not mirror a bag-count rise on device.
   */
  notifyDeviceUnequipped(gameFormId) {
    const key = String(gameFormId).toLowerCase();
    const entry = this._deviceEquipPending.get(key) || { action: 'unequip', count: 0, time: 0 };
    entry.action = 'unequip';
    entry.count++;
    entry.time = Date.now();
    this._deviceEquipPending.set(key, entry);
  }

  /**
   * User toggled the torch on the physical Pip-Boy. Ignore game->device torch
   * sync that disagrees until the game catches up or the window expires.
   */
  notifyDeviceTorch(on) {
    this._deviceTorchPending = { on: !!on, confirmed: false, time: Date.now() };
  }

  _shouldSuppressGameToDeviceTorch(gameTorch) {
    const pending = this._deviceTorchPending;
    if (!pending) return false;
    if (Date.now() - pending.time > 15000) {
      this._deviceTorchPending = null;
      return false;
    }
    if (gameTorch === pending.on) {
      pending.confirmed = true;
      return true;
    }
    if (pending.confirmed) {
      this._deviceTorchPending = null;
      return false;
    }
    return true;
  }

  /**
   * Pip-Boy restored pre-sync data (only possible when cmode is off - companion
   * app disconnected). Pause game sync until resync; firmware already cleared PRESYNC.
   */
  async notifyPresyncRestored() {
    this._inventorySyncPaused = true;
    this.requestWeaponAmmoRefresh();
    this.emit('status', 'Pre-sync data restored on Pip-Boy (run resync after reconnecting to resume sync)');
  }

  /** Re-push ammoActive/ammoUsable on next snapshot (e.g. after Pip-Boy reconnect). */
  requestWeaponAmmoRefresh() {
    this._needsWeaponAmmoRefresh = true;
  }

  isInventorySyncPaused() {
    return this._inventorySyncPaused;
  }

  /**
   * Take up to `max` pending device-consumed units for a form ID.
   * Entries expire after 10s (e.g. the game rejected the action).
   * @returns {number} How many units of the decrement to suppress
   */
  _takeDeviceConsumed(gameFormId, max) {
    const key = String(gameFormId).toLowerCase();
    const entry = this._deviceConsumed.get(key);
    if (!entry) return 0;

    if (Date.now() - entry.time > 10000) {
      this._deviceConsumed.delete(key);
      return 0;
    }

    const taken = Math.min(entry.count, max);
    entry.count -= taken;
    if (entry.count <= 0) this._deviceConsumed.delete(key);
    return taken;
  }

  /**
   * Suppress inventory count echoes from a device-initiated equip/unequip.
   * @param {'down'|'up'} direction down = bag lost a unit (equip), up = bag gained (unequip)
   * @returns {number} Units to suppress
   */
  _takeDeviceEquipPending(gameFormId, max, direction) {
    const key = String(gameFormId).toLowerCase();
    const entry = this._deviceEquipPending.get(key);
    if (!entry) return 0;

    if (Date.now() - entry.time > 10000) {
      this._deviceEquipPending.delete(key);
      return 0;
    }

    const wantAction = direction === 'down' ? 'equip' : 'unequip';
    if (entry.action !== wantAction) return 0;

    const taken = Math.min(entry.count, max);
    entry.count -= taken;
    if (entry.count <= 0) this._deviceEquipPending.delete(key);
    return taken;
  }

  /**
   * Map game record type to Pip-Boy inventory category folder name.
   * Returns null for item types the Pip-Boy has no .DAT file for (books, keys, etc.).
   */
  _toPipBoyCategory(gameType) {
    if (gameType === 'WEAP') return 'WEAPONS';
    if (gameType === 'ARMO') return 'APPAREL';
    if (INVENTORY_CATEGORIES.includes(gameType)) return gameType;
    return null;
  }

  /**
   * Diff two inventory arrays and generate add/remove commands
   */
  /**
   * Composite stack identity: form ID + condition percent. Two entries of the
   * same form but different displayed condition are distinct stacks (so they no
   * longer merge into one stack at the highest condition).
   */
  _inventoryStackKey(item) {
    return `${item.formId}|${this._normalizeItemCondition(item.condition)}`;
  }

  _diffInventory(current, previous) {
    const commands = [];
    this._lastChangedCategories = new Set();

    if (this._inventorySyncPaused) {
      return commands;
    }

    // Build maps keyed by (formId, condition) for fast lookup
    const currentMap = new Map();
    for (const item of current) {
      currentMap.set(this._inventoryStackKey(item), item);
    }

    const previousMap = new Map();
    for (const item of previous) {
      previousMap.set(this._inventoryStackKey(item), item);
    }

    // Check for too many changes - might indicate a save load or major event
    const addedIds = [...currentMap.keys()].filter(id => !previousMap.has(id));
    const removedIds = [...previousMap.keys()].filter(id => !currentMap.has(id));

    // Adds/removes are grouped per category and flushed as additemsbulk/
    // removeitemsbulk commands at the end, so N items changing in the same
    // category cost the device one flash write instead of N (flash writes are
    // by far the slowest device operation - this is what made full syncs and
    // multi-item pickups visibly lag behind the commands being sent).
    const addBatches = new Map(); // cat -> [formId,count,cnd][]
    const removeBatches = new Map(); // cat -> [formId,qty,cnd|undefined][]
    const queueAdd = (cat, formId, count, condition) => {
      // No Pip-Boy category (e.g. books/keys) - the device has no file to add
      // this to under any category, so there is nothing useful to send.
      if (!cat) return;
      const list = addBatches.get(cat) || addBatches.set(cat, []).get(cat);
      list.push(this._toItemEntry(formId, count, condition));
    };
    const queueRemove = (cat, formId, qty, condition) => {
      if (!cat) return;
      const list = removeBatches.get(cat) || removeBatches.set(cat, []).get(cat);
      list.push([
        formId,
        qty,
        condition === undefined || condition === null
          ? undefined
          : this._normalizeItemCondition(condition),
      ]);
    };
    const flushBatches = () => {
      for (const [cat, entries] of addBatches) {
        commands.push(...this._buildAddItemsBulkCommands(cat, entries));
      }
      for (const [cat, entries] of removeBatches) {
        commands.push(...this._buildRemoveItemsBulkCommands(cat, entries));
      }
    };

    if (addedIds.length + removedIds.length > MAX_INVENTORY_DELTA) {
      // Too many changes - reconcile every category to the current snapshot
      // (device diffs in place) rather than clearing and readding everything.
      this.emit('status', 'Large inventory change detected, performing full reset');
      this._lastChangedCategories = new Set(['AID','AMMO','APPAREL','MISC','WEAPONS']);
      // SYNC-DISABLED: calculateInvWeight() writes every .INV file
    // commands.push('player.calculateInvWeight()');
      for (const item of current) {
        const formId = this._resolveFormId(item.formId);
        if (formId === null) continue;
        const cat = this._toPipBoyCategory(item.type);
        queueAdd(cat, formId, item.count || 1, item.condition);
      }
      for (const cat of INVENTORY_CATEGORIES) {
        commands.push(...this._buildSetItemsBulkCommands(cat, addBatches.get(cat) || []));
      }
      return commands;
    }

    // Forms whose per-condition stack distribution changed while the form still
    // exists before AND after (e.g. a weapon/armor degraded or was repaired).
    // Representing that as add(newCond)+remove(oldCond) is fragile: if the remove
    // half is lost or the device already moved past that condition, a stale row
    // is orphaned and shows as a duplicate. Instead authoritatively rebuild just
    // that form's rows from the current snapshot - atomic, and self-heals any
    // pre-existing orphan. Pure adds/removals stay on the incremental path so
    // device equip/use credits keep working.
    const rebuildForms = new Set();
    {
      const condsByForm = (map) => {
        const m = new Map();
        for (const it of map.values()) {
          const set = m.get(it.formId) || m.set(it.formId, new Set()).get(it.formId);
          set.add(this._normalizeItemCondition(it.condition));
        }
        return m;
      };
      const curConds = condsByForm(currentMap);
      const prevConds = condsByForm(previousMap);
      const sameSet = (a, b) =>
        a && b && a.size === b.size && [...a].every((v) => b.has(v));
      for (const [gameFormId, curSet] of curConds) {
        const prevSet = prevConds.get(gameFormId);
        if (!prevSet) continue; // pure add - handled incrementally
        if (sameSet(curSet, prevSet)) continue; // only counts changed, if anything
        if (this._resolveFormId(gameFormId) === null) continue;
        rebuildForms.add(gameFormId);
      }

      for (const gameFormId of rebuildForms) {
        const formId = this._resolveFormId(gameFormId);
        let type = null;
        const stacks = [];
        for (const it of currentMap.values()) {
          if (it.formId !== gameFormId) continue;
          if (type === null) type = it.type;
          stacks.push({
            cnt: it.count || 1,
            cnd: this._normalizeItemCondition(it.condition),
          });
        }
        // Intentionally do NOT add to _lastChangedCategories here.
        // setformstacks sorts the INV inline (dbIds is already cached, no extra
        // flash read) and syncs/persists the result, so a separate sortandrefreshinv
        // is unnecessary. The equip re-sync that always follows provides the
        // required UI refresh.
        commands.push(this._buildSetFormStacksCommand(formId, stacks));
        this._resyncEquipAfterInventory = true;
      }
    }

    // Items added (new formIds not in previous)
    for (const id of addedIds) {
      const item = currentMap.get(id);
      if (rebuildForms.has(item.formId)) continue;
      const formId = this._resolveFormId(item.formId);
      if (formId === null) continue;
      const cat = this._toPipBoyCategory(item.type);
      if (cat) this._lastChangedCategories.add(cat);

      queueAdd(cat, formId, item.count || 1, item.condition);
    }

    // Stacks where only the count changed (same form + same condition). A
    // condition change instead surfaces as a removed key + an added key, handled
    // by the add/remove loops, so the cnd is carried on remove to target the
    // correct stack on the device.
    for (const [key, currentItem] of currentMap) {
      if (rebuildForms.has(currentItem.formId)) continue;
      if (previousMap.has(key)) {
        const prevItem = previousMap.get(key);
        const gameFormId = currentItem.formId;
        const countDelta = (currentItem.count || 1) - (prevItem.count || 1);

        if (countDelta > 0) {
          const formId = this._resolveFormId(gameFormId);
          if (formId === null) continue;
          const addQty = countDelta - this._takeDeviceEquipPending(gameFormId, countDelta, 'up');
          if (addQty <= 0) continue;
          const cat = this._toPipBoyCategory(currentItem.type);
          // Don't add to _lastChangedCategories: additemhealthpercent already emits
          // 'count' on-menu and syncs off-menu, so sortandrefreshinv is redundant for
          // count-only increases on existing forms. For new forms the addedIds path
          // (above) is responsible for adding to _lastChangedCategories.
          queueAdd(cat, formId, addQty, currentItem.condition);
        } else if (countDelta < 0) {
          // Skip decrements the device already applied to itself (item used
          // on the Pip-Boy and mirrored into the game by us)
          const removeQty =
            Math.abs(countDelta) -
            this._takeDeviceConsumed(gameFormId, Math.abs(countDelta)) -
            this._takeDeviceEquipPending(gameFormId, Math.abs(countDelta), 'down');
          if (removeQty <= 0) continue;

          const formId = this._resolveFormId(gameFormId);
          if (formId === null) continue;
          const cat = this._toPipBoyCategory(currentItem.type);
          // Don't add to _lastChangedCategories: removeitem already emits 'count' on-menu
          // and syncs off-menu, making sortandrefreshinv redundant here (it would open
          // the DAT + INV files, find _requiresSort = false, and do nothing useful).
          queueRemove(cat, formId, removeQty, currentItem.condition);
          // Only weapons and apparel can affect equip state; ammo/aid/misc removals
          // never change what is equipped, so skip the expensive authoritative resync.
          if (cat === 'WEAPONS' || cat === 'APPAREL') this._resyncEquipAfterInventory = true;
        }
      }
    }

    // Stacks removed (form+condition present before but not now)
    for (const key of removedIds) {
      const prevItem = previousMap.get(key);
      if (rebuildForms.has(prevItem.formId)) continue;
      const gameFormId = prevItem.formId;
      // Skip units the device already removed from itself
      const prevCount = prevItem.count || 1;
      const removeQty = prevCount - this._takeDeviceConsumed(gameFormId, prevCount);
      if (removeQty <= 0) continue;

      this._deviceEquipPending.delete(String(gameFormId).toLowerCase());

      const formId = this._resolveFormId(gameFormId);
      if (formId !== null) {
        const cat = this._toPipBoyCategory(prevItem.type);
        // Don't add to _lastChangedCategories: removeitem's 'count' event handles
        // the on-menu display, and inv.sync() handles off-menu persistence.
        // sortandrefreshinv would open DAT+INV from flash for nothing (no sort needed
        // since only a row was removed, not reordered).
        queueRemove(cat, formId, removeQty, prevItem.condition);
        if (cat === 'WEAPONS' || cat === 'APPAREL') this._resyncEquipAfterInventory = true;
      }
    }

    flushBatches();
    return commands;
  }

  /**
   * Per-(formId, condition) weapon DAM sync. The plugin tags each weapon
   * inventory stack with `dam` (its game-calculated, skill+condition-adjusted
   * display damage); we mirror only the deltas into the device's *_DAM.INV so
   * a single degradation or skill change updates one entry rather than the
   * whole file. Removed stacks have their DAM entry dropped so the file does
   * not accumulate stale rows as weapons degrade into new condition stacks.
   * Gated on inventory pause, since DAM tracks the inventory it describes.
   */
  _diffWeaponDamage(current, previous) {
    const commands = [];
    if (this._inventorySyncPaused) return commands;

    const prevMap = new Map();
    for (const it of previous) {
      if (it && it.dam != null) prevMap.set(this._inventoryStackKey(it), it);
    }

    const setEntries = [];
    for (const it of current) {
      if (!it || it.dam == null) continue;
      const formId = this._resolveFormId(it.formId);
      if (formId === null) continue;
      const key = this._inventoryStackKey(it);
      const prev = prevMap.get(key);
      if (!prev || prev.dam !== it.dam) {
        setEntries.push(this._toDamEntry(formId, it.condition, it.dam));
      }
      prevMap.delete(key);
    }
    // Batched so a skill change (which re-computes DAM for every carried
    // weapon at once) costs one device file open + flash write per batch
    // instead of one per weapon stack.
    commands.push(...this._buildSetDamBatchCommands(setEntries));

    const removeEntries = [];
    for (const it of prevMap.values()) {
      const formId = this._resolveFormId(it.formId);
      if (formId === null) continue;
      removeEntries.push([formId, this._normalizeItemCondition(it.condition)]);
    }
    commands.push(...this._buildRemoveDamBatchCommands(removeEntries));

    if (commands.length) commands.push(REFRESH_WEAPON_DAM_CMD);
    return commands;
  }

  /**
   * Filter game skill levels for the active Pip-Boy mode (FO3 has no Survival).
   */
  _filterSkillsForMode(skills) {
    if (!skills || typeof skills !== 'object') return {};
    const out = {};
    const isF3 = this.gameMode === 'F3';
    for (const [key, value] of Object.entries(skills)) {
      if (isF3 && key === 'survival') continue;
      if (typeof value === 'number' && !Number.isNaN(value)) {
        out[key] = value;
      }
    }
    return out;
  }

  _skillsChanged(current, previous) {
    const cur = this._filterSkillsForMode(current);
    const prev = this._filterSkillsForMode(previous);
    const keys = new Set([...Object.keys(cur), ...Object.keys(prev)]);
    for (const key of keys) {
      if (cur[key] !== prev[key]) return true;
    }
    return false;
  }

  /**
   * Write skill levels to INV/{mode}/SKILLS.INV on the Pip-Boy.
   * Matches game actor-value keys (e.g. "energyweapons") to SKILLS.DAT display names.
   */
  _buildSyncSkillsCommand(skills) {
    const filtered = this._filterSkillsForMode(skills);
    if (Object.keys(filtered).length === 0) return null;

    const payload = JSON.stringify(filtered);
    return `player.syncskills(${payload})`;
  }

  _diffSkills(currentPlayer, previousPlayer) {
    const commands = [];
    if (!this._skillsChanged(currentPlayer?.skills, previousPlayer?.skills)) {
      return commands;
    }
    const cmd = this._buildSyncSkillsCommand(currentPlayer.skills);
    if (cmd) commands.push(cmd);
    return commands;
  }

  _isInventoryRefreshCommand(cmd) {
    if (
      cmd.includes('InvFile') ||
      cmd.includes('resetinventory') ||
      cmd.includes('additem') ||
      cmd.includes('removeitem') ||
      cmd.includes('setitemcondition') ||
      cmd.includes('setformstacks') ||
      cmd.includes('additemhealthpercent')
    ) {
      return true;
    }
    if (!cmd.includes('fs.writeFileSync')) return false;
    if (cmd.includes('SETTINGS/REP') || cmd.includes('_SKILLS')) return false;
    return true;
  }

  /** Plugin emits factions under player; accept top-level for tests. */
  _getFactions(snapshot) {
    if (!snapshot) return [];
    const nested = snapshot.player?.factions;
    if (Array.isArray(nested) && nested.length > 0) return nested;
    const top = snapshot.factions;
    if (Array.isArray(top)) return top;
    return [];
  }

  _normalizeFactions(factions) {
    if (!Array.isArray(factions)) return [];
    return factions
      .filter((f) => f && typeof f.name === 'string')
      .map((f) => {
        const fame = typeof f.fame === 'number' ? f.fame : 0;
        const infamy = typeof f.infamy === 'number' ? f.infamy : 0;
        const tier = typeof f.tier === 'number' ? f.tier : 5;
        return {
          name: f.name,
          tier,
          discovered:
            !!f.discovered || fame > 0 || infamy > 0 || tier !== 5,
        };
      });
  }

  _factionsChanged(current, previous) {
    const cur = this._normalizeFactions(current);
    const prev = this._normalizeFactions(previous);
    if (cur.length !== prev.length) return true;
    const prevByName = new Map(prev.map((f) => [f.name, f]));
    for (const f of cur) {
      const p = prevByName.get(f.name);
      if (!p || p.tier !== f.tier || p.discovered !== f.discovered) return true;
    }
    return false;
  }

  /**
   * Write faction reputation tiers and discovered list for the Pip-Boy GENERAL screen.
   * Only discovered factions are written to REP.JSON; REP_VISIBLE.JSON drives the scroller.
   */
  _buildSyncFactionsCommand(factions, previous = null) {
    if (this.gameMode !== 'FNV') return null;
    const normalized = this._normalizeFactions(factions);
    if (normalized.length === 0) return null;

    // Only send discovered factions - the firmware skips undiscovered ones
    // anyway. Sending the full list (13+ NV factions) can OOM the device.
    const discovered = normalized.filter((f) => f.discovered);

    const curVis = discovered.map((f) => f.name);
    let visListChanged = !previous;
    if (previous) {
      const prevVis = this._normalizeFactions(previous)
        .filter((f) => f.discovered)
        .map((f) => f.name);
      visListChanged =
        curVis.length !== prevVis.length ||
        curVis.some((n, i) => n !== prevVis[i]);
    }

    // If nothing is discovered yet, nothing to write - return null to skip the
    // command entirely (avoids writing empty REP.JSON which clears the UI).
    if (discovered.length === 0) return null;

    const payload = JSON.stringify(discovered);
    return `player.syncfactions(${payload},${visListChanged ? '!0' : '!1'})`;
  }

  _diffFactions(current, previous) {
    const commands = [];
    if (this.gameMode !== 'FNV') return commands;
    if (!Array.isArray(current) || current.length === 0) return commands;
    if (!this._factionsChanged(current, previous)) return commands;
    const cmd = this._buildSyncFactionsCommand(current, previous);
    if (cmd) commands.push(cmd);
    return commands;
  }

  /**
   * Diff two perk arrays and generate add/remove commands
   */
  _diffPerks(current, previous) {
    const commands = [];

    // Map array of objects (or strings) to array of string IDs
    const extractId = p => typeof p === 'string' ? p : p.formId;

    const currentSet = new Set(current.map(extractId));
    const previousSet = new Set(previous.map(extractId));

    // Added perks
    const addedFormIds = [];
    for (const perkId of currentSet) {
      if (!previousSet.has(perkId)) {
        const formId = this._toFormIdInt(perkId);
        if (formId === null) continue;
        addedFormIds.push(formId);
      }
    }
    commands.push(...this._buildAddPerksBulkCommands(addedFormIds));

    // Removed perks
    const removedFormIds = [];
    for (const perkId of previousSet) {
      if (!currentSet.has(perkId)) {
        const formId = this._toFormIdInt(perkId);
        if (formId === null) continue;
        removedFormIds.push(formId);
      }
    }
    commands.push(...this._buildRemovePerksBulkCommands(removedFormIds));

    return commands;
  }

  /**
   * Generate action-point commands from game -> Pip-Boy.
   * Stock firmware shows maxAP/maxAP in the STATS header; boot0 overrides when
   * cmode is on. Values are ephemeral (!1) and refreshed via renderHeader.
   *
   * curAp is chunked against the last value actually sent (this._lastSentAp),
   * not the raw delta since last snapshot - AP recharges/drains continuously,
   * so an un-chunked diff would push on nearly every snapshot. Empty (0) and
   * full (curMaxAp) always push immediately regardless of chunk size, so the
   * display never sits visibly wrong at either end just because the last step
   * into it was smaller than a chunk - this also sidesteps maxAP not being a
   * multiple of AP_SYNC_CHUNK, since chunking is relative to the last-sent
   * value rather than fixed absolute boundaries.
   */
  _diffAP(player, prevPlayer) {
    const commands = [];
    const curAp =
      player.ap !== undefined ? Math.floor(player.ap) : undefined;
    const curMaxAp =
      player.maxAP !== undefined ? Math.round(player.maxAP) : undefined;
    const prevMaxAp =
      prevPlayer.maxAP !== undefined ? Math.round(prevPlayer.maxAP) : undefined;

    if (curAp !== undefined) {
      const lastSent = this._lastSentAp;
      const atBound = curAp === 0 || (curMaxAp !== undefined && curAp === curMaxAp);
      const shouldSend =
        lastSent === undefined ||
        (atBound && lastSent !== curAp) ||
        Math.abs(curAp - lastSent) >= AP_SYNC_CHUNK;
      if (shouldSend) {
        commands.push(`player.setav('ap', ${JSON.stringify(curAp)}, !1)`);
        this._lastSentAp = curAp;
      }
    }
    if (curMaxAp !== undefined && curMaxAp !== prevMaxAp) {
      commands.push(`player.setav('maxap', ${JSON.stringify(curMaxAp)}, !1)`);
    }
    if (commands.length > 0) {
      commands.push(HP_HEADER_SOFT_REFRESH_CMD);
    }
    return commands;
  }

  /**
   * Generate carry-weight commands from game -> Pip-Boy.
   *
   * The current weight (`wg`) and max weight (`maxWg`) are copied directly from
   * the game and stored as ephemeral player values (persist = !1) so they never
   * get written to PLAYER.JSON. The firmware's getinfo override reads these
   * instead of summing the local inventory, which keeps the displayed weight
   * accurate even when the Pip-Boy is missing items or has modded items that
   * carry no weight data on-device.
   *
   * Refreshes the ITEMS header (MODE 1) so the Wg value updates without needing
   * a tab switch.
   */
  _diffWeight(player, prevPlayer) {
    const commands = [];
    const refreshHeader = ITEMS_HEADER_SOFT_REFRESH_CMD;

    if (player.wg !== undefined && player.wg !== prevPlayer.wg) {
      commands.push(`player.setav('wg', ${JSON.stringify(player.wg)}, !1)`);
    }
    if (player.maxWg !== undefined && player.maxWg !== prevPlayer.maxWg) {
      commands.push(`player.setav('maxwg', ${JSON.stringify(player.maxWg)}, !1)`);
    }
    if (commands.length > 0) {
      commands.push(refreshHeader);
    }

    return commands;
  }

  /**
   * Returns true for commands that confirm an equip/unequip state change.
   * These are routed through sendEquipCommand() to bypass the audio guard.
   */
  _isEquipCommand(cmd) {
    return (
      cmd.includes('equippedWeap') ||
      cmd.includes('refreshequip') ||
      cmd.includes('equipapparel')
    );
  }

  _buildAuthoritativeEquipCommands(player, prevPlayer = {}) {
    const commands = [];
    const weapon = this._toFormIdInt(player.equippedweap) ?? 0;
    const weapCnd = this._normalizeItemCondition(player.equippedweapcnd);
    const weapWhole = player.equippedweapwhole ? 1 : 0;
    // skipRefresh=!0 prevents a redundant Pip.refreshEquipState() inside setav;
    // REFRESH_EQUIP_CMD (player.refreshequip()) does the single authoritative render.
    commands.push(
      `player.setav('equippedWeap', ${weapon}, !0, !0);player.setav('equippedWeapCnd', ${weapCnd}, !1);player.setav('equippedWeapWhole', ${weapWhole}, !1);${REFRESH_EQUIP_CMD}`
    );
    // equipapparel re-reads APPAREL.DAT from flash AND triggers its own
    // refreshequip() (a second full render). For the common case - a weapon's
    // condition degrading - apparel is unchanged, so re-asserting it is pure
    // waste: it doubles the render count and adds a flash read for nothing. Only
    // send it when the equipped apparel set actually changed. The weapon line
    // above already provides the single authoritative render.
    const curApparel = this._normalizeEquippedApparelWithCnd(player);
    const prevApparel = this._normalizeEquippedApparelWithCnd(prevPlayer);
    if (JSON.stringify(curApparel) !== JSON.stringify(prevApparel)) {
      commands.push(this._buildEquipApparelCommand(curApparel));
    }
    return commands;
  }

  /**
   * Generate equip/unequip commands from game -> Pip-Boy equipped state.
   * Apparel slots are resolved on-device via APPAREL.DAT (item.es).
   */
  // force=true always emits both commands regardless of the diff - used for
  // full syncs, where prevPlayer is {} and "equipped nothing" would otherwise
  // look identical to "no change from an unknown prior device state" and get
  // skipped, leaving a stale equip from before the sync stuck on the device.
  _diffEquipped(player, prevPlayer, force = false) {
    const commands = [];

    const currentWeapon = this._toFormIdInt(player.equippedweap) ?? 0;
    const previousWeapon = this._toFormIdInt(prevPlayer.equippedweap) ?? 0;
    const currentWeapCnd = this._normalizeItemCondition(player.equippedweapcnd);
    const previousWeapCnd = this._normalizeItemCondition(prevPlayer.equippedweapcnd);
    const currentWeapWhole = player.equippedweapwhole ? 1 : 0;
    const previousWeapWhole = prevPlayer.equippedweapwhole ? 1 : 0;
    if (
      force ||
      currentWeapon !== previousWeapon ||
      currentWeapCnd !== previousWeapCnd ||
      currentWeapWhole !== previousWeapWhole
    ) {
      // skipRefresh=!0 avoids a double Pip.refreshEquipState() call; refreshequip() renders once.
      commands.push(
        `player.setav('equippedWeap', ${currentWeapon}, !0, !0);player.setav('equippedWeapCnd', ${currentWeapCnd}, !1);player.setav('equippedWeapWhole', ${currentWeapWhole}, !1);${REFRESH_EQUIP_CMD}`
      );
    }

    const currentApparel = this._normalizeEquippedApparelWithCnd(player);
    const previousApparel = this._normalizeEquippedApparelWithCnd(prevPlayer);
    if (force || JSON.stringify(currentApparel) !== JSON.stringify(previousApparel)) {
      commands.push(this._buildEquipApparelCommand(currentApparel));
    }

    return commands;
  }

  /**
   * Equipped apparel as {id, cnd} pairs (sorted by id), so the device can flag
   * only the worn condition row of each apparel form. Falls back to condition
   * 100 when the snapshot omits per-slot conditions.
   */
  _normalizeEquippedApparelWithCnd(player) {
    const ids = Array.isArray(player?.equippedapparel) ? player.equippedapparel : [];
    const cnds = Array.isArray(player?.equippedapparelcnd) ? player.equippedapparelcnd : [];
    return ids
      .map((id, i) => ({
        id: this._toFormIdInt(id),
        cnd: this._normalizeItemCondition(cnds[i]),
      }))
      .filter((p) => p.id !== null && p.id !== 0)
      .sort((a, b) => a.id - b.id);
  }

  _normalizeEquippedApparel(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((id) => this._toFormIdInt(id))
      .filter((id) => id !== null && id !== 0)
      .sort((a, b) => a - b);
  }

  /**
   * Push the equipped weapon's ammo state to the device for ammo selection:
   *   ammoActive - the ammo currently loaded (so AMMO.JS can mark it equipped)
   *   ammoUsable - every ammo form the weapon accepts (others are dimmed and
   *                cannot be selected)
   * Both are stored ephemerally (!1) so they never persist to PLAYER.JSON. When
   * the AMMO tab is open, re-read + re-render it so the change shows immediately.
   */
  _diffWeaponAmmo(player, prevPlayer, forceRefresh = false) {
    const commands = [];
    const wa = player.weaponammo || {};
    const prevWa = prevPlayer.weaponammo || {};

    const currentAmmo = this._toFormIdInt(wa.current) ?? 0;
    const prevAmmo = this._toFormIdInt(prevWa.current) ?? 0;
    const usable = this._normalizeAmmoList(wa.usable);
    const prevUsable = this._normalizeAmmoList(prevWa.usable);
    const currentWeapon = this._toFormIdInt(player.equippedweap) ?? 0;
    const prevWeapon = this._toFormIdInt(prevPlayer.equippedweap) ?? 0;
    const weaponChanged = currentWeapon !== prevWeapon;
    const force = forceRefresh || this._needsWeaponAmmoRefresh;
    if (this._needsWeaponAmmoRefresh) this._needsWeaponAmmoRefresh = false;

    if (force || weaponChanged) {
      commands.push(`player.setav('ammoActive', ${currentAmmo}, !1)`);
      commands.push(`player.setav('ammoUsable', [${usable.join(',')}], !1)`);
    } else {
      if (currentAmmo !== prevAmmo) {
        commands.push(`player.setav('ammoActive', ${currentAmmo}, !1)`);
      }
      if (JSON.stringify(usable) !== JSON.stringify(prevUsable)) {
        commands.push(`player.setav('ammoUsable', [${usable.join(',')}], !1)`);
      }
    }
    if (commands.length > 0) {
      commands.push("player.refreshequip('AMMO')");
    }

    return commands;
  }

  _normalizeAmmoList(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((id) => this._toFormIdInt(id))
      .filter((id) => id !== null && id !== 0)
      .sort((a, b) => a - b);
  }

  _hasEquipChange(snapshot) {
    if (!this.previousState?.player) return false;
    const player = snapshot.player || {};
    const prevPlayer = this.previousState.player || {};
    const weaponChanged =
      (this._toFormIdInt(player.equippedweap) ?? 0) !==
      (this._toFormIdInt(prevPlayer.equippedweap) ?? 0);
    const weapCndChanged =
      this._normalizeItemCondition(player.equippedweapcnd) !==
      this._normalizeItemCondition(prevPlayer.equippedweapcnd);
    const weapWholeChanged = !!(player.equippedweapwhole) !== !!(prevPlayer.equippedweapwhole);
    const apparelChanged =
      JSON.stringify(this._normalizeEquippedApparel(player.equippedapparel)) !==
      JSON.stringify(this._normalizeEquippedApparel(prevPlayer.equippedapparel));
    return weaponChanged || weapCndChanged || weapWholeChanged || apparelChanged;
  }

  _buildEquipApparelCommand(apparel) {
    // Accepts either [{id, cnd}] pairs or a bare [id] list (back-compat).
    const pairs = apparel.map((p) =>
      typeof p === 'object' && p !== null ? p : { id: p, cnd: 100 }
    );
    const idList = pairs.map((p) => p.id).join(',');
    const cndList = pairs.map((p) => this._normalizeItemCondition(p.cnd)).join(',');
    return `player.equipapparel([${idList}],[${cndList}])`;
  }

  /**
   * Batch forms of safeaddperk/saferemoveperk: formIds is a flat array, split
   * into player.addperksbulk()/removeperksbulk() commands of ≤MAX_ITEM_BATCH
   * entries each so the device opens PERKS.DAT/PERKS.INV once per batch
   * instead of once per perk.
   */
  _buildAddPerksBulkCommands(formIds) {
    const commands = [];
    for (let i = 0; i < formIds.length; i += MAX_ITEM_BATCH) {
      const slice = formIds.slice(i, i + MAX_ITEM_BATCH);
      commands.push(`player.addperksbulk([${slice.join(',')}])`);
    }
    return commands;
  }

  _buildRemovePerksBulkCommands(formIds) {
    const commands = [];
    for (let i = 0; i < formIds.length; i += MAX_ITEM_BATCH) {
      const slice = formIds.slice(i, i + MAX_ITEM_BATCH);
      commands.push(`player.removeperksbulk([${slice.join(',')}])`);
    }
    return commands;
  }

  /**
   * Full-sync perk reconciliation: formIds is the complete desired perk set.
   * Unlike the add/remove batches above, this must arrive as one call (the
   * device diffs it against PERKS.INV's current contents), so it isn't split.
   */
  _buildSetPerksBulkCommand(formIds) {
    return `player.setperksbulk([${formIds.join(',')}])`;
  }

  _normalizeItemCondition(condition) {
    if (condition === undefined || condition === null) return 100;
    const n = Number(condition);
    if (!Number.isFinite(n)) return 100;
    // Game plugin may send 0.0–1.0; Pip-Boy InvFile uses 0–100 (uint8).
    if (n > 0 && n <= 1) return Math.round(n * 100);
    return Math.round(Math.min(100, Math.max(0, n)));
  }

  _itemConditionChanged(currentItem, prevItem) {
    return (
      this._normalizeItemCondition(currentItem?.condition) !==
      this._normalizeItemCondition(prevItem?.condition)
    );
  }

  _buildSetItemConditionCommand(formId, condition) {
    const cnd = this._normalizeItemCondition(condition);
    return `player.setitemcondition(${formId},${cnd})`;
  }

  _toItemEntry(formId, count, condition) {
    return [formId, count, this._normalizeItemCondition(condition)];
  }

  /**
   * Batch form of additemhealthpercent: entries are [formId,count,cnd] triples
   * for a single category, split into player.additemsbulk() commands of
   * ≤MAX_ITEM_BATCH entries each so the device opens and flash-writes the
   * category file once per batch rather than once per item.
   */
  _buildAddItemsBulkCommands(cat, entries) {
    const commands = [];
    for (let i = 0; i < entries.length; i += MAX_ITEM_BATCH) {
      const slice = entries.slice(i, i + MAX_ITEM_BATCH);
      commands.push(
        `player.additemsbulk('${cat}',[${slice.map((e) => `[${e[0]},${e[1]},${e[2]}]`).join(',')}])`
      );
    }
    return commands;
  }

  /**
   * Batch form of removeitem: entries are [formId,qty,cnd] triples (cnd may be
   * `undefined` to match by id only) for a single category.
   */
  _buildRemoveItemsBulkCommands(cat, entries) {
    const commands = [];
    for (let i = 0; i < entries.length; i += MAX_ITEM_BATCH) {
      const slice = entries.slice(i, i + MAX_ITEM_BATCH);
      commands.push(
        `player.removeitemsbulk('${cat}',[${slice
          .map((e) => `[${e[0]},${e[1]},${e[2] === undefined ? 'undefined' : e[2]}]`)
          .join(',')}])`
      );
    }
    return commands;
  }

  /**
   * Full-sync reconciliation for one category: entries is the complete desired
   * contents (device diffs against what's actually on the card and only
   * touches rows that differ - see setitemsbulk_begin/chunk/end). Unlike
   * setperksbulk this can't arrive as one call - a category's item list can
   * exceed what safely fits in one line-buffered command - so it's split into
   * a begin/chunk x N/end sequence instead. Called for every category on every
   * full sync, even with an empty entries array, since that's what clears out
   * a category the player emptied.
   */
  _buildSetItemsBulkCommands(cat, entries) {
    const commands = [`player.setitemsbulk_begin('${cat}')`];
    for (let i = 0; i < entries.length; i += MAX_ITEM_BATCH) {
      const slice = entries.slice(i, i + MAX_ITEM_BATCH);
      commands.push(
        `player.setitemsbulk_chunk('${cat}',[${slice.map((e) => `[${e[0]},${e[1]},${e[2]}]`).join(',')}])`
      );
    }
    commands.push(`player.setitemsbulk_end('${cat}')`);
    return commands;
  }

  /**
   * Authoritatively rebuild every row of `formId` on the device from the given
   * per-condition stacks. Used for condition-distribution changes so a single
   * command replaces a fragile add+remove pair (and clears any orphaned row).
   */
  _buildSetFormStacksCommand(formId, stacks) {
    const list = stacks
      .filter((s) => (s.cnt || 0) > 0)
      .map((s) => `{cnt:${s.cnt || 1},cnd:${this._normalizeItemCondition(s.cnd)}}`)
      .join(',');
    return `player.setformstacks(${formId},[${list}])`;
  }

  _toDamEntry(formId, condition, dam) {
    return [
      formId,
      this._normalizeItemCondition(condition),
      Math.max(0, Math.round(dam)),
    ];
  }

  /**
   * Batch form of setdam: `entries` is an array of [formId, cnd, dam] triples,
   * split into player.setdams() commands of ≤MAX_DAM_BATCH entries each so the
   * device opens and flash-writes *_DAM.INV once per batch rather than once
   * per weapon stack (flash writes are the slowest device operation).
   */
  _buildSetDamBatchCommands(entries) {
    const commands = [];
    for (let i = 0; i < entries.length; i += MAX_DAM_BATCH) {
      const slice = entries.slice(i, i + MAX_DAM_BATCH);
      commands.push(
        `player.setdams([${slice.map((e) => `[${e[0]},${e[1]},${e[2]}]`).join(',')}])`
      );
    }
    return commands;
  }

  /**
   * Full-sync DAM reconciliation: entries is the complete desired *_DAM.INV
   * contents, split into a begin/chunk x N/end sequence (device diffs in place
   * - see setdamsbulk_begin/chunk/end) instead of clearing the file and
   * rewriting it whole on every full sync.
   */
  _buildSetDamsBulkCommands(entries) {
    const commands = ['player.setdamsbulk_begin()'];
    for (let i = 0; i < entries.length; i += MAX_DAM_BATCH) {
      const slice = entries.slice(i, i + MAX_DAM_BATCH);
      commands.push(
        `player.setdamsbulk_chunk([${slice.map((e) => `[${e[0]},${e[1]},${e[2]}]`).join(',')}])`
      );
    }
    commands.push('player.setdamsbulk_end()');
    return commands;
  }

  /**
   * Batch form of removedam: entries are [formId,cnd] pairs, split into
   * player.removedams() commands of ≤MAX_DAM_BATCH entries each.
   */
  _buildRemoveDamBatchCommands(entries) {
    const commands = [];
    for (let i = 0; i < entries.length; i += MAX_DAM_BATCH) {
      const slice = entries.slice(i, i + MAX_DAM_BATCH);
      commands.push(
        `player.removedams([${slice.map((e) => `[${e[0]},${e[1]}]`).join(',')}])`
      );
    }
    return commands;
  }

  /**
   * Resolve a game form ID to a Pip-Boy integer form ID.
   */
  _toFormIdInt(gameFormId) {
    if (gameFormId === undefined || gameFormId === null) return null;
    if (gameFormId === 0 || gameFormId === '0') return 0;

    let resolved = gameFormId;
    if (this.mapper) {
      const mapped = this.mapper.resolve(gameFormId, this.gameMode || 'FNV');
      if (mapped === null) {
        this.emit('warning', `Unknown form ID: ${gameFormId}`);
        return null;
      }
      if (mapped !== gameFormId) {
        const fromHex =
          typeof gameFormId === 'number'
            ? `0x${(gameFormId >>> 0).toString(16)}`
            : String(gameFormId);
        const toHex =
          typeof mapped === 'number'
            ? `0x${(mapped >>> 0).toString(16)}`
            : String(mapped);
        this.emit('status', `Form ID ${fromHex} -> ${toHex}`);
      }
      resolved = mapped;
    }

    if (typeof resolved === 'number' && Number.isFinite(resolved)) {
      return resolved >>> 0;
    }

    if (typeof resolved === 'string') {
      const trimmed = resolved.trim().toLowerCase();
      if (trimmed.startsWith('0x')) {
        const parsed = parseInt(trimmed, 16);
        return Number.isNaN(parsed) ? null : parsed >>> 0;
      }
      const parsed = parseInt(trimmed, 10);
      return Number.isNaN(parsed) ? null : parsed >>> 0;
    }

    return null;
  }

  /**
   * Resolve a game form ID to a Pip-Boy form ID
   * If no mapper is configured or the ID isn't found, returns the raw ID
   */
  _resolveFormId(gameFormId) {
    return this._toFormIdInt(gameFormId);
  }

  _parsePresyncBackupStatus(raw) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      const match = String(raw).match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error(`Unexpected presync status: ${String(raw).slice(0, 80)}`);
    }
  }

  async _getPresyncBackupStatus() {
    // manifest v3: presyncCats grew from 5 item categories to 7 (added PERKS,
    // SKILLS as INV files) - bumping the version forces one fresh backup pass
    // for installs upgrading from the old JSON-based perk/skill backup.
    const expr = `(()=>{try{var f=require('fs'),m=NV?'NV':'F3',r={hasManifest:!1,manifestOld:!0,playerMissing:!0,invMissing:!0},cats=['AID','AMMO','APPAREL','MISC','WEAPONS','PERKS','SKILLS'],i,p;try{var man=JSON.parse(f.readFileSync('INV/PRESYNC/MANIFEST.JSON'));r.hasManifest=!0;r.manifestOld=!man.v||man.v<3}catch(e){}try{f.statSync('SETTINGS/PRESYNC/PLAYER.JSON');r.playerMissing=!1}catch(e){}try{f.statSync('INV/PRESYNC/'+m);for(i=0;i<cats.length;i++){p='INV/PRESYNC/'+m+'/'+cats[i]+'.INV';try{f.statSync(p);r.invMissing=!1;break}catch(e){}}}catch(e){}return r}catch(e){return{error:!0}}})()`;
    const raw = await this.bridge.eval(expr);
    return this._parsePresyncBackupStatus(raw);
  }

  /**
   * Back up live inventory and SETTINGS data to PRESYNC folders before the first game sync.
   * Each asset is backed up independently so a partial backup can be completed later.
   */
  async _backupPresyncData() {
    if (!this.bridge?.connected) return;

    try {
      await this.bridge.sendCommand(
        `(()=>{var f=require('fs'),m=NV?'NV':'F3';f.statSync('SETTINGS/PRESYNC')||f.mkdirSync('SETTINGS/PRESYNC');f.statSync('INV/PRESYNC')||f.mkdirSync('INV/PRESYNC');f.statSync('INV/PRESYNC/'+m)||f.mkdirSync('INV/PRESYNC/'+m)})()`
      );

      const status = await this._getPresyncBackupStatus();

      if (!status.hasManifest || status.playerMissing) {
        await this.bridge.sendCommand(`(()=>{try{player.sync()}catch(e){}})()`);
        await this.bridge.sendCommand(
          `(()=>{var f=require('fs'),o={},p=player.player,e=player.ephemeral,k,avs=['name','level','karma','strength','perception','endurance','charisma','intelligence','agility','luck','perceptioncondition','endurancecondition','leftattackcondition','rightattackcondition','leftmobilitycondition','rightmobilitycondition','dr','equippedweap','equippedapparel','invWt','map'];for(k in p)o[k]=p[k];for(k in e)o[k]=e[k];for(var i=0;i<avs.length;i++){var v=player.getav(avs[i]);if(v!==undefined)o[avs[i]]=v;}try{f.writeFileSync('SETTINGS/PRESYNC/PLAYER.JSON',JSON.stringify(o))}catch(err){}})()`
        );
      }

      if (status.invMissing || status.manifestOld) {
        this.emit('status', 'Backing up pre-sync inventory...');
        await this.bridge.sendCommand(
          `(()=>{var f=require('fs'),m=NV?'NV':'F3';f.statSync('INV/'+m)||f.mkdirSync('INV/'+m)})()`
        );
        for (const cat of PRESYNC_CATEGORIES) {
          await this.bridge.sendCommand(
            `(()=>{var f=require('fs'),m=NV?'NV':'F3',live='INV/'+m+'/${cat}.INV',def='INV/DEFAULT/'+m+'/${cat}.INV',dst='INV/PRESYNC/'+m+'/${cat}.INV',d='';try{d=f.readFileSync(live)}catch(e){}if(!d||!d.length){try{d=f.readFileSync(def)}catch(e){}}try{f.writeFileSync(dst,d||'')}catch(e){}})()`
          );
        }
      }

      await this.bridge.sendCommand(
        `(()=>{try{require('fs').writeFileSync('INV/PRESYNC/MANIFEST.JSON',JSON.stringify({mode:NV?'NV':'F3',ts:Date.now(),v:3}))}catch(e){}})()`
      );

      this.emit('status', 'Pre-sync data backed up');
    } catch (err) {
      this.emit('warning', `Pre-sync backup failed: ${err.message}`);
    }
  }

  /**
   * Force a full resync from scratch
   */
  async forceFullSync() {
    this._resetForFullSync();
    this.emit('status', 'Forced full resync on next snapshot');
  }

  /**
   * Game loaded a save or started a new game - discard cached state.
   */
  handleSaveLoad() {
    this._resetForFullSync();
    this.emit('status', 'Game save loaded - full resync on next snapshot');
  }

  /**
   * Reset all cached/queued snapshot state so the next processed snapshot is a
   * guaranteed full sync. Bumps the state generation so any snapshot currently
   * mid-flight cannot write its stale state back into previousState, and drops
   * any debounced/pending pre-load snapshots that would otherwise seed an
   * incremental diff.
   */
  _resetForFullSync() {
    this._stateGeneration++;
    this._inventorySyncPaused = false;
    this.previousState = null;
    this._deviceConsumed.clear();
    this._deviceEquipPending.clear();
    this._deviceTorchPending = null;
    this._resyncEquipAfterInventory = false;
    this._lastSentAp = undefined;
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    this._debouncedSnapshot = null;
    this._pendingSnapshot = null;
  }

  /**
   * Deep clone a snapshot for comparison
   */
  _cloneSnapshot(snapshot) {
    return JSON.parse(JSON.stringify(snapshot));
  }

  /**
   * Get current sync statistics
   */
  getStats() {
    return { ...this.stats };
  }
}

export default SyncEngine;
