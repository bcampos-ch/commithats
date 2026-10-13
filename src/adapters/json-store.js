import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CURRENT_VERSION = 1;

const emptyState = () => ({ version: CURRENT_VERSION, accounts: [], projects: [] });

/**
 * Persists the app's own data (account profiles and tracked project paths) as JSON.
 * It never holds passwords or tokens: those stay in the credential manager.
 */
export function createJsonStore(filePath) {
  return {
    async load() {
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
    },

    async save(state) {
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(normalize(state), null, 2)}\n`, 'utf8');
      await rename(temporaryPath, filePath);
    },
  };
}

function normalize(data) {
  if (data === null || typeof data !== 'object') throw new TypeError('State must be an object.');
  return {
    version: CURRENT_VERSION,
    accounts: Array.isArray(data.accounts) ? data.accounts.filter(isAccountLike) : [],
    projects: Array.isArray(data.projects) ? data.projects.filter((entry) => typeof entry === 'string') : [],
  };
}

function isAccountLike(entry) {
  return entry !== null && typeof entry === 'object' && typeof entry.id === 'string';
}
