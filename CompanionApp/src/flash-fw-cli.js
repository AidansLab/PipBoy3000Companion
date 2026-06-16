#!/usr/bin/env node
/**
 * CLI entry point for firmware upload (also used by npm run flash-fw).
 */

import { SerialBridge } from './serial-bridge.js';
import { flashFirmware } from './flash-fw.js';

const bridge = new SerialBridge();

try {
  await bridge.connect();
  await flashFirmware(bridge, {
    log: (level, message) => console.log(`[${level}] ${message}`),
  });
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (bridge.connected) {
    await bridge.disconnect();
  }
}
