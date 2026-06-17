/**
 * Electron main process — runs sync engine + serial I/O, exposes IPC to UI.
 */

import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { CompanionApp, PRESYNC_RESTORE_HINT } from '../src/app-core.js';
import { flashFirmware } from '../src/flash-fw.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconPath = path.join(__dirname, '..', 'build', 'icon.png');

let mainWindow = null;
let companion = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 614,
    height: 410,
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
