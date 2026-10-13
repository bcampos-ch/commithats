import path from 'node:path';
import { GitCliError } from '../adapters/git-cli.js';
import { abbreviateHome } from '../core/paths.js';

const MAX_CLIPBOARD_LENGTH = 16_384;

/**
 * Exposes the app service to the window, one channel per use case.
 * Native dialogs and the clipboard live here because only the main process can reach them.
 */
export function registerIpc({ ipcMain, dialog, clipboard, service, getWindow, homeDir }) {
  function handle(channel, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (event.sender !== getWindow()?.webContents) {
        return { ok: false, error: 'This request did not come from the app window.' };
      }
      try {
        return await handler(...args);
      } catch (error) {
        console.error(`[${channel}]`, error);
        return { ok: false, error: describe(error) };
      }
    });
  }

  handle('state:get', async () => ({ ok: true, snapshot: await service.getSnapshot() }));

  handle('accounts:save', (draft) => service.saveAccount(draft));
  handle('accounts:remove', (accountId) => service.removeAccount(accountId));
  handle('accounts:sign-in', (accountId) => service.signIn(accountId));
  handle('accounts:pick-ssh-key', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Choose the SSH private key',
      defaultPath: path.join(homeDir, '.ssh'),
      properties: ['openFile', 'showHiddenFiles', 'dontAddToRecent'],
    });
    return { ok: true, path: result.canceled ? null : (result.filePaths[0] ?? null) };
  });
  handle('accounts:generate-ssh-key', (draft) => service.generateSshKey(draft));
  handle('accounts:read-public-key', (keyPath) => service.readPublicKey(keyPath));

  // Choosing and adding are separate steps so the page can ask for confirmation in between.
  handle('folders:pick', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Choose the folder this account is used in',
      buttonLabel: 'Choose',
      properties: ['openDirectory', 'dontAddToRecent'],
    });
    const folder = result.canceled ? null : (result.filePaths[0] ?? null);
    return { ok: true, path: folder, displayPath: folder === null ? null : abbreviateHome(folder, homeDir) };
  });
  handle('folders:add', (accountId, folderPath) => service.addFolderRule(accountId, folderPath));
  handle('folders:remove', (folderPath) => service.removeFolderRule(folderPath));

  handle('owners:add', (accountId, owner) => service.addOwnerRule(accountId, owner));
  handle('owners:remove', (owner) => service.removeOwnerRule(owner));

  handle('projects:add', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Add project folders',
      buttonLabel: 'Add',
      properties: ['openDirectory', 'multiSelections', 'dontAddToRecent'],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: true, cancelled: true };
    return service.addProjects(result.filePaths);
  });
  handle('projects:remove', (projectPath) => service.removeProject(projectPath));
  handle('projects:assign', (projectPath, accountId) => service.assignProject(projectPath, accountId ?? null));

  handle('clipboard:write', (value) => {
    clipboard.writeText(String(value ?? '').slice(0, MAX_CLIPBOARD_LENGTH));
    return { ok: true };
  });
}

// The window gets a sentence it can show; the full error stays in the main process log.
function describe(error) {
  if (error instanceof GitCliError && error.code === 'GIT_NOT_FOUND') {
    return 'Git was not found. Install Git, then restart the app.';
  }
  if (error instanceof GitCliError && error.code === 'GIT_TIMEOUT') {
    return 'Git took too long to answer. Try again.';
  }
  return 'Something went wrong. Try again.';
}
