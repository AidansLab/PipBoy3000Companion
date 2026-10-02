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
 * pipe-client.js
 * 
 * Client for the FOSE/NVSE game plugin's sync connection. The game plugin
 * listens on a loopback TCP port (127.0.0.1 only) and writes JSON snapshots
 * of the player's current state. This client reads those snapshots and emits
 * them for the sync engine to process.
 *
 * TCP rather than a Windows named pipe so the app can also run natively on
 * Linux while the game runs under Wine/Proton: Wine maps Winsock onto real
 * host sockets, but a Wine named pipe is only visible inside its own prefix.
 * The port can be overridden with the PIPBOY_SYNC_PORT environment variable
 * (set the same value for the game, e.g. in Steam launch options).
 * 
 * Auto-reconnects if the game is restarted or the connection is broken.
 */

import { EventEmitter } from 'events';
import net from 'net';

const SYNC_HOST = '127.0.0.1';
const DEFAULT_SYNC_PORT = 30101; // must match SYNC_PORT_DEFAULT in the plugins
const RECONNECT_DELAY_MS = 3000;
const MAX_BUFFER_SIZE = 1024 * 1024; // 1MB max buffer

function syncPortFromEnv() {
  const p = parseInt(process.env.PIPBOY_SYNC_PORT, 10);
  return p > 0 && p < 65536 ? p : 0;
}

export class PipeClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = options.host || SYNC_HOST;
    this.port = options.port || syncPortFromEnv() || DEFAULT_SYNC_PORT;
    this.client = null;
    this.connected = false;
    this.autoReconnect = options.autoReconnect !== false;
    this.buffer = '';
    this._reconnectTimer = null;
    this._destroyed = false;
    this.lastSnapshot = null;
  }

  /**
   * Connect to the game plugin's sync port
   */
  connect() {
    if (this._destroyed) return;

    this.emit('status', `Connecting to game: ${this.host}:${this.port}`);

    this.client = net.createConnection({ host: this.host, port: this.port }, () => {
      // Snapshots/commands are small - send them now, not after Nagle's delay
      this.client.setNoDelay(true);
      this.connected = true;
      this.buffer = '';
      this.emit('connected');
      this.emit('status', 'Connected to Fallout game plugin');
    });

    this.client.on('data', (data) => {
      this._handleData(data);
    });

    this.client.on('end', () => {
      this.connected = false;
      this.emit('disconnected');
      this._scheduleReconnect();
    });

    this.client.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        // Nothing listening yet - game isn't running
        this.emit('status', 'Game not detected. Waiting for Fallout to start...');
      } else if (err.code !== 'ECONNRESET' || !this.connected) {
        // (A reset while connected is just the game closing - reported below.)
        this.emit('error', err);
      }

      const wasConnected = this.connected;
      this.connected = false;
      if (wasConnected) this.emit('disconnected');
      this._scheduleReconnect();
    });

    this.client.on('close', () => {
      this.connected = false;
    });
  }

  /**
   * Handle incoming data from the pipe
   * Messages are newline-delimited JSON
   */
  _handleData(data) {
    this.buffer += data.toString('utf8');

    // Guard against runaway buffer
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.emit('warning', 'Buffer overflow - clearing');
      this.buffer = '';
      return;
    }

    // Process complete JSON messages (newline-delimited)
    let newlineIdx;
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.substring(0, newlineIdx).trim();
      this.buffer = this.buffer.substring(newlineIdx + 1);

      if (line.length === 0) continue;

      try {
        const msg = JSON.parse(line);
        if (msg.event === 'saveLoad') {
          this.lastSnapshot = null;
          this.emit('save-load', msg);
          continue;
        }
        if (msg.event === 'mainMenu') {
          this.lastSnapshot = null;
          this.emit('main-menu', msg);
          continue;
        }
        this.lastSnapshot = msg;
        this.emit('snapshot', msg);
      } catch (err) {
        this.emit('warning', `Invalid JSON from game: ${err.message}`);
      }
    }
  }

  /**
   * Send a command line to the game plugin (the connection is duplex).
   * Used to mirror Pip-Boy-initiated actions (use/equip items) in-game.
   * @param {string} line - e.g. "USE 0x0001519e"
   * @returns {boolean} true if the line was written
   */
  send(line) {
    if (!this.connected || !this.client || this.client.destroyed) {
      return false;
    }
    this.client.write(line.endsWith('\n') ? line : line + '\n');
    return true;
  }

  /**
   * Drop and re-open the connection so the game plugin pushes a fresh snapshot
   * (it only writes when the snapshot changes or the client reconnects).
   */
  async reconnect() {
    if (this._destroyed) return;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this.client) {
      this.client.removeAllListeners();
      this.client.destroy();
      this.client = null;
    }

    this.connected = false;
    this.buffer = '';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener('connected', onConnected);
        reject(new Error('Game reconnect timed out'));
      }, 15000);

      const onConnected = () => {
        clearTimeout(timer);
        resolve();
      };

      this.once('connected', onConnected);
      this.connect();
    });
  }

  /**
   * Schedule a reconnection attempt
   */
  _scheduleReconnect() {
    if (this._reconnectTimer || this._destroyed || !this.autoReconnect) return;

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (!this._destroyed) {
        this.connect();
      }
    }, RECONNECT_DELAY_MS);
  }

  /**
   * Disconnect and stop reconnection attempts
   */
  disconnect() {
    this._destroyed = true;
    this.autoReconnect = false;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this.client) {
      this.client.destroy();
      this.client = null;
    }

    this.connected = false;
  }

  /**
   * Check if the game plugin is listening (game is running)
   */
  async isPipeAvailable() {
    return new Promise((resolve) => {
      const testClient = net.createConnection({ host: this.host, port: this.port }, () => {
        testClient.destroy();
        resolve(true);
      });
      testClient.on('error', () => {
        resolve(false);
      });
    });
  }
}

export default PipeClient;
