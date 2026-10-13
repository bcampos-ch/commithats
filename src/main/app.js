import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFiles } from '../adapters/files.js';
import { createGitCli } from '../adapters/git-cli.js';
import { createJsonStore } from '../adapters/json-store.js';
import { createSshKeygen } from '../adapters/ssh-keygen.js';
import { createAppService } from '../core/app-service.js';
import { createGcm } from '../core/gcm.js';
import { registerIpc } from './ipc.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_ENTRY = path.join(here, '..', 'renderer', 'index.html');
const PRELOAD_SCRIPT = path.join(here, 'preload.cjs');
const STATE_FILE = 'state.json';
const ACCOUNT_FILES_DIR = 'accounts';

/**
 * Boots the app and resolves once the window has loaded.
 *
 * The options let a smoke run point the app at throwaway data, a throwaway SSH
 * folder and a stand-in credential manager. `npm start` uses the defaults: the
 * real git, the real Git Credential Manager and `~/.ssh`.
 */
export async function startApp({
  userDataDir = process.env.GIT_ACCOUNT_SWITCHER_DATA_DIR,
  git = createGitCli({ env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }),
  gcm = createGcm(git),
  keygen = createSshKeygen(),
  sshDir = path.join(os.homedir(), '.ssh'),
  show = true,
} = {}) {
  // Must run before the first await: Electron reads these settings when it becomes ready.
  if (userDataDir) app.setPath('userData', path.resolve(userDataDir));
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return null;
  }

  const userData = app.getPath('userData');
  const service = createAppService({
    git,
    gcm,
    keygen,
    sshDir,
    store: createJsonStore(path.join(userData, STATE_FILE)),
    files: createFiles(),
    includeDir: path.join(userData, ACCOUNT_FILES_DIR),
    homeDir: os.homedir(),
  });

  let mainWindow = null;

  async function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1080,
      height: 720,
      minWidth: 860,
      minHeight: 560,
      show: false,
      autoHideMenuBar: true,
      title: 'Git Account Switcher',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1216' : '#f5f6f8',
      webPreferences: {
        preload: PRELOAD_SCRIPT,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        // A window that is hidden on purpose (a smoke run) must keep painting to be captured.
        backgroundThrottling: show,
      },
    });

    // The window only ever shows the bundled page.
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    mainWindow.once('ready-to-show', () => {
      if (show) mainWindow.show();
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    await mainWindow.loadFile(RENDERER_ENTRY);
    return mainWindow;
  }

  registerIpc({ ipcMain, dialog, clipboard, service, getWindow: () => mainWindow, homeDir: os.homedir() });

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  await app.whenReady();
  return { window: await createWindow(), service };
}
