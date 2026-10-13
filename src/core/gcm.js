const NO_TIMEOUT = 0;

/**
 * Talks to Git Credential Manager, the helper that stores GitHub sign-ins.
 *
 * The app only asks which accounts are signed in and starts a sign-in. The sign-in
 * itself happens in the credential manager's own window and browser, so passwords
 * and tokens never pass through this app.
 */
export function createGcm(git) {
  return {
    async getStatus() {
      try {
        const result = await git(['credential-manager', 'github', 'list']);
        if (result.code !== 0) return unavailable();
        return { available: true, accounts: nonEmptyLines(result.stdout) };
      } catch {
        return unavailable();
      }
    },

    async signIn(username) {
      // A person is signing in, so there is no sensible time limit.
      const result = await git(['credential-manager', 'github', 'login', '--username', username], {
        timeout: NO_TIMEOUT,
      });
      if (result.code === 0) return { ok: true };
      return { ok: false, message: nonEmptyLines(result.stderr).at(-1) ?? 'The sign-in was closed before it finished.' };
    },
  };
}

function unavailable() {
  return { available: false, accounts: [] };
}

function nonEmptyLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
