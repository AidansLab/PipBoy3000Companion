#!/usr/bin/env node
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
