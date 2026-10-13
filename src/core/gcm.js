const NO_TIMEOUT = 0;
const VERSION_NUMBER = /\d+(\.\d+)+/;

/**
 * Talks to Git Credential Manager, the helper that stores GitHub sign-ins.
 *
 * The app only asks which accounts are signed in and starts a sign-in. The sign-in
 * itself happens in the credential manager's own window and browser, so passwords
 * and tokens never pass through this app.
 */
export function createGcm(git) {
  // Asked once: the version cannot change while the app runs.
  let version = null;

  async function readVersion() {
    try {
      const result = await git(['credential-manager', '--version']);
      return result.code === 0 ? (VERSION_NUMBER.exec(result.stdout)?.[0] ?? null) : null;
    } catch {
      return null;
    }
  }

  return {
    async getStatus() {
      try {
        const result = await git(['credential-manager', 'github', 'list']);
        if (result.code !== 0) return unavailable();

        version ??= readVersion();
        return { available: true, accounts: nonEmptyLines(result.stdout), version: await version };
      } catch {
        return unavailable();
      }
    },

    /** Answers `{ ok: true }`, or `{ ok: false, detail }` with the credential manager's own last words, if any. */
    async signIn(username) {
      // A person is signing in, so there is no sensible time limit.
      const result = await git(['credential-manager', 'github', 'login', '--username', username], {
        timeout: NO_TIMEOUT,
      });
      if (result.code === 0) return { ok: true };
      return { ok: false, detail: nonEmptyLines(result.stderr).at(-1) ?? null };
    },
  };
}

function unavailable() {
  return { available: false, accounts: [], version: null };
}

function nonEmptyLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
