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

const DEFAULT_BAUD_RATE = 19200;
const COMMAND_SPACING_MS = 25;       // Min time between commands
const AUDIO_GUARD_MS = 350;          // Hold commands after device equip/use so audio plays cleanly
const RESPONSE_TIMEOUT_MS = 3000;    // Timeout waiting for eval response
const RECONNECT_DELAY_MS = 5000;     // Delay before reconnection attempt
const PACKET_MAX_ATTEMPTS = 4;       // File-protocol packet: original send + up to 3 retries
const PACKET_RETRY_DELAY_MS = 200;   // Pause before resending a timed-out/NAK'd packet

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

    // Audio guard: commands are held back after a device-initiated equip/use
    // so the Espruino's single-threaded JS doesn't block audio timer callbacks.
    this._audioGuardUntil = 0;
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

    // Multiple candidates - use the first one but warn
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
   *   PIPSYNC:DROP:AMMO:0000434F:20
   *   PIPSYNC:TORCH:ON / PIPSYNC:TORCH:OFF
   * when the user uses/equips/drops an item on the device. These are emitted
   * as 'device-event' so the app can mirror the action in-game.
   */
  _scanDeviceEvents(text) {
    this._lineBuffer += text;

    // Only complete lines are parsed; keep the trailing partial line buffered
    let newlineIdx;
    while ((newlineIdx = this._lineBuffer.indexOf('\n')) !== -1) {
      const line = this._lineBuffer.substring(0, newlineIdx);
      this._lineBuffer = this._lineBuffer.substring(newlineIdx + 1);

      const match = line.match(
        /PIPSYNC:(USE|EQUIP|UNEQUIP|DROP):([A-Z]+):([0-9A-Fa-f]{1,8})(?::(\d{1,6}))?/
      );
      if (match) {
        const verb = match[1];
        this.emit('device-event', {
          action: verb.toLowerCase(),                           // 'use' | 'equip' | 'unequip' | 'drop'
          category: match[2],                                   // 'AID' | 'APPAREL' | 'WEAPONS' | ...
          formId: '0x' + match[3].toLowerCase().padStart(8, '0'),
          // EQUIP: optional condition (0–100) selecting a specific stack instance.
          condition: verb === 'EQUIP' && match[4] !== undefined ? parseInt(match[4], 10) : undefined,
          // DROP: how many units to drop.
          count: verb === 'DROP' && match[4] !== undefined ? parseInt(match[4], 10) : undefined,
        });
        continue;
      }

      const torchMatch = line.match(/PIPSYNC:TORCH:(ON|OFF)/);
      if (torchMatch) {
        this.emit('device-event', {
          action: 'torch',
          state: torchMatch[1] === 'ON',
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
   * Open a brief window during which regular (non-equip) commands are deferred,
   * letting audio timer callbacks run without the event loop being blocked by
   * JS command execution. Call this whenever the device triggers a sound.
   *
   * The guard is intentionally checked BEFORE enqueuing (in sendCommand), not
   * inside the mutex. That way equip confirmation commands (sendEquipCommand) can
   * jump straight to the front of an already-drained queue without waiting.
   */
  guardAudio() {
    this._audioGuardUntil = Date.now() + AUDIO_GUARD_MS;
  }

  /** True while the post-sound guard window is open (regular commands deferred). */
  isAudioGuardActive() {
    return this._audioGuardUntil - Date.now() > 0;
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
   * Send a raw JavaScript command to the Pip-Boy REPL.
   * Respects the audio guard - waits until the guard window expires before
   * joining the serial queue so the device is command-free during playback.
   */
  sendCommand(command) {
    // Pre-sleep outside the mutex so the equip fast-path can still jump the queue.
    const guardWait = this._audioGuardUntil - Date.now();
    const enqueue = guardWait > 0
      ? this._sleep(guardWait).then(() => this._runSerialIO(async () => {
          await this._writeRaw(`\x10${command}\n`);
          this.emit('command-sent', command);
        }))
      : this._runSerialIO(async () => {
          await this._writeRaw(`\x10${command}\n`);
          this.emit('command-sent', command);
        });
    return enqueue;
  }

  /**
   * Send a high-priority equip/unequip confirmation command.
   * Bypasses the audio guard so the split appears as soon as the game
   * round-trip completes (~200 ms) rather than waiting out the full guard.
   * Pre-click commands drain in ~100 ms (4–6 x 25 ms spacing), so the queue
   * is typically empty by the time the equip confirmation arrives.
   */
  sendEquipCommand(command) {
    return this._runSerialIO(async () => {
      await this._writeRaw(`\x10${command}\n`);
      this.emit('command-sent', command);
    });
  }

  /**
   * Send a command and wait for a response (like UART.eval)
   */
  eval(expression, timeoutMs = RESPONSE_TIMEOUT_MS) {
    return this._runSerialIO(() => new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pendingEval) {
          this.pendingEval = null;
          reject(new Error(`Eval timeout for: ${expression}`));
        }
      }, timeoutMs);

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
   * CRC32 of a file's bytes computed ON the device (E.CRC32 - standard
   * zlib polynomial, native and fast), so verifying an upload costs one
   * small eval round-trip instead of streaming the whole file back over
   * serial. Storage reads are memory-mapped flat strings (near-free);
   * SD (fs) files are read whole, which is fine at this firmware's sizes
   * (largest file ~16KB) on a freshly reset() device.
   * Returns null if the file doesn't exist on the device.
   * @param {string} deviceName
   * @param {{ fs?: boolean, timeout?: number }} [options] fs:true for SD files
   * @returns {Promise<number|null>} unsigned 32-bit CRC, or null
   */
  async getFileCRC32(deviceName, options = {}) {
    const name = JSON.stringify(deviceName);
    const expr = options.fs
      ? `(()=>{try{var s=require('fs').readFileSync(${name});return s===undefined?null:E.CRC32(s)}catch(e){return null}})()`
      : `(()=>{var s=require('Storage').read(${name});return s===undefined?null:E.CRC32(s)})()`;
    const raw = await this.eval(expr, options.timeout);
    try {
      return JSON.parse(raw.trim());
    } catch (_) {
      // The REPL may prefix boot noise - take the last number/null token.
      const matches = [...String(raw).matchAll(/\b(\d+|null)\b/g)];
      if (matches.length === 0) {
        throw new Error(`Unexpected CRC32 response: ${JSON.stringify(String(raw).slice(0, 120))}`);
      }
      const last = matches[matches.length - 1][1];
      return last === 'null' ? null : parseInt(last, 10);
    }
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
   * Send an ordered list of commands as few USB writes as possible.
   *
   * Each command is framed exactly as sendCommand frames it - `\x10${cmd}\n` -
   * so the device parses and executes each line identically to the per-command
   * path; the ONLY difference is that we concatenate the framed lines and write
   * them together, eliminating the COMMAND_SPACING_MS gap between every command.
   * Because each line keeps its own \x10 prefix and trailing newline, the device
   * still executes them as independent REPL lines (an error in one line does not
   * abort the rest), and the firmware's internal try/catch blocks keep failures
   * contained.
   *
   * Lines are packed into chunks no larger than maxBytes so a single write never
   * floods the device's USB RX ring buffer; each chunk passes through
   * _runSerialIO, so spacing is paid once per chunk instead of once per command.
   *
   * Ordering is preserved exactly. Callers that need the audio-guard / equip
   * bypass semantics must check isAudioGuardActive() first; this method is meant
   * for the common case where the guard is closed and every command may flow
   * immediately.
   */
  async sendBatch(commands, { maxBytes = 512 } = {}) {
    if (!commands || commands.length === 0) return;

    // Honor the audio guard once for the whole batch (defensive - callers
    // normally only batch when the guard is closed).
    const guardWait = this._audioGuardUntil - Date.now();
    if (guardWait > 0) await this._sleep(guardWait);

    let chunk = '';
    let chunkCmds = [];
    const flush = async () => {
      if (!chunk) return;
      const data = chunk;
      const sent = chunkCmds;
      chunk = '';
      chunkCmds = [];
      await this._runSerialIO(() => this._writeRaw(data));
      for (const c of sent) this.emit('command-sent', c);
    };

    for (const cmd of commands) {
      const line = `\x10${cmd}\n`;
      // Flush before exceeding the cap, but always allow at least one line per
      // chunk even if a single command is longer than maxBytes.
      if (chunk && chunk.length + line.length > maxBytes) {
        await flush();
      }
      chunk += line;
      chunkCmds.push(cmd);
    }
    await flush();
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

    const sendOnce = () => new Promise((resolve, reject) => {
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

    // The device ACKs/NAKs per packet with no sequence numbers, so a lost ACK
    // and a lost packet look identical from here - retrying risks the device
    // having already applied a packet whose ACK just didn't make it back.
    // That's a real but narrow window (one packet's worth of bytes on an
    // otherwise-open connection); failing the whole upload on every transient
    // drop is the more common and more visible failure mode, so we retry.
    let lastErr;
    for (let attempt = 1; attempt <= PACKET_MAX_ATTEMPTS; attempt++) {
      try {
        return await sendOnce();
      } catch (err) {
        lastErr = err;
        if (attempt < PACKET_MAX_ATTEMPTS) {
          this.emit('status', `File-transfer packet failed (${err.message}), retrying ${attempt}/${PACKET_MAX_ATTEMPTS - 1}...`);
          await this._sleep(PACKET_RETRY_DELAY_MS);
        }
      }
    }
    throw new Error(`${lastErr.message} (after ${PACKET_MAX_ATTEMPTS} attempts)`);
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
