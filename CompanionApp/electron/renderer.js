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

const consoleEl = document.getElementById('console');
const clearBtn = document.getElementById('clearBtn');
const flashBtn = document.getElementById('flashBtn');
const pipStatus = document.getElementById('pipStatus');
const gameStatus = document.getElementById('gameStatus');
const modeStatus = document.getElementById('modeStatus');
const torchSyncToggle = document.getElementById('torchSyncToggle');
const versionBadge = document.getElementById('versionBadge');

const TORCH_SYNC_PREF_KEY = 'torchSyncEnabled';

// Defaults to on; only off when the user explicitly stored false.
function getTorchSyncPref() {
  return localStorage.getItem(TORCH_SYNC_PREF_KEY) !== 'false';
}

const MAX_LINES = 2000;
let lineCount = 0;

function stripAnsi(text) {
  return String(text)
    .replace(/\r/g, '')
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1b\[[0-9;]*m/g, '');
}

function appendLog(entry) {
  const time = entry.time ? new Date(entry.time) : new Date();
  const stamp = time.toLocaleTimeString();
  const level = entry.level || 'info';
  const message = stripAnsi(entry.message || '');

  const line = document.createElement('div');
  line.className = `log-line log-${level}`;
  line.textContent = `[${stamp}] ${message}`;
  consoleEl.appendChild(line);
  lineCount++;

  while (lineCount > MAX_LINES) {
    consoleEl.removeChild(consoleEl.firstChild);
    lineCount--;
  }

  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function setStatusItem(el, label, state) {
  el.className = `status-item ${state || ''}`;
  el.querySelector('.status-label').textContent = label;
}

function applyTheme(gameMode) {
  if (gameMode === 'FNV') {
    document.documentElement.dataset.theme = 'fnv';
  } else if (gameMode === 'F3') {
    document.documentElement.dataset.theme = 'f3';
  } else {
    document.documentElement.dataset.theme = 'f3';
  }
}

function renderStatus(status) {
  if (!status) return;

  applyTheme(status.gameMode);

  let pipLabel = `Pip-Boy · ${status.pipBoyConnected ? 'Connected' : 'Disconnected'}`;
  if (status.pipBoyConnected && status.companionPatchInstalled === false) {
    pipLabel = 'Pip-Boy · Connected (patch required)';
  }
  setStatusItem(
    pipStatus,
    pipLabel,
    status.pipBoyConnected
      ? (status.companionPatchInstalled === false ? 'warn' : 'ok')
      : 'err'
  );
  setStatusItem(
    gameStatus,
    `Game · ${status.gameConnected ? 'Connected' : 'Disconnected'}`,
    status.gameConnected ? 'ok' : 'warn'
  );
  setStatusItem(
    modeStatus,
    `Mode · ${status.gameMode || '-'}`,
    status.gameMode ? 'ok' : 'warn'
  );

  flashBtn.disabled = !status.pipBoyConnected;

  if (typeof status.torchSyncEnabled === 'boolean') {
    torchSyncToggle.checked = status.torchSyncEnabled;
  }
}

clearBtn.addEventListener('click', () => {
  consoleEl.innerHTML = '';
  lineCount = 0;
});

flashBtn.addEventListener('click', async () => {
  flashBtn.disabled = true;
  appendLog({ level: 'info', message: 'Installing companion menus and .boot0 patch...' });
  try {
    await window.pipboyApi.flashFirmware();
  } catch (err) {
    appendLog({ level: 'error', message: `Firmware upload failed: ${err.message}` });
  } finally {
    const status = await window.pipboyApi.getStatus();
    renderStatus(status);
  }
});

torchSyncToggle.addEventListener('change', async () => {
  const enabled = torchSyncToggle.checked;
  localStorage.setItem(TORCH_SYNC_PREF_KEY, String(enabled));
  try {
    const status = await window.pipboyApi.setTorchSync(enabled);
    renderStatus(status);
  } catch (err) {
    appendLog({ level: 'error', message: `Failed to update flashlight sync: ${err.message}` });
  }
});

window.pipboyApi.onLog(appendLog);
window.pipboyApi.onStatus(renderStatus);

// Load and display version
window.pipboyApi.getVersion().then((version) => {
  versionBadge.textContent = `v${version}`;
}).catch(() => {
  versionBadge.textContent = 'unknown';
});

// Apply the saved preference on startup, pushing it to the sync engine so the
// engine's default matches what the UI shows.
torchSyncToggle.checked = getTorchSyncPref();
window.pipboyApi
  .setTorchSync(torchSyncToggle.checked)
  .then(renderStatus)
  .catch(() => {});

window.pipboyApi.getStatus().then(renderStatus);
