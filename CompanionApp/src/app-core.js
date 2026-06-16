/**
 * app-core.js
 *
 * Shared companion application logic used by the CLI and Electron UI.
 */

import { EventEmitter } from 'events';
import { SerialBridge } from './serial-bridge.js';
import { SyncEngine } from './sync-engine.js';
import { PipeClient } from './pipe-client.js';
import { FormIdMapper } from './form-id-mapper.js';

export const PRESYNC_RESTORE_HINT =
  'To restore pre-sync data, disconnect the companion app, then go to Settings>User>Restore pre-sync data';

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
  }

  log(level, message) {
    this.emit('log', { level, message, time: new Date() });
  }

  getStatus() {
    return {
      pipBoyConnected: this.bridge.connected,
      gameConnected: this.pipeClient.connected,
      syncEnabled: this.syncEngine.enabled,
      gameMode: this.syncEngine.gameMode,
      stats: this.syncEngine.getStats(),
      mapper: this.mapper.getStats(),
    };
  }

  _emitStatus() {
    this.emit('status', this.getStatus());
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

  async _handleDeviceConnected() {
    this._deviceReady = false;
    this.syncEngine.setEnabled(false);
    if (!this.options.game) {
      await this.autoDetectGameMode();
    }
    this._deviceReady = true;
    if (this.pipeClient.connected) {
      await this._tryEnableSync();
    } else {
      await this.bridge.sendCommand('cmode = !1');
    }
    this._emitStatus();
  }

  async _tryEnableSync() {
    if (!this.bridge.connected || !this.pipeClient.connected || !this._deviceReady) {
      return;
    }
    this.syncEngine.setEnabled(true);
    await this.bridge.sendCommand('cmode = !0');
  }

  _wireEvents() {
    this.bridge.on('status', (msg) => this.log('status', msg));
    this.bridge.on('connected', (port) => {
      this.log('status', `Pip-Boy connected on ${port}`);
      this._deviceSetupChain = this._handleDeviceConnected();
    });
    this.bridge.on('disconnected', () => {
      this.log('warn', 'Pip-Boy disconnected');
      this._deviceReady = false;
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
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      for (const line of lines) {
        if (line.includes('PIPSYNC:')) continue;
        if (line === '>' || line === '=>') continue;
        if (/^(true|false)\x04?$/.test(line.trim())) continue;
        this.log('device', line);
      }
    });

    this.bridge.on('device-event', async (evt) => {
      if (evt.action === 'restore') {
        await this.syncEngine.notifyPresyncRestored();
        this.log('sync', 'Pre-sync data restored on Pip-Boy (companion was disconnected)');
        return;
      }

      const gameMode = this.syncEngine.gameMode || 'FNV';
      const gameFormId = this.mapper.resolveToGame(evt.formId, gameMode);

      if (evt.action === 'use') {
        this.syncEngine.notifyDeviceConsumed(gameFormId);
      }

      if (this.pipeClient.connected) {
        this.pipeClient.send(`${evt.action.toUpperCase()} ${gameFormId}`);
        this.log('sync', `Pip-Boy → game: ${evt.action} ${evt.category} ${gameFormId}`);
      } else {
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
    this.syncEngine.on('flushed', () => this.log('sync', 'Flushed to Pip-Boy SD card'));
    this.syncEngine.on('warning', (msg) => this.log('warn', msg));
    this.syncEngine.on('error', (err) => this.log('error', `Sync: ${err.message}`));
    this.syncEngine.on('game-mode-changed', () => this._emitStatus());

    this.pipeClient.on('status', (msg) => this.log('status', msg));
    this.pipeClient.on('connected', async () => {
      this.log('status', 'Connected to Fallout game plugin');
      await this._tryEnableSync();
      this._emitStatus();
    });
    this.pipeClient.on('disconnected', () => {
      this.log('warn', 'Game connection lost');
      this.syncEngine.setEnabled(false);
      if (this.bridge.connected) {
        this.bridge.sendCommand('cmode = !1');
      }
      this._emitStatus();
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
