import { app, BrowserWindow, ipcMain, Menu, dialog, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'node:fs';
import { CompanionApp, PRESYNC_RESTORE_HINT } from '../src/app-core.js';
import { flashFirmware } from '../src/flash-fw.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
const stateFilePath = path.join(app.getPath('userData'), 'window-state.json');

let mainWindow = null;
let companion = null;

function loadWindowState() {
  try {
    if (fs.existsSync(stateFilePath)) {
      const data = fs.readFileSync(stateFilePath, 'utf8');
      const state = JSON.parse(data);
      if (typeof state.x === 'number' && typeof state.y === 'number') {
        const displays = screen.getAllDisplays();
        const isVisible = displays.some(display => {
          const bounds = display.bounds;
          return (
            state.x >= bounds.x &&
            state.x < bounds.x + bounds.width &&
            state.y >= bounds.y &&
            state.y < bounds.y + bounds.height
          );
        });
        if (isVisible) {
          return { x: state.x, y: state.y };
        }
      }
    }
  } catch (err) {
    console.error('Failed to load window state:', err);
  }
  return null;
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    if (!mainWindow.isMinimized() && !mainWindow.isMaximized()) {
      const bounds = mainWindow.getBounds();
      const state = { x: bounds.x, y: bounds.y };
      fs.writeFileSync(stateFilePath, JSON.stringify(state), 'utf8');
    }
  } catch (err) {
    console.error('Failed to save window state:', err);
  }
}

function createWindow() {
  const windowState = loadWindowState();

  mainWindow = new BrowserWindow({
    width: 614,
    height: 410,
    x: windowState ? windowState.x : undefined,
    y: windowState ? windowState.y : undefined,
    resizable: false,
    title: 'Pip-Boy 3000 Sync',
    icon: iconPath,
    backgroundColor: '#0a120a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('close', () => {
    saveWindowState();
  });
}

function forwardLog(entry) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', entry);
  }
}

function forwardStatus() {
  if (companion && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status', companion.getStatus());
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  companion = new CompanionApp({ noGame: false });
  companion.on('log', forwardLog);
  companion.on('status', forwardStatus);
  companion.on('initial-sync-complete', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Pre-sync Data Backed Up',
        message: PRESYNC_RESTORE_HINT,
      });
    }
  });

  createWindow();
  await companion.start();
  forwardStatus();
});

app.on('window-all-closed', async () => {
  if (companion) {
    await companion.stop();
    companion = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('get-status', () => companion?.getStatus() ?? null);

ipcMain.handle('set-torch-sync', (_event, enabled) => {
  if (!companion) {
    throw new Error('App not ready');
  }
  companion.setTorchSyncEnabled(!!enabled);
  return companion.getStatus();
});

ipcMain.handle('flash-firmware', async () => {
  if (!companion) {
    throw new Error('App not ready');
  }
  const logs = [];
  const result = await flashFirmware(companion.bridge, {
    syncEngine: companion.syncEngine,
    log: (level, message) => {
      const entry = { level, message, time: new Date() };
      logs.push(entry);
      forwardLog(entry);
    },
  });
  if (result.rebooted) {
    await companion.afterFirmwareFlash();
  }
  forwardStatus();
  return result;
});
