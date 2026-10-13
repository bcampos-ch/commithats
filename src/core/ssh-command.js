const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** What git runs when nothing says otherwise. */
export const DEFAULT_SSH_COMMAND = 'ssh';

/**
 * Builds the value for git's `core.sshCommand` that makes SSH use one specific private key.
 *
 * Git runs this value through a shell, so the key path is single-quoted: nothing inside
 * single quotes is interpreted, which keeps an odd path from turning into a command.
 * `IdentitiesOnly` stops SSH from offering other keys first, which would authenticate
 * as whichever account owns them.
 */
export function buildSshCommand(keyPath, { platform = process.platform } = {}) {
  if (typeof keyPath !== 'string' || keyPath.trim() === '' || CONTROL_CHARACTERS.test(keyPath)) {
    throw new TypeError('The SSH key path must be a non-empty path without control characters.');
  }

  const portablePath = platform === 'win32' ? keyPath.replaceAll('\\', '/') : keyPath;
  return `ssh -i ${quoteForShell(portablePath)} -o IdentitiesOnly=yes`;
}

/**
 * The SSH command an account stands for: its own key, or the baseline when it has none.
 *
 * An account always sets a command, even without a key. Git settings only add up, so
 * leaving it out would let the key of another account, set by a broader rule, leak in.
 * The baseline is the command the person already uses, or plain `ssh`.
 */
export function sshCommandFor(account, { platform = process.platform, baselineSshCommand = DEFAULT_SSH_COMMAND } = {}) {
  return account.sshKeyPath ? buildSshCommand(account.sshKeyPath, { platform }) : baselineSshCommand;
}

function quoteForShell(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
