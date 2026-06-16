/**
 * serial-bridge.js
 * 
 * Manages the USB serial connection to The Wand Company's Pip-Boy 3000.
 * The Pip-Boy runs Espruino (JavaScript on an STM32 microcontroller) and exposes
 * a REPL over USB serial. We send JavaScript commands directly to the device.
 * 
 * Key behaviors:
 * - Auto-detects the Pip-Boy's COM port by scanning available serial ports
 * - Queues commands with rate limiting (~50ms spacing) to avoid overwhelming the REPL
 * - Prefixes commands with \x10 to suppress echo
 * - Supports eval-style reads for getting data back from the device
 */

import { SerialPort } from 'serialport';
import { EventEmitter } from 'events';

// Known USB identifiers for the Pip-Boy 3000 (Espruino STM32-based)
// The Pip-Boy uses an STM32F4 chip which typically shows as an STMicroelectronics VCP
const KNOWN_VENDORS = [
  '0483', // STMicroelectronics
];

const KNOWN_PRODUCTS = [
  '5740', // STM32 Virtual COM Port
];

const DEFAULT_BAUD_RATE = 9600;
const COMMAND_SPACING_MS = 50;       // Min time between commands
const RESPONSE_TIMEOUT_MS = 3000;    // Timeout waiting for eval response
const RECONNECT_DELAY_MS = 5000;     // Delay before reconnection attempt

export class SerialBridge extends EventEmitter {
  constructor(options = {}) {
    super();
    this.baudRate = options.baudRate || DEFAULT_BAUD_RATE;
    this.comPort = options.comPort || null; // null = auto-detect
    this.port = null;
    this.connected = false;
    this._ioMutex = Promise.resolve();
    this.lastCommandTime = 0;
    this.responseBuffer = '';
    this.pendingEval = null;
    this.autoReconnect = options.autoReconnect !== false;
    this._reconnectTimer = null;
    this._lineBuffer = '';

    // File Protocol State
    this.pendingPacketAck = null;
    this.packetTimeout = null;
  }

  /**
   * Scan all serial ports and return those that look like a Pip-Boy
   */
  static async detectPipBoyPorts() {
    const ports = await SerialPort.list();
    const candidates = ports.filter(port => {
      const vendorMatch = KNOWN_VENDORS.includes(port.vendorId?.toLowerCase());
      const productMatch = KNOWN_PRODUCTS.includes(port.productId?.toLowerCase());
      // Also match by manufacturer string if available
      const mfgMatch = port.manufacturer?.toLowerCase().includes('stmicroelectronics') ||
        port.manufacturer?.toLowerCase().includes('espruino');
      return vendorMatch || productMatch || mfgMatch;
    });
    return candidates;
  }

  /**
   * List all available serial ports (for manual selection)
   */
  static async listPorts() {
    return await SerialPort.list();
  }

  /**
   * Connect to the Pip-Boy
   * @param {string} [comPort] - Optional COM port override, otherwise auto-detects
   */
  async connect(comPort) {
    const targetPort = comPort || this.comPort;

    if (targetPort) {
      // Use specified port
      return this._openPort(targetPort);
    }

    // Auto-detect
    this.emit('status', 'Scanning for Pip-Boy 3000...');
    const candidates = await SerialBridge.detectPipBoyPorts();

    if (candidates.length === 0) {
      // Fall back to listing all ports for the user
      const allPorts = await SerialPort.list();
      if (allPorts.length === 0) {
        throw new Error('No serial ports found. Is the Pip-Boy connected via USB?');
      }
      this.emit('ports-found', allPorts);
      throw new Error(
        `No Pip-Boy auto-detected. Available ports: ${allPorts.map(p => p.path).join(', ')}. ` +
        'Use --port <COM#> to specify manually.'
      );
    }

    if (candidates.length === 1) {
      this.emit('status', `Found Pip-Boy on ${candidates[0].path}`);
      return this._openPort(candidates[0].path);
    }

    // Multiple candidates — use the first one but warn
    this.emit('status', `Multiple candidates found, using ${candidates[0].path}`);
    this.emit('ports-found', candidates);
    return this._openPort(candidates[0].path);
  }

  /**
   * Open a serial port connection
   */
  async _openPort(path) {
    return new Promise((resolve, reject) => {
      this.port = new SerialPort({
        path,
        baudRate: this.baudRate,
        autoOpen: false,
      });

      this.port.on('open', () => {
        this.connected = true;
        this.comPort = path;
        this.emit('connected', path);
        this.emit('status', `Connected to ${path} at ${this.baudRate} baud`);
        resolve();
      });

      this.port.on('data', (data) => {
        this._handleData(data);
      });

      this.port.on('error', (err) => {
        this.emit('error', err);
        if (!this.connected) {
          reject(err);
        }
      });

      this.port.on('close', () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.emit('disconnected');

        if (wasConnected && this.autoReconnect) {
          this.emit('status', `Disconnected. Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
          this._scheduleReconnect();
        }
      });

      this.port.open((err) => {
        if (err) {
          reject(new Error(`Failed to open ${path}: ${err.message}`));
        }
      });
    });
  }

  /**
   * Handle incoming serial data
   */
  _handleData(data) {
    // Intercept binary ACK (0x06) and NAK (0x15) for file protocol
    if (this.pendingPacketAck) {
      for (let i = 0; i < data.length; i++) {
        const byte = data[i];
        if (byte === 0x06) { // ACK
          const { resolve } = this.pendingPacketAck;
          if (this.packetTimeout) clearTimeout(this.packetTimeout);
          this.pendingPacketAck = null;
          this.packetTimeout = null;
          resolve();
        } else if (byte === 0x15) { // NAK
          const { reject } = this.pendingPacketAck;
          if (this.packetTimeout) clearTimeout(this.packetTimeout);
          this.pendingPacketAck = null;
          this.packetTimeout = null;
          reject(new Error('Device sent NAK'));
        }
      }
    }

    const text = data.toString('utf8');
    this.responseBuffer += text;

    // If we have a pending eval, check for the response marker
    if (this.pendingEval) {
      const markerIdx = this.responseBuffer.indexOf('\x04');
      if (markerIdx !== -1) {
        const response = this.responseBuffer.substring(0, markerIdx).trim();
        const leftover = this.responseBuffer.substring(markerIdx + 1);
        this.responseBuffer = '';
        const { resolve } = this.pendingEval;
        this.pendingEval = null;
        resolve(response);
        if (leftover) {
          this._scanDeviceEvents(leftover);
          this.emit('data', leftover);
        }
        return;
      }
      // Suppress partial eval output from the device console
      return;
    }

    this.emit('data', text);
    this._scanDeviceEvents(text);
  }

  /**
   * Scan device console output for PIPSYNC event markers.
   * The Pip-Boy firmware emits lines like:
   *   PIPSYNC:USE:AID:0001519E
   *   PIPSYNC:EQUIP:WEAPONS:0000434F
   *   PIPSYNC:UNEQUIP:APPAREL:000340C8
   * when the user uses/equips an item on the device. These are emitted as
   * 'device-event' so the app can mirror the action in-game.
   */
  _scanDeviceEvents(text) {
    this._lineBuffer += text;

    // Only complete lines are parsed; keep the trailing partial line buffered
    let newlineIdx;
    while ((newlineIdx = this._lineBuffer.indexOf('\n')) !== -1) {
      const line = this._lineBuffer.substring(0, newlineIdx);
      this._lineBuffer = this._lineBuffer.substring(newlineIdx + 1);

      const match = line.match(/PIPSYNC:(USE|EQUIP|UNEQUIP):([A-Z]+):([0-9A-Fa-f]{1,8})/);
      if (match) {
        this.emit('device-event', {
          action: match[1].toLowerCase(),                       // 'use' | 'equip' | 'unequip'
          category: match[2],                                   // 'AID' | 'APPAREL' | 'WEAPONS'
          formId: '0x' + match[3].toLowerCase().padStart(8, '0'),
        });
        continue;
      }

      if (line.includes('PIPSYNC:RESTORE:PRESYNC')) {
        this.emit('device-event', { action: 'restore', category: 'presync' });
      }
    }

    // Guard against a device spewing data with no newlines
    if (this._lineBuffer.length > 4096) {
      this._lineBuffer = this._lineBuffer.slice(-1024);
    }
  }

  /**
   * Serialize all USB REPL traffic so eval() and sendCommand() never interleave.
   */
  _runSerialIO(fn) {
    const run = this._ioMutex.then(async () => {
      if (!this.connected) {
        throw new Error('Not connected');
      }
      const elapsed = Date.now() - this.lastCommandTime;
      if (elapsed < COMMAND_SPACING_MS) {
        await this._sleep(COMMAND_SPACING_MS - elapsed);
      }
      const result = await fn();
      this.lastCommandTime = Date.now();
      return result;
    });
    this._ioMutex = run.catch(() => {});
    return run;
  }

  /**
   * Send a raw JavaScript command to the Pip-Boy REPL
   */
  sendCommand(command) {
    return this._runSerialIO(async () => {
      await this._writeRaw(`\x10${command}\n`);
      this.emit('command-sent', command);
    });
  }

  /**
   * Send a command and wait for a response (like UART.eval)
   */
  eval(expression) {
    return this._runSerialIO(() => new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pendingEval) {
          this.pendingEval = null;
          reject(new Error(`Eval timeout for: ${expression}`));
        }
      }, RESPONSE_TIMEOUT_MS);

      this.pendingEval = {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timeoutId);
          reject(err);
        },
      };

      this.responseBuffer = '';
      const wrappedCmd = `\x10print(JSON.stringify(${expression})+"\\x04")\n`;
      this._writeRaw(wrappedCmd).catch((err) => {
        if (this.pendingEval) {
          this.pendingEval.reject(err);
          this.pendingEval = null;
        }
      });
    }));
  }

  /**
   * Write raw bytes to the serial port
   */
  _writeRaw(data) {
    return new Promise((resolve, reject) => {
      if (!this.port || !this.connected) {
        reject(new Error('Not connected'));
        return;
      }
      this.port.write(data, (err) => {
        if (err) {
          reject(err);
        } else {
          this.port.drain(resolve);
        }
      });
    });
  }

  /**
   * Send multiple commands in sequence (batched)
   * @param {string[]} commands - Array of JavaScript commands
   */
  async sendBatch(commands) {
    for (const cmd of commands) {
      await this.sendCommand(cmd);
    }
  }

  /**
   * Parse a boolean from an eval response. The REPL may prefix boot noise.
   */
  _parseEvalBool(result) {
    const trimmed = result.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;

    const matches = [...trimmed.matchAll(/\b(true|false)\b/g)];
    if (matches.length > 0) {
      return matches[matches.length - 1][1] === 'true';
    }

    throw new Error(`Unexpected eval response: ${JSON.stringify(trimmed.slice(0, 120))}`);
  }

  /**
   * True when the companion .boot0 patch is loaded (global cmode exists).
   * @param {{ maxAttempts?: number, intervalMs?: number }} [options]
   */
  async hasCompanionPatch(options = {}) {
    const maxAttempts = options.maxAttempts ?? 1;
    const intervalMs = options.intervalMs ?? 1000;
    let lastErr = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt === 1) {
        await this._sleep(250);
      } else {
        await this._sleep(intervalMs);
      }
      try {
        const result = await this.eval("typeof cmode!=='undefined'");
        return this._parseEvalBool(result);
      } catch (err) {
        lastErr = err;
      }
    }

    throw new Error(`Could not verify companion patch: ${lastErr?.message || 'unknown error'}`);
  }

  /**
   * Wait for a one-time bridge event.
   */
  waitForEvent(event, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener(event, handler);
        reject(new Error(`Timeout waiting for ${event}`));
      }, timeoutMs);
      const handler = (...args) => {
        clearTimeout(timer);
        resolve(args);
      };
      this.once(event, handler);
    });
  }

  async waitForDisconnect(timeoutMs = 15000) {
    if (!this.connected) return;
    await this.waitForEvent('disconnected', timeoutMs);
  }

  async waitForConnected(timeoutMs = 60000) {
    if (this.connected) return;
    await this.waitForEvent('connected', timeoutMs);
  }

  /**
   * Close the serial port without disabling auto-reconnect.
   */
  async closePortKeepAutoReconnect() {
    if (this.port && this.port.isOpen) {
      return new Promise((resolve) => {
        this.port.close(() => {
          this.connected = false;
          resolve();
        });
      });
    }
  }

  /**
   * After E.reboot(), wait for USB disconnect then reconnect.
   */
  async awaitReconnectAfterReboot(totalTimeoutMs = 90000) {
    const start = Date.now();
    try {
      await this.waitForDisconnect(Math.min(15000, totalTimeoutMs));
    } catch (_) {
      await this.closePortKeepAutoReconnect();
    }
    const remaining = totalTimeoutMs - (Date.now() - start);
    if (remaining <= 0) {
      throw new Error('Timed out waiting for Pip-Boy to reconnect after reboot');
    }
    await this.waitForConnected(remaining);
  }

  /**
   * Auto-detect which game mode the Pip-Boy is currently in.
   * Reads Pip.settings.nv from DEVICE.JSON (the NV script variable is let-scoped
   * and is not visible to the USB REPL).
   *
   * @returns {Promise<'FNV'|'F3'>} The detected game mode
   */
  async detectGameMode() {
    await this._sleep(250);

    const expressions = [
      '!!(Pip.settings&&Pip.settings.nv)',
      '!!Pip.settings.nv',
    ];

    let lastErr = null;
    for (const expression of expressions) {
      try {
        const result = await this.eval(expression);
        const isNV = this._parseEvalBool(result);
        return isNV ? 'FNV' : 'F3';
      } catch (err) {
        lastErr = err;
      }
    }

    throw new Error(`Failed to detect game mode: ${lastErr?.message || 'unknown error'}`);
  }

  /**
   * Disconnect from the Pip-Boy
   */
  async disconnect() {
    this.autoReconnect = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this.port && this.port.isOpen) {
      return new Promise((resolve) => {
        this.port.close(() => {
          this.connected = false;
          resolve();
        });
      });
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      try {
        await this.connect();
      } catch (err) {
        this.emit('status', `Reconnect failed: ${err.message}`);
        if (this.autoReconnect) {
          this._scheduleReconnect();
        }
      }
    }, RECONNECT_DELAY_MS);
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ESPRUINO FILE PROTOCOL IMPLEMENTATION
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Send a packet using Espruino file protocol
   * @param {string} pkType - One of: FILE_SEND, DATA
   * @param {string|Buffer} payload - The packet data
   * @param {object} options - {noACK, timeout}
   * @returns {Promise<void>}
   */
  async espruinoSendPacket(pkType, payload, options = {}) {
    const timeout = options.timeout || 5000;

    const PKTYPES = {
      RESPONSE: 0,
      EVAL: 0x2000,
      EVENT: 0x4000,
      FILE_SEND: 0x6000,
      DATA: 0x8000,
      FILE_RECV: 0xA000
    };

    if (!(pkType in PKTYPES)) throw new Error(`Unknown packet type: ${pkType}`);

    const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
    if (payloadBuffer.length > 0x1FFF) throw new Error('Packet data too long');

    const flags = payloadBuffer.length | PKTYPES[pkType];
    const header = Buffer.from([16, 1, (flags >> 8) & 0xFF, flags & 0xFF]); // DLE, SOH, flags high, flags low
    const packet = Buffer.concat([header, payloadBuffer]);

    return new Promise((resolve, reject) => {
      if (!options.noACK) {
        this.pendingPacketAck = { resolve, reject };
        this.packetTimeout = setTimeout(() => {
          this.pendingPacketAck = null;
          this.packetTimeout = null;
          reject(new Error(`Packet timeout (${timeout}ms)`));
        }, timeout);
      }

      this._writeRaw(packet).then(() => {
        if (options.noACK) {
          resolve();
        }
      }).catch(err => {
        if (this.packetTimeout) clearTimeout(this.packetTimeout);
        this.pendingPacketAck = null;
        this.packetTimeout = null;
        reject(err);
      });
    });
  }

  /**
   * Send a file using Espruino file protocol
   * @param {string} filename - Target filename
   * @param {string|Buffer} content - File contents
   * @param {object} options - {fs: true/false, progress: fn, chunkSize, noACK}
   * @returns {Promise<void>}
   */
  async espruinoSendFile(filename, content, options = {}) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const CHUNK = options.chunkSize || 1024;
    const progressHandler = options.progress || (() => { });
    const packetTimeout = options.timeout || 8000;
    const packetOptions = { noACK: !!options.noACK, timeout: packetTimeout };

    const fileSendOptions = {
      fn: filename,
      s: buffer.length
    };
    if (options.fs) {
      fileSendOptions.fs = 1;
    }

    const packetTotal = Math.ceil(buffer.length / CHUNK) + 1;
    let packetCount = 0;

    progressHandler({ chunk: 0, totalChunks: packetTotal, bytes: buffer.length });

    // Send FILE_SEND packet (always wait for ACK)
    await this.espruinoSendPacket('FILE_SEND', JSON.stringify(fileSendOptions), {
      timeout: packetTimeout,
    });

    // Send DATA packets
    let offset = 0;
    while (offset < buffer.length) {
      const chunk = buffer.subarray(offset, offset + CHUNK);
      offset += chunk.length;
      packetCount++;

      progressHandler({ chunk: packetCount, totalChunks: packetTotal, bytes: buffer.length });
      await this.espruinoSendPacket('DATA', chunk, packetOptions);
    }
  }
}

export default SerialBridge;
