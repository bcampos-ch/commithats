import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const TIMEOUT_MS = 15_000;
const NO_PASSPHRASE = '';
const PUBLIC_KEY =
  /^(ssh-(ed25519|rsa|dss)|ecdsa-sha2-nistp(256|384|521)|sk-(ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com) [A-Za-z0-9+/=]+( .*)?$/;

/**
 * Creates SSH keys with the system's ssh-keygen and reads their public half.
 *
 * Keys are created without a passphrase so the app never handles a secret.
 * A person who wants one adds it afterwards with `ssh-keygen -p -f <key>`.
 */
export function createSshKeygen({ env = process.env, executable = 'ssh-keygen' } = {}) {
  return {
    /** Creates `keyPath` and `keyPath.pub`. The caller makes sure neither exists yet. */
    generate({ keyPath, comment }) {
      return new Promise((resolve) => {
        const args = ['-t', 'ed25519', '-C', comment, '-f', keyPath, '-N', NO_PASSPHRASE, '-q'];
        const child = execFile(executable, args, { env, timeout: TIMEOUT_MS, windowsHide: true }, (error) => {
          if (!error) resolve({ ok: true });
          else if (error.code === 'ENOENT') resolve({ ok: false, reason: 'not-found' });
          else resolve({ ok: false, reason: 'failed' });
        });
        // If ssh-keygen ever asks a question, it gets "end of input" instead of waiting forever.
        child.stdin?.end();
      });
    },

    /** Returns the public key stored next to a private key, or null when there is none. */
    async readPublicKey(keyPath) {
      try {
        const content = (await readFile(`${keyPath}.pub`, 'utf8')).trim();
        return PUBLIC_KEY.test(content) ? content : null;
      } catch {
        return null;
      }
    },
  };
}
