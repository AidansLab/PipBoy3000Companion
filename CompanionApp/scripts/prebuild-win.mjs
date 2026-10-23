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
 * Stop a running packaged build and clear the Windows build output before
 * rebuilding. Avoids electron-builder failing when app.asar is locked by a
 * prior instance. Only the Windows artifacts are removed, so a Linux build
 * (AppImage, linux-unpacked) sharing the release folder survives.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'release');

function tryExec(command) {
  try {
    execSync(command, { stdio: 'ignore' });
  } catch {
    // Process may not be running.
  }
}

tryExec('taskkill /F /IM "Pip-Boy_Sync.exe" /T');

// Give Windows a moment to release file handles.
const waitUntil = Date.now() + 500;
while (Date.now() < waitUntil) {
  // busy wait
}

const windowsOutputs = [
  'win-unpacked',
  'Pip-Boy_Sync.exe',
  'builder-debug.yml',
  'builder-effective-config.yaml',
];

try {
  for (const name of windowsOutputs) {
    const target = path.join(outputDir, name);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  }
} catch (err) {
  console.warn(`[prebuild] Could not clear Windows output in ${outputDir}: ${err.message}`);
  console.warn('[prebuild] Close any running Pip-Boy Sync window and retry.');
  process.exit(1);
}
