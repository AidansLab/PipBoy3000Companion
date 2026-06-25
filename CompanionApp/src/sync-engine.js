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
// 500ms is a good balance — 250ms matches the game poll and can queue serial work faster.
const SYNC_DEBOUNCE_MS = 500;

// player.setav markers for S.P.E.C.I.A.L. — refreshed softly on the SPECIAL tab.
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

// Caps/Wg/HP in the ITEMS chrome — header only, no tab rebuild.
const ITEMS_HEADER_SOFT_REFRESH_CMD = 'player.renderheader(!0);';

/** Full menu rebuild for STATS sub-tabs except GENERAL/SPECIAL/SKILLS (soft refresh). */
const STATS_TAB_FULL_REFRESH_CMD =
  `if(typeof Pip!=='undefined'&&Pip.CURRENT&&Pip.MODE===0&&Pip.changeMenu&&` +
  `Pip.CURRENT.id!=='GENERAL'&&Pip.CURRENT.id!=='SPECIAL'&&Pip.CURRENT.id!=='SKILLS')Pip.changeMenu();`;

/** Used after full sync — inventory tabs still get changeMenu; STATS uses soft where possible. */
const FULL_SYNC_UI_REFRESH_CMD = 'player.fullsyncrefresh();';

const INVENTORY_CATEGORIES = ['AID', 'AMMO', 'APPAREL', 'MISC', 'WEAPONS'];
const CLEAR_INV_CMD = 'player.clearinv()';
const CLEAR_PERKS_CMD = 'player.clearperks()';
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
    // Device-initiated equip/unequip — suppress bag-count echoes (equip moves 1
    // to worn without reducing total owned; unequip returns 1 to bag).
    // gameFormId (lowercase) -> { action: 'equip'|'unequip', count, time }
    this._deviceEquipPending = new Map();
    // Device-initiated torch toggles — don't let a stale game snapshot turn the LED off.
    this._deviceTorchPending = null;
    this._resyncEquipAfterInventory = false;
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
    this._lastMismatchWarning = null;
    this.emit('game-mode-changed', mode);
  }

  /** Clear cached mode so the next connect re-reads NV from the device. */
  clearGameMode() {
    if (!this.gameMode) return;
    this.gameMode = null;
    this.previousState = null;
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
      // drop this one — park it (keeping only the newest) and process it as
      // soon as the current batch finishes.
      this._pendingSnapshot = snapshot;
      return;
    }

    this._processingSnapshot = true;
    this.stats.snapshotsProcessed++;

    // Remap form IDs when runtime load order differs from Pip-Boy fixed offsets.
    if (snapshot.loadOrder && this.mapper?.setLoadOrder) {
      const loadOrderChanged = this.mapper.setLoadOrder(snapshot.loadOrder);
      if (loadOrderChanged && this.previousState) {
        this.previousState = null;
        this.emit('status', 'Load order updated — forcing full resync');
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
          'Game plugin did not send faction data — rebuild FalloutPipBoySync.dll (v6+) and restart the game'
        );
      }

      if (commands.length > 0) {
        const factionCmd = commands.find((c) => c.includes('REP_VISIBLE.JSON'));
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
          // Caps and carry weight live in the ITEMS header — only refresh on inventory tabs.
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

        for (const cmd of commands) {
          // Equip confirmation commands bypass the audio guard so the split
          // appears as soon as the game round-trip completes.
          if (this._isEquipCommand(cmd)) {
            await this.bridge.sendEquipCommand(cmd);
          } else {
            await this.bridge.sendCommand(cmd);
          }
          this.stats.commandsSent++;
        }

        // SYNC-DISABLED: player.sync() — inventory menus flush .INV on page exit
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

      this.previousState = this._cloneSnapshot(snapshot);
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
      // First snapshot — do a full sync
      return this._generateFullSync(snapshot);
    }

    // --- Player attribute diffs ---
    const player = snapshot.player || {};
    const prevPlayer = prev.player || {};

    if (!this._inventorySyncPaused) {
      // Simple scalar attributes
      // 'hp' is the game's true health pool (kAV_Health) — the Pip-Boy firmware
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

    // Carry weight + AP — game-authoritative; always sync (not gated on inventory pause)
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
        // Inventory removed items — push inventory first, then re-authorise equip
        this._resyncEquipAfterInventory = false;
        commands.push(...invCommands);
        commands.push(...this._buildAuthoritativeEquipCommands(player));
      } else {
        // Normal case: equip command first so split appears as fast as possible,
        // then inventory count updates follow.
        commands.push(...this._diffEquipped(player, prevPlayer));
        commands.push(...invCommands);
      }
    } else {
      commands.push(...invCommands);
    }

    // Weapon ammo — ephemeral UI state; always sync (not gated on inventory pause)
    commands.push(...this._diffWeaponAmmo(player, prevPlayer));

    if (!this._inventorySyncPaused) {

      // --- Perk diffs ---
      const perkCommands = this._diffPerks(
        snapshot.perks || [],
        prev.perks || []
      );
      commands.push(...perkCommands);

      // --- Skill diffs (written to SETTINGS/*_SKILLS.JSON on device) ---
      commands.push(...this._diffSkills(player, prevPlayer));
    }

    // Faction reputation — always sync (not gated on inventory pause)
    commands.push(...this._diffFactions(this._getFactions(snapshot), this._getFactions(prev)));

    // Pip-Boy flashlight LED — game → device only (independent of inventory pause)
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
      // Reset inventory synchronously to avoid race conditions. Completely clear the files instead of loading the Pip-Boy's default start items.
      commands.push(CLEAR_INV_CMD);

      // Set player name
      if (player.name) {
        commands.push(`player.setav('name', ${JSON.stringify(player.name)}, !0)`);
      }

      // Set level
      if (player.level) {
        commands.push(`player.setlevel(${player.level})`);
      }

      // Set all scalar attributes (hp = true health pool from the game;
      // maxHP is omitted — the Pip-Boy calculates it itself)
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

      // Carry weight — game-authoritative (see _diffWeight)
      commands.push(...this._diffWeight(player, {}));

      // Skills — stored in SETTINGS/*_SKILLS.JSON (not player.setav)
      if (player.skills) {
        const skillCmd = this._buildSyncSkillsCommand(player.skills);
        if (skillCmd) commands.push(skillCmd);
      }

      // Add all inventory items
      const inventory = snapshot.inventory || [];
      for (const item of inventory) {
        const formId = this._resolveFormId(item.formId);
        if (formId === null) continue;

        if (this._itemHasDegradedCondition(item)) {
          commands.push(
            this._buildAddItemHealthPercentCommand(formId, item.count || 1, item.condition)
          );
        } else {
          commands.push(
            this._buildAddItemCommand(formId, item.count || 1)
          );
        }
      }
      // SYNC-DISABLED: calculateInvWeight() writes every .INV file
      // commands.push('player.calculateInvWeight()');

      // Equipped items — after inventory is populated
      commands.push(...this._diffEquipped(player, {}));
    }

    // Action Points — always sync on full sync
    commands.push(...this._diffAP(player, {}));

    // Weapon ammo — ephemeral UI state for AMMO tab dimming/selection
    commands.push(...this._diffWeaponAmmo(player, {}));

    if (!this._inventorySyncPaused) {
      // Add all perks (clear existing first)
      commands.push(CLEAR_PERKS_CMD);
      const perks = snapshot.perks || [];
      for (const perk of perks) {
        const formIdStr = typeof perk === 'string' ? perk : perk.formId;
        const formId = this._toFormIdInt(formIdStr);
        if (formId === null) continue;
        commands.push(this._buildSafeAddPerk(formId));
      }
    }

    // Faction reputation — always sync (not gated on inventory pause)
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
   * double-decrement the device).
   * @param {string|number} gameFormId
   */
  notifyDeviceConsumed(gameFormId) {
    const key = String(gameFormId).toLowerCase();
    const entry = this._deviceConsumed.get(key) || { count: 0, time: 0 };
    entry.count++;
    entry.time = Date.now();
    this._deviceConsumed.set(key, entry);
  }

  /**
   * User equipped an item on the Pip-Boy. The game moves one unit to the worn
   * slot but total owned is unchanged — do not mirror a bag-count drop on device.
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
   * total owned is unchanged — do not mirror a bag-count rise on device.
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
   * User toggled the torch on the physical Pip-Boy. Ignore game→device torch
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
   * Pip-Boy restored pre-sync data (only possible when cmode is off — companion
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

    // Check for too many changes — might indicate a save load or major event
    const addedIds = [...currentMap.keys()].filter(id => !previousMap.has(id));
    const removedIds = [...previousMap.keys()].filter(id => !currentMap.has(id));

    if (addedIds.length + removedIds.length > MAX_INVENTORY_DELTA) {
      // Too many changes — do a full inventory reset
      this.emit('status', 'Large inventory change detected, performing full reset');
      this._lastChangedCategories = new Set(['AID','AMMO','APPAREL','MISC','WEAPONS']);
      commands.push(CLEAR_INV_CMD);
      // SYNC-DISABLED: calculateInvWeight() writes every .INV file
    // commands.push('player.calculateInvWeight()');
      for (const item of current) {
        const formId = this._resolveFormId(item.formId);
        if (formId === null) continue;
        if (this._itemHasDegradedCondition(item)) {
          commands.push(
            this._buildAddItemHealthPercentCommand(formId, item.count || 1, item.condition)
          );
        } else {
          commands.push(
            this._buildAddItemCommand(formId, item.count || 1)
          );
        }
      }
      return commands;
    }

    // Items added (new formIds not in previous)
    for (const id of addedIds) {
      const item = currentMap.get(id);
      const formId = this._resolveFormId(item.formId);
      if (formId === null) continue;
      const cat = this._toPipBoyCategory(item.type);
      if (cat) this._lastChangedCategories.add(cat);

      if (this._itemHasDegradedCondition(item)) {
        commands.push(
          this._buildAddItemHealthPercentCommand(formId, item.count || 1, item.condition)
        );
      } else {
        commands.push(
          this._buildAddItemCommand(formId, item.count || 1)
        );
      }
    }

    // Stacks where only the count changed (same form + same condition). A
    // condition change instead surfaces as a removed key + an added key, handled
    // by the add/remove loops, so the cnd is carried on remove to target the
    // correct stack on the device.
    for (const [key, currentItem] of currentMap) {
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
          if (cat) this._lastChangedCategories.add(cat);
          if (this._itemHasDegradedCondition(currentItem)) {
            commands.push(
              this._buildAddItemHealthPercentCommand(formId, addQty, currentItem.condition)
            );
          } else {
            commands.push(this._buildAddItemCommand(formId, addQty));
          }
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
          if (cat) this._lastChangedCategories.add(cat);
          const removeCmd = this._buildRemoveItemCommand(cat, formId, removeQty, currentItem.condition);
          commands.push(removeCmd);
          this._resyncEquipAfterInventory = true;
        }
      }
    }

    // Stacks removed (form+condition present before but not now)
    for (const key of removedIds) {
      const prevItem = previousMap.get(key);
      const gameFormId = prevItem.formId;
      // Skip units the device already removed from itself
      const prevCount = prevItem.count || 1;
      const removeQty = prevCount - this._takeDeviceConsumed(gameFormId, prevCount);
      if (removeQty <= 0) continue;

      this._deviceEquipPending.delete(String(gameFormId).toLowerCase());

      const formId = this._resolveFormId(gameFormId);
      if (formId !== null) {
        const cat = this._toPipBoyCategory(prevItem.type);
        if (cat) this._lastChangedCategories.add(cat);
        const removeCmd = this._buildRemoveItemCommand(cat, formId, removeQty, prevItem.condition);
        commands.push(removeCmd);
        this._resyncEquipAfterInventory = true;
      }
    }

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
   * Write skill levels to SETTINGS/*_SKILLS.JSON on the Pip-Boy.
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

    const curVis = normalized.filter((f) => f.discovered).map((f) => f.name);
    let visListChanged = !previous;
    if (previous) {
      const prevVis = this._normalizeFactions(previous)
        .filter((f) => f.discovered)
        .map((f) => f.name);
      visListChanged =
        curVis.length !== prevVis.length ||
        curVis.some((n, i) => n !== prevVis[i]);
    }

    const payload = JSON.stringify(normalized);
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
    for (const perkId of currentSet) {
      if (!previousSet.has(perkId)) {
        const formId = this._toFormIdInt(perkId);
        if (formId === null) continue;
        commands.push(this._buildSafeAddPerk(formId));
      }
    }

    // Removed perks
    for (const perkId of previousSet) {
      if (!currentSet.has(perkId)) {
        const formId = this._toFormIdInt(perkId);
        if (formId === null) continue;
        commands.push(this._buildSafeRemovePerk(formId));
      }
    }

    return commands;
  }

  /**
   * Generate action-point commands from game → Pip-Boy.
   * Stock firmware shows maxAP/maxAP in the STATS header; boot0 overrides when
   * cmode is on. Values are ephemeral (!1) and refreshed via renderHeader.
   */
  _diffAP(player, prevPlayer) {
    const commands = [];
    const curAp =
      player.ap !== undefined ? Math.floor(player.ap) : undefined;
    const prevAp =
      prevPlayer.ap !== undefined ? Math.floor(prevPlayer.ap) : undefined;
    const curMaxAp =
      player.maxAP !== undefined ? Math.round(player.maxAP) : undefined;
    const prevMaxAp =
      prevPlayer.maxAP !== undefined ? Math.round(prevPlayer.maxAP) : undefined;

    if (curAp !== undefined && curAp !== prevAp) {
      commands.push(`player.setav('ap', ${JSON.stringify(curAp)}, !1)`);
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
   * Generate carry-weight commands from game → Pip-Boy.
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

  _buildAuthoritativeEquipCommands(player) {
    const commands = [];
    const weapon = this._toFormIdInt(player.equippedweap) ?? 0;
    const weapCnd = this._normalizeItemCondition(player.equippedweapcnd);
    const weapWhole = player.equippedweapwhole ? 1 : 0;
    // skipRefresh=!0 prevents a redundant Pip.refreshEquipState() inside setav;
    // REFRESH_EQUIP_CMD (player.refreshequip()) does the single authoritative render.
    commands.push(
      `player.setav('equippedWeap', ${weapon}, !0, !0);player.setav('equippedWeapCnd', ${weapCnd}, !1);player.setav('equippedWeapWhole', ${weapWhole}, !1);${REFRESH_EQUIP_CMD}`
    );
    commands.push(
      this._buildEquipApparelCommand(this._normalizeEquippedApparelWithCnd(player))
    );
    return commands;
  }

  /**
   * Generate equip/unequip commands from game → Pip-Boy equipped state.
   * Apparel slots are resolved on-device via APPAREL.DAT (item.es).
   */
  _diffEquipped(player, prevPlayer) {
    const commands = [];

    const currentWeapon = this._toFormIdInt(player.equippedweap) ?? 0;
    const previousWeapon = this._toFormIdInt(prevPlayer.equippedweap) ?? 0;
    const currentWeapCnd = this._normalizeItemCondition(player.equippedweapcnd);
    const previousWeapCnd = this._normalizeItemCondition(prevPlayer.equippedweapcnd);
    const currentWeapWhole = player.equippedweapwhole ? 1 : 0;
    const previousWeapWhole = prevPlayer.equippedweapwhole ? 1 : 0;
    if (
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
    if (JSON.stringify(currentApparel) !== JSON.stringify(previousApparel)) {
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
   *   ammoActive — the ammo currently loaded (so AMMO.JS can mark it equipped)
   *   ammoUsable — every ammo form the weapon accepts (others are dimmed and
   *                cannot be selected)
   * Both are stored ephemerally (!1) so they never persist to PLAYER.JSON. When
   * the AMMO tab is open, re-read + re-render it so the change shows immediately.
   */
  _diffWeaponAmmo(player, prevPlayer) {
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
    const force = this._needsWeaponAmmoRefresh;
    if (force) this._needsWeaponAmmoRefresh = false;

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

  _buildSafeAddPerk(formId) {
    return `player.safeaddperk(${formId})`;
  }

  _buildSafeRemovePerk(formId) {
    return `player.saferemoveperk(${formId})`;
  }

  _normalizeItemCondition(condition) {
    if (condition === undefined || condition === null) return 100;
    const n = Number(condition);
    if (!Number.isFinite(n)) return 100;
    // Game plugin may send 0.0–1.0; Pip-Boy InvFile uses 0–100 (uint8).
    if (n > 0 && n <= 1) return Math.round(n * 100);
    return Math.round(Math.min(100, Math.max(0, n)));
  }

  _itemHasDegradedCondition(item) {
    return this._normalizeItemCondition(item?.condition) !== 100;
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

  _buildAddItemHealthPercentCommand(formId, count, condition) {
    const cnt = count || 1;
    const cnd = this._normalizeItemCondition(condition);
    return `player.additemhealthpercent(${formId},${cnt},${cnd})`;
  }

  _buildAddItemCommand(formId, count) {
    return this._buildAddItemHealthPercentCommand(formId, count, 100);
  }

  _buildRemoveItemCommand(cat, formId, removeQty, condition) {
    if (condition === undefined || condition === null) {
      return `player.removeitem(${formId},${removeQty})`;
    }
    const cnd = this._normalizeItemCondition(condition);
    return `player.removeitem(${formId},${removeQty},${cnd})`;
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
        this.emit('status', `Form ID ${fromHex} → ${toHex}`);
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
    const expr = `(()=>{try{var f=require('fs'),m=NV?'NV':'F3',r={hasManifest:!1,manifestOld:!0,playerMissing:!0,invMissing:!0,perksMissing:!0,skillsMissing:!0},cats=['AID','AMMO','APPAREL','MISC','WEAPONS'],i,p;try{var man=JSON.parse(f.readFileSync('INV/PRESYNC/MANIFEST.JSON'));r.hasManifest=!0;r.manifestOld=!man.v||man.v<2}catch(e){}try{f.statSync('SETTINGS/PRESYNC/PLAYER.JSON');r.playerMissing=!1}catch(e){}try{f.statSync('INV/PRESYNC/'+m);for(i=0;i<5;i++){p='INV/PRESYNC/'+m+'/'+cats[i]+'.INV';try{f.statSync(p);r.invMissing=!1;break}catch(e){}}}catch(e){}try{f.statSync('SETTINGS/PRESYNC/'+m+'_PERKS.JSON');r.perksMissing=!1}catch(e){}try{f.statSync('SETTINGS/PRESYNC/'+m+'_SKILLS.JSON');r.skillsMissing=!1}catch(e){}return r}catch(e){return{error:!0}}})()`;
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

      if (status.invMissing) {
        this.emit('status', 'Backing up pre-sync inventory...');
        await this.bridge.sendCommand(
          `(()=>{var f=require('fs'),m=NV?'NV':'F3';f.statSync('INV/'+m)||f.mkdirSync('INV/'+m)})()`
        );
        for (const cat of INVENTORY_CATEGORIES) {
          await this.bridge.sendCommand(
            `(()=>{var f=require('fs'),m=NV?'NV':'F3',live='INV/'+m+'/${cat}.INV',def='INV/DEFAULT/'+m+'/${cat}.INV',dst='INV/PRESYNC/'+m+'/${cat}.INV',d='';try{d=f.readFileSync(live)}catch(e){}if(!d||!d.length){try{d=f.readFileSync(def)}catch(e){}}try{f.writeFileSync(dst,d||'')}catch(e){}})()`
          );
        }
      }

      if (status.perksMissing || status.manifestOld) {
        await this._backupPresyncSettingsFile('PERKS');
      }
      if (status.skillsMissing || status.manifestOld) {
        await this._backupPresyncSettingsFile('SKILLS');
      }

      await this.bridge.sendCommand(
        `(()=>{try{require('fs').writeFileSync('INV/PRESYNC/MANIFEST.JSON',JSON.stringify({mode:NV?'NV':'F3',ts:Date.now(),v:2}))}catch(e){}})()`
      );

      this.emit('status', 'Pre-sync data backed up');
    } catch (err) {
      this.emit('warning', `Pre-sync backup failed: ${err.message}`);
    }
  }

  async _backupPresyncSettingsFile(kind) {
    const perkFallback =
      kind === 'PERKS'
        ? "if(!d||!d.length){try{d=f.readFileSync('SETTINGS/DEFAUlT/'+m+'_PERKS.JSON')}catch(e){}}"
        : '';
    await this.bridge.sendCommand(
      `(()=>{var f=require('fs'),m=NV?'NV':'F3',live='SETTINGS/'+m+'_${kind}.JSON',dst='SETTINGS/PRESYNC/'+m+'_${kind}.JSON',def='SETTINGS/DEFAULT/'+m+'_${kind}.JSON',d='';try{d=f.readFileSync(live)}catch(e){}if(!d||!d.length){try{d=f.readFileSync(def)}catch(e){}}${perkFallback}try{f.writeFileSync(dst,d||'')}catch(e){}})()`
    );
  }

  /**
   * Force a full resync from scratch
   */
  async forceFullSync() {
    this._inventorySyncPaused = false;
    this.previousState = null;
    this._deviceConsumed.clear();
    this._deviceEquipPending.clear();
    this._deviceTorchPending = null;
    this.emit('status', 'Forced full resync on next snapshot');
  }

  /**
   * Game loaded a save or started a new game — discard cached state.
   */
  handleSaveLoad() {
    this._inventorySyncPaused = false;
    this.previousState = null;
    this._deviceConsumed.clear();
    this._deviceEquipPending.clear();
    this._deviceTorchPending = null;
    this.emit('status', 'Game save loaded — full resync on next snapshot');
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
