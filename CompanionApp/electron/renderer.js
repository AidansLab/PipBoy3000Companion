const consoleEl = document.getElementById('console');
const clearBtn = document.getElementById('clearBtn');
const flashBtn = document.getElementById('flashBtn');
const pipStatus = document.getElementById('pipStatus');
const gameStatus = document.getElementById('gameStatus');
const modeStatus = document.getElementById('modeStatus');

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

  setStatusItem(
    pipStatus,
    `Pip-Boy · ${status.pipBoyConnected ? 'Connected' : 'Disconnected'}`,
    status.pipBoyConnected ? 'ok' : 'err'
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
}

clearBtn.addEventListener('click', () => {
  consoleEl.innerHTML = '';
  lineCount = 0;
});

flashBtn.addEventListener('click', async () => {
  flashBtn.disabled = true;
  appendLog({ level: 'info', message: 'Starting firmware upload...' });
  try {
    await window.pipboyApi.flashFirmware();
  } catch (err) {
    appendLog({ level: 'error', message: `Firmware upload failed: ${err.message}` });
  } finally {
    const status = await window.pipboyApi.getStatus();
    renderStatus(status);
  }
});

window.pipboyApi.onLog(appendLog);
window.pipboyApi.onStatus(renderStatus);

window.pipboyApi.getStatus().then(renderStatus);
