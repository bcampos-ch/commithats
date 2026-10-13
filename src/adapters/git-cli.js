import { execFile } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export class GitCliError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'GitCliError';
    this.code = code;
  }
}

/**
 * Creates a function that runs git without a shell, so arguments are never interpreted.
 *
 * It resolves with the exit code instead of rejecting on non-zero exits: for git a
 * non-zero exit is often an answer ("this key is not set"), not a failure. It only
 * rejects when git could not be run or did not finish.
 */
export function createGitCli({ env = process.env, executable = 'git' } = {}) {
  return function git(args, { timeout = DEFAULT_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      const options = { env, timeout, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, encoding: 'utf8' };
      execFile(executable, args, options, (error, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout, stderr });
        } else if (typeof error.code === 'number') {
          resolve({ code: error.code, stdout, stderr });
        } else {
          reject(toGitCliError(error));
        }
      });
    });
  };
}

function toGitCliError(error) {
  if (error.code === 'ENOENT') {
    return new GitCliError('GIT_NOT_FOUND', 'Git was not found on this computer.', { cause: error });
  }
  if (error.killed) {
    return new GitCliError('GIT_TIMEOUT', 'Git took too long to answer.', { cause: error });
  }
  return new GitCliError('GIT_FAILED', error.message, { cause: error });
}
