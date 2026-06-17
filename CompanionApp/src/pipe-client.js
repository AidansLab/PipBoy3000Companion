/**
 * pipe-client.js
 * 
 * Windows Named Pipe client that connects to the FOSE/NVSE game plugin.
 * The game plugin creates a named pipe and writes JSON snapshots of the
 * player's current state. This client reads those snapshots and emits
 * them for the sync engine to process.
 * 
 * Auto-reconnects if the game is restarted or the pipe is broken.
 */

import { EventEmitter } from 'events';
import net from 'net';

const PIPE_NAME = '\\\\.\\pipe\\FalloutPipBoySync';
const RECONNECT_DELAY_MS = 3000;
const MAX_BUFFER_SIZE = 1024 * 1024; // 1MB max buffer

export class PipeClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.pipeName = options.pipeName || PIPE_NAME;
    this.client = null;
    this.connected = false;
    this.autoReconnect = options.autoReconnect !== false;
    this.buffer = '';
    this._reconnectTimer = null;
    this._destroyed = false;
    this.lastSnapshot = null;
  }

  /**
   * Connect to the game plugin's named pipe
   */
  connect() {
    if (this._destroyed) return;

    this.emit('status', `Connecting to game pipe: ${this.pipeName}`);

    this.client = net.createConnection(this.pipeName, () => {
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
      if (err.code === 'ENOENT') {
        // Pipe doesn't exist yet — game isn't running
        this.emit('status', 'Game not detected. Waiting for Fallout to start...');
      } else {
        this.emit('error', err);
      }

      this.connected = false;
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
      this.emit('warning', 'Buffer overflow — clearing');
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
          this.emit('save-load', msg);
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
   * Send a command line to the game plugin (pipe is duplex).
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
   * Drop and re-open the pipe so the game plugin pushes a fresh snapshot
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
        reject(new Error('Game pipe reconnect timed out'));
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
   * Check if the pipe is available (game is running)
   */
  async isPipeAvailable() {
    return new Promise((resolve) => {
      const testClient = net.createConnection(this.pipeName, () => {
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
