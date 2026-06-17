const consoleEl = document.getElementById('console');
const clearBtn = document.getElementById('clearBtn');
const flashBtn = document.getElementById('flashBtn');
const pipStatus = document.getElementById('pipStatus');
const gameStatus = document.getElementById('gameStatus');
const modeStatus = document.getElementById('modeStatus');
const torchSyncToggle = document.getElementById('torchSyncToggle');

const TORCH_SYNC_PREF_KEY = 'torchSyncEnabled';

// Defaults to on; only off when the user explicitly stored false.
function getTorchSyncPref() {
  return localStorage.getItem(TORCH_SYNC_PREF_KEY) !== 'false';
}

const MAX_LINES = 2000;
let lineCount = 0;

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, '');
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
    `Mode · ${status.gameMode || '—'}`,
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

// Apply the saved preference on startup, pushing it to the sync engine so the
// engine's default matches what the UI shows.
torchSyncToggle.checked = getTorchSyncPref();
window.pipboyApi
  .setTorchSync(torchSyncToggle.checked)
  .then(renderStatus)
  .catch(() => {});

window.pipboyApi.getStatus().then(renderStatus);
