/**
 * app-core.js
 *
 * Shared companion application logic used by the CLI and Electron UI.
 */

import { EventEmitter } from 'events';
import { SerialBridge } from './serial-bridge.js';
import { SyncEngine } from './sync-engine.js';
import { PipeClient } from './pipe-client.js';
import { FormIdMapper, formatGameFormId } from './form-id-mapper.js';

export const PRESYNC_RESTORE_HINT =
  'To restore pre-sync data, disconnect the companion app, then go to Settings>User>Restore pre-sync data';

export const COMPANION_PATCH_REQUIRED_MSG =
  'Companion patch not installed. Use "Install Companion Menus & Boot Patch" before syncing.';

export class CompanionApp extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      port: null,
      game: null,
      noGame: false,
      autoReconnect: true,
      ...options,
    };

    this.bridge = new SerialBridge({
      comPort: this.options.port,
      autoReconnect: this.options.autoReconnect,
    });
    this.mapper = new FormIdMapper();
    this.syncEngine = new SyncEngine(this.bridge, this.mapper);
    this.pipeClient = new PipeClient({ autoReconnect: true });
    this._started = false;
    this._initialSyncHintShown = false;
    this._deviceReady = false;
    this._deviceSetupChain = null;
    this._companionPatchInstalled = false;
    this._postFlashSetupPending = false;
    this._inventoryResyncPending = false;
  }

  log(level, message) {
    this.emit('log', { level, message, time: new Date() });
  }

  getStatus() {
    return {
      pipBoyConnected: this.bridge.connected,
      gameConnected: this.pipeClient.connected,
      syncEnabled: this.syncEngine.enabled,
      torchSyncEnabled: this.syncEngine.torchSyncEnabled,
      companionPatchInstalled: this._companionPatchInstalled,
      gameMode: this.syncEngine.gameMode,
      stats: this.syncEngine.getStats(),
      mapper: this.mapper.getStats(),
    };
  }

  _emitStatus() {
    this.emit('status', this.getStatus());
  }

  /**
   * Toggle bidirectional flashlight sync (game ↔ Pip-Boy torch LED).
   * @param {boolean} enabled
   */
  setTorchSyncEnabled(enabled) {
    // syncEngine.setTorchSyncEnabled emits a 'status' event that is already
    // forwarded to the log, so don't log again here (avoids duplicate lines).
    this.syncEngine.setTorchSyncEnabled(enabled);
    this._emitStatus();
  }

  async autoDetectGameMode() {
    if (this.syncEngine.gameMode) return;
    try {
      this.log('status', 'Detecting Pip-Boy game mode...');
      const mode = await this.bridge.detectGameMode();
      this.syncEngine.setGameMode(mode);
      const label = mode === 'FNV' ? 'Fallout: New Vegas' : 'Fallout 3';
      this.log('status', `Detected game mode: ${label}`);
      this._emitStatus();
    } catch (err) {
      this.log('warn', `Could not auto-detect game mode: ${err.message}`);
    }
  }

  async _verifyCompanionPatch(options = {}) {
    const afterFlash = !!options.afterFlash;
    const maxAttempts = options.maxAttempts ?? (afterFlash ? 24 : 8);
    const intervalMs = options.intervalMs ?? (afterFlash ? 1500 : 1000);

    try {
      this._companionPatchInstalled = await this.bridge.hasCompanionPatch({
        maxAttempts,
        intervalMs,
      });
    } catch (err) {
      this._companionPatchInstalled = false;
      this.log('warn', err.message);
    }

    if (this._companionPatchInstalled) {
      const wasInstalled = !!options.wasInstalled;
      if (!wasInstalled && afterFlash) {
        this.log('status', 'Companion patch detected');
      }
    } else {
      this.log('warn', COMPANION_PATCH_REQUIRED_MSG);
    }
    return this._companionPatchInstalled;
  }

  async _handleDeviceConnected(options = {}) {
    const wasInstalled = this._companionPatchInstalled;
    this._deviceReady = false;
    if (!options.skipSyncPause) {
      this.syncEngine.setEnabled(false);
    }
    if (!(await this._verifyCompanionPatch({ ...options, wasInstalled }))) {
      this._emitStatus();
      return;
    }
    if (!this.options.game) {
      await this.autoDetectGameMode();
    }
    this._deviceReady = true;
    if (this.pipeClient.connected) {
      await this._tryEnableSync({
        requestResync:
          !!options.afterFlash ||
          (!!this.pipeClient.lastSnapshot &&
            this.syncEngine.getStats().snapshotsProcessed === 0),
      });
    } else if (this._companionPatchInstalled) {
      await this.bridge.sendCommand('cmode = !1');
    }
    this._emitStatus();
  }

  /**
   * Run device setup after firmware upload + reboot (retries patch detection while booting).
   */
  async afterFirmwareFlash() {
    this._postFlashSetupPending = true;
    this.log('status', 'Waiting for Pip-Boy to reboot...');
    this._deviceReady = false;
    this._companionPatchInstalled = false;
    this.syncEngine.setEnabled(false);

    try {
      await this.bridge.awaitReconnectAfterReboot(90000);
      this.log('status', 'Pip-Boy reconnected after reboot');
    } catch (err) {
      this.log('warn', `${err.message} — will retry setup if already connected`);
    }

    try {
      await this._queueDeviceSetup({ afterFlash: true, skipSyncPause: true });
    } finally {
      this._postFlashSetupPending = false;
    }
    this._emitStatus();
  }

  _queueDeviceSetup(options = {}) {
    this._deviceSetupChain = (this._deviceSetupChain || Promise.resolve())
      .then(() => this._handleDeviceConnected(options))
      .catch((err) => {
        this.log('warn', `Device setup failed: ${err.message}`);
      });
    return this._deviceSetupChain;
  }

  async _requestInventoryResync() {
    if (this._inventoryResyncPending || !this.pipeClient.connected || !this.syncEngine.enabled) {
      return;
    }
    this._inventoryResyncPending = true;
    try {
      this.log('status', 'Requesting inventory sync from game...');
      this.syncEngine.forceFullSync();
      const snap = this.pipeClient.lastSnapshot;
      if (snap) {
        await this.syncEngine.processSnapshot(snap);
        return;
      }
      await this.pipeClient.reconnect();
    } catch (err) {
      this.log('warn', `Could not refresh game pipe: ${err.message}`);
      const snap = this.pipeClient.lastSnapshot;
      if (snap) {
        this.syncEngine.forceFullSync();
        await this.syncEngine.processSnapshot(snap);
      }
    } finally {
      this._inventoryResyncPending = false;
    }
  }

  async _tryEnableSync(options = {}) {
    if (
      !this._companionPatchInstalled ||
      !this.bridge.connected ||
      !this.pipeClient.connected ||
      !this._deviceReady
    ) {
      return;
    }

    const runningGame = this.pipeClient.lastSnapshot?.game;
    if (this.syncEngine.gameMode && runningGame && this.syncEngine.gameMode !== runningGame) {
      const pipBoyLabel = this.syncEngine.gameMode === 'FNV' ? 'Fallout: New Vegas' : 'Fallout 3';
      const gameLabel = runningGame === 'FNV' ? 'Fallout: New Vegas' : 'Fallout 3';
      this.log('warn', `Game/Pip-Boy mode mismatch: Pip-Boy is in ${pipBoyLabel} mode, but game is ${gameLabel}. Sync disabled.`);
      this.syncEngine.setEnabled(false);
      try {
        await this.bridge.sendCommand('cmode = !1');
      } catch (_) {}
      this._emitStatus();
      return;
    }

    if (!this.syncEngine.enabled) {
      this.syncEngine.setEnabled(true);
      await this.bridge.sendCommand('cmode = !0');
    }

    if (options.requestResync || this.syncEngine.isInventorySyncPaused()) {
      await this._requestInventoryResync();
      return;
    }

    this.syncEngine.requestWeaponAmmoRefresh();
    const snap = this.pipeClient.lastSnapshot;
    if (snap) {
      await this.syncEngine.processSnapshot(snap);
    }
  }

  _wireEvents() {
    this.bridge.on('status', (msg) => this.log('status', msg));
    this.bridge.on('connected', (port) => {
      this.log('status', `Pip-Boy connected on ${port}`);
      if (this._postFlashSetupPending) return;
      this._queueDeviceSetup();
    });
    this.bridge.on('disconnected', () => {
      this.log('warn', 'Pip-Boy disconnected');
      this._deviceReady = false;
      this._companionPatchInstalled = false;
      this.syncEngine.setEnabled(false);
      if (!this.options.game) {
        this.syncEngine.clearGameMode();
      }
      this._emitStatus();
    });
    this.bridge.on('error', (err) => this.log('error', `Serial: ${err.message}`));
    this.bridge.on('command-sent', (cmd) => {
      if (cmd.startsWith('(()=>{var f=require') && cmd.includes('PRESYNC')) return;
      this.log('cmd', cmd);
    });
    this.bridge.on('data', (text) => {
      const sanitized = String(text)
        .replace(/\r/g, '')
        .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
      if (!sanitized.trim()) return;

      const lines = sanitized.split(/\n/).filter((l) => l.trim());
      for (const line of lines) {
        if (line.includes('PIPSYNC:')) continue;
        if (line === '>' || line === '=>') continue;
        if (/^(true|false)\x04?$/.test(line.trim())) continue;
        const cleaned = line
          .replace(/\r/g, '')
          .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
          .trim();
        if (!cleaned || cleaned === '[J') continue;
        if (this.bridge._firmwareUploadInProgress) {
          if (
            /ERROR:|Ctrl-C|CALLBACK|Execution Interrupted|New interpreter error|^\s*\^/.test(
              line
            )
          ) {
            continue;
          }
        }
        this.log('device', cleaned);
      }
    });

    this.bridge.on('device-event', async (evt) => {
      if (evt.action === 'restore') {
        await this.syncEngine.notifyPresyncRestored();
        this.log('sync', 'Pre-sync data restored on Pip-Boy (companion was disconnected)');
        return;
      }

      const runningGame = this.pipeClient.lastSnapshot?.game;
      if (this.syncEngine.gameMode && runningGame && this.syncEngine.gameMode !== runningGame) {
        return;
      }

      if (evt.action === 'torch') {
        if (!this.syncEngine.handleDeviceTorch(evt.state)) {
          this.log('sync', 'Pip-Boy flashlight toggle ignored (flashlight sync disabled)');
          return;
        }
        if (this.pipeClient.connected) {
          this.pipeClient.send(evt.state ? 'TORCH ON' : 'TORCH OFF');
          this.log('sync', `Pip-Boy → game: flashlight ${evt.state ? 'on' : 'off'}`);
        } else if (this._companionPatchInstalled) {
          this.log('warn', 'Pip-Boy flashlight toggle ignored (game not connected)');
        }
        return;
      }

      const gameMode = this.syncEngine.gameMode || 'FNV';
      const gameFormId = this.mapper.resolveToGame(evt.formId, gameMode);
      const pipeFormId = formatGameFormId(gameFormId);

      if (evt.action === 'use') {
        this.syncEngine.notifyDeviceConsumed(pipeFormId);
      }
      // Give the device a command-free window so audio timer callbacks aren't
      // blocked by incoming serial commands while a sound is playing.
      if (evt.action === 'equip' || evt.action === 'unequip' || evt.action === 'use') {
        this.bridge.guardAudio();
      }
      // notifyDeviceEquipped/Unequipped are intentionally not called here:
      // the plugin always counts both worn and bagged copies of a form together,
      // so equipping/unequipping never causes a net count change in the snapshot.
      // Storing a pending credit would falsely suppress legitimate subsequent
      // drops of the unequipped copy (the "remainder" after a split-stack equip).

      if (this.pipeClient.connected) {
        let pipeCmd = `${evt.action.toUpperCase()} ${pipeFormId}`;
        // Carry the selected condition so the game equips the exact stack
        // instance (otherwise the engine equips its default highest-condition one).
        if (
          evt.action === 'equip' &&
          evt.condition !== undefined &&
          Number.isFinite(evt.condition)
        ) {
          pipeCmd += ` ${evt.condition}`;
        }
        this.pipeClient.send(pipeCmd);
        if (pipeFormId.toLowerCase() !== String(evt.formId).toLowerCase()) {
          this.log('sync', `Pip-Boy → game: ${evt.action} ${evt.category} ${evt.formId} → ${pipeFormId}`);
        } else {
          this.log('sync', `Pip-Boy → game: ${evt.action} ${evt.category} ${pipeFormId}`);
        }
      } else if (this._companionPatchInstalled) {
        this.log('warn', `Pip-Boy ${evt.action} ${evt.category} ${gameFormId} ignored (game not connected)`);
      }
    });

    this.syncEngine.on('status', (msg) => this.log('status', msg));
    this.syncEngine.on('syncing', ({ commandCount }) => {
      this.log('sync', `Sending ${commandCount} update(s)...`);
    });
    this.syncEngine.on('synced', ({ commandCount }) => {
      this.log('sync', `${commandCount} command(s) sent`);
      this._emitStatus();
    });
    this.syncEngine.on('initial-sync-complete', () => {
      if (this._initialSyncHintShown) return;
      this._initialSyncHintShown = true;
      this.log('status', PRESYNC_RESTORE_HINT);
      this.emit('initial-sync-complete', { message: PRESYNC_RESTORE_HINT });
    });
    // Lock the game (disable controls + "please wait" pop-up) while the heavy
    // initial sync runs, then release it. No-op if the game isn't connected.
    this.syncEngine.on('initial-sync-start', () => {
      if (this.pipeClient.connected) this.pipeClient.send('SYNC_LOCK');
    });
    this.syncEngine.on('initial-sync-end', () => {
      if (this.pipeClient.connected) this.pipeClient.send('SYNC_UNLOCK');
    });
    this.syncEngine.on('flushed', () => this.log('sync', 'Flushed to Pip-Boy SD card'));
    this.syncEngine.on('warning', (msg) => this.log('warn', msg));
    this.syncEngine.on('error', (err) => this.log('error', `Sync: ${err.message}`));
    this.syncEngine.on('game-mode-changed', () => this._emitStatus());

    this.pipeClient.on('status', (msg) => this.log('status', msg));
    this.pipeClient.on('connected', async () => {
      if (!this._deviceReady || !this._companionPatchInstalled) return;
      await this._tryEnableSync();
      this._emitStatus();
    });
    this.pipeClient.on('disconnected', async () => {
      this.log('warn', 'Game connection lost');
      this.syncEngine.setEnabled(false);
      if (this.bridge.connected && this._companionPatchInstalled) {
        try {
          await this.bridge.sendCommand('cmode = !1');
        } catch (_) {}
      }
      this._emitStatus();
    });
    this.pipeClient.on('main-menu', () => {
      this.log('status', 'Game returned to main menu');
      this.syncEngine.setEnabled(false);
      if (!this.options.game) {
        this.syncEngine.clearGameMode();
      }
      this._emitStatus();
    });
    this.pipeClient.on('save-load', () => {
      this.syncEngine.handleSaveLoad();
    });
    this.pipeClient.on('snapshot', (snapshot) => {
      this.syncEngine.processSnapshot(snapshot);
    });
    this.pipeClient.on('error', (err) => {
      if (err.code !== 'ENOENT') {
        this.log('error', `Pipe: ${err.message}`);
      }
    });
  }

  async start() {
    if (this._started) return;
    this._started = true;
    this._wireEvents();

    await this.mapper.load();

    if (this.options.game) {
      this.syncEngine.setGameMode(this.options.game.toUpperCase());
      this.log('status', `Game mode: ${this.options.game.toUpperCase()}`);
    }

    this.log('status', 'Searching for Pip-Boy 3000...');
    try {
      await this.bridge.connect(this.options.port || undefined);
      if (this._deviceSetupChain) {
        await this._deviceSetupChain;
      }
    } catch (err) {
      this.log('warn', `Auto-connect failed: ${err.message}`);
    }

    if (!this.options.noGame) {
      this.pipeClient.connect();
    } else {
      this.log('status', 'Running without game connection');
    }

    this._emitStatus();
  }

  async stop() {
    this.syncEngine.setEnabled(false);
    if (this.bridge.connected) {
      try {
        if (this._companionPatchInstalled) {
          await this.bridge.sendCommand('cmode = !1');
        }
        await this.bridge.sendCommand('player.sync()');
      } catch (_) {}
      await this.bridge.disconnect();
    }
    this.pipeClient.disconnect();
    this._started = false;
    this._emitStatus();
  }
}

export default CompanionApp;
