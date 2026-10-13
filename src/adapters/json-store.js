import { copyFile, mkdir, readFile, rename as renameFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { createQueue } from '../core/queue.js';

const CURRENT_VERSION = 1;
// What Windows answers when a file cannot be replaced because something has it open.
const HELD_BY_SOMETHING_ELSE = new Set(['EPERM', 'EBUSY', 'EACCES']);
const REPLACE_ATTEMPTS = 5;
const FIRST_RETRY_MS = 20;

const emptyState = () => ({ version: CURRENT_VERSION, accounts: [], projects: [], settings: {} });

/**
 * Persists the app's own data (account profiles, tracked project paths in the order
 * they are shown, and settings) as JSON. It never holds passwords or tokens: those
 * stay in the credential manager.
 *
 * Reads and saves take turns. On Windows a file cannot be replaced while it is open,
 * even for reading, so a read that overlapped a save would make the save fail.
 *
 * `rename` is how the finished file takes the place of the old one. It is only passed
 * in by tests, to stand in for a file that something else holds.
 */
export function createJsonStore(filePath, { rename = renameFile } = {}) {
  const inTurn = createQueue();

  // Another program can hold the file too, such as an antivirus looking at what was just
  // written. That passes in a moment, so the replace is tried again before giving up.
  async function replace(source, target) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rename(source, target);
        return;
      } catch (error) {
        if (attempt === REPLACE_ATTEMPTS || !HELD_BY_SOMETHING_ELSE.has(error.code)) throw error;
        await wait(FIRST_RETRY_MS * 2 ** (attempt - 1));
      }
    }
  }

  return {
    load: inTurn(async () => {
      let raw;
      try {
        raw = await readFile(filePath, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return emptyState();
        throw error;
      }

      try {
        return normalize(JSON.parse(raw));
      } catch {
        await copyFile(filePath, `${filePath}.damaged-${Date.now()}`);
        return emptyState();
      }
    }),

    // Written next to the real file and then swapped in, so a crash halfway never leaves half a file.
    save: inTurn(async (state) => {
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(normalize(state), null, 2)}\n`, 'utf8');
      await replace(temporaryPath, filePath);
    }),
  };
}

function normalize(data) {
  if (data === null || typeof data !== 'object') throw new TypeError('State must be an object.');
  return {
    version: CURRENT_VERSION,
    accounts: Array.isArray(data.accounts) ? data.accounts.filter(isAccountLike) : [],
    projects: Array.isArray(data.projects) ? data.projects.filter((entry) => typeof entry === 'string') : [],
    // Kept as written: the app decides which settings and values it understands.
    settings: isPlainObject(data.settings) ? { ...data.settings } : {},
  };
}

function isAccountLike(entry) {
  return entry !== null && typeof entry === 'object' && typeof entry.id === 'string';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
