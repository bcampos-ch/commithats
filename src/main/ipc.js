import path from 'node:path';
import { GitCliError } from '../adapters/git-cli.js';
import { message } from '../core/messages.js';
import { abbreviateHome } from '../core/paths.js';
import { createTranslator } from '../i18n/translator.js';

const MAX_CLIPBOARD_LENGTH = 16_384;

/**
 * Exposes the app service to the window, one channel per use case.
 * Native dialogs and the clipboard live here because only the main process can reach them.
 *
 * `appInfo` is what the window may know about the running app, and `onSettingsChanged`
 * is told the settings every time they are saved.
 */
export function registerIpc({ ipcMain, dialog, clipboard, service, getWindow, homeDir, appInfo, onSettingsChanged }) {
  function handle(channel, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (event.sender !== getWindow()?.webContents) {
        return { ok: false, error: message('error.untrustedSender') };
      }
      try {
        return await handler(...args);
      } catch (error) {
        console.error(`[${channel}]`, error);
        return { ok: false, error: describe(error) };
      }
    });
  }

  // Native dialogs are drawn outside the page, so their words are chosen here.
  const translator = async () => createTranslator((await service.getSettings()).language);

  handle('state:get', async () => ({ ok: true, snapshot: await service.getSnapshot() }));
  handle('app:info', () => ({ ok: true, info: appInfo }));

  handle('settings:save', async (change) => {
    const result = await service.saveSettings(change);
    if (result.ok) onSettingsChanged(result.settings);
    return result;
  });

  handle('accounts:save', (draft) => service.saveAccount(draft));
  handle('accounts:remove', (accountId) => service.removeAccount(accountId));
  handle('accounts:sign-in', (accountId) => service.signIn(accountId));
  handle('accounts:pick-ssh-key', async () => {
    const t = await translator();
    const result = await dialog.showOpenDialog(getWindow(), {
      title: t('dialog.pickSshKey.title'),
      defaultPath: path.join(homeDir, '.ssh'),
      properties: ['openFile', 'showHiddenFiles', 'dontAddToRecent'],
    });
    return { ok: true, path: result.canceled ? null : (result.filePaths[0] ?? null) };
  });
  handle('accounts:generate-ssh-key', (draft) => service.generateSshKey(draft));
  handle('accounts:read-public-key', (keyPath) => service.readPublicKey(keyPath));

  // Choosing and adding are separate steps so the page can ask for confirmation in between.
  handle('folders:pick', async () => {
    const t = await translator();
    const result = await dialog.showOpenDialog(getWindow(), {
      title: t('dialog.pickFolder.title'),
      buttonLabel: t('dialog.pickFolder.button'),
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
    const t = await translator();
    const result = await dialog.showOpenDialog(getWindow(), {
      title: t('dialog.addProjects.title'),
      buttonLabel: t('dialog.addProjects.button'),
      properties: ['openDirectory', 'multiSelections', 'dontAddToRecent'],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: true, cancelled: true };
    return service.addProjects(result.filePaths);
  });
  handle('projects:remove', (projectPath) => service.removeProject(projectPath));
  handle('projects:move', (projectPath, index) => service.moveProject(projectPath, index));
  handle('projects:assign', (projectPath, accountId) => service.assignProject(projectPath, accountId ?? null));

  handle('clipboard:write', (value) => {
    clipboard.writeText(String(value ?? '').slice(0, MAX_CLIPBOARD_LENGTH));
    return { ok: true };
  });
}

// The window gets a message it can show; the full error stays in the main process log.
function describe(error) {
  if (error instanceof GitCliError && error.code === 'GIT_NOT_FOUND') return message('error.gitNotFound');
  if (error instanceof GitCliError && error.code === 'GIT_TIMEOUT') return message('error.gitTimeout');
  return message('error.generic');
}
