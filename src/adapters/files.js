import { access, mkdir, rm } from 'node:fs/promises';

/** The few file-system operations the app needs outside of git. */
export function createFiles() {
  return {
    async exists(target) {
      try {
        await access(target);
        return true;
      } catch {
        return false;
      }
    },

    async ensureDir(directory) {
      await mkdir(directory, { recursive: true });
    },

    async remove(file) {
      await rm(file, { force: true });
    },
  };
}
