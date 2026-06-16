/**
 * Stop a running packaged build and clear the output folder before rebuilding.
 * Avoids electron-builder failing when app.asar is locked by a prior instance.
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

function removeDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

tryExec('taskkill /F /IM "Pip-Boy Sync.exe" /T');

// Give Windows a moment to release file handles.
const waitUntil = Date.now() + 500;
while (Date.now() < waitUntil) {
  // busy wait
}

try {
  removeDir(outputDir);
} catch (err) {
  console.warn(`[prebuild] Could not remove ${outputDir}: ${err.message}`);
  console.warn('[prebuild] Close any running Pip-Boy Sync window and retry.');
  process.exit(1);
}
