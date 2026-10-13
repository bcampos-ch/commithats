import { message } from './messages.js';

const EXIT_KEY_NOT_FOUND = 5;
const EXIT_NO_MATCH = 1;
const FIELDS_PER_ENTRY = 3;

/**
 * Git could not do what the app asked. `problem` is the message (see messages.js)
 * to show the person; the text of the error itself is for the log.
 */
export class ProjectError extends Error {
  constructor(code, text, problem) {
    super(text);
    this.name = 'ProjectError';
    this.code = code;
    this.problem = problem;
  }
}

/**
 * Parses `git config --list --show-scope --show-origin --null`, where every entry is
 * `<scope> NUL <origin> NUL <key> LF <value> NUL`. The null separators keep values
 * that contain line breaks or tabs intact.
 */
export function parseConfigList(output) {
  const fields = output.split('\0');
  const entries = [];
  for (let index = 0; index + FIELDS_PER_ENTRY - 1 < fields.length; index += FIELDS_PER_ENTRY) {
    const [key, ...valueLines] = fields[index + 2].split('\n');
    entries.push({
      scope: fields[index],
      origin: fields[index + 1],
      key: normalizeKey(key),
      value: valueLines.join('\n'),
    });
  }
  return entries;
}

/**
 * Reads the configuration git resolves inside a project as a map of key to
 * `{ value, scope, origin }`. Later entries win, exactly as git applies them.
 * Returns null when git cannot read it, for example outside a repository.
 */
export async function readConfig(git, projectPath, { localOnly = false } = {}) {
  const scopeArgs = localOnly ? ['--local'] : [];
  const result = await git([
    '-C',
    projectPath,
    'config',
    ...scopeArgs,
    '--list',
    '--show-scope',
    '--show-origin',
    '--null',
  ]);
  if (result.code !== 0) return null;

  const config = new Map();
  for (const { key, ...entry } of parseConfigList(result.stdout)) config.set(key, entry);
  return config;
}

export async function setLocal(git, projectPath, key, value) {
  // The `--` keeps a value such as "--global" from being read as an option.
  const result = await git(['-C', projectPath, 'config', '--local', '--replace-all', '--', key, value]);
  if (result.code !== 0) throw gitFailed(`write ${key}`, result);
}

export async function unsetLocal(git, projectPath, key) {
  const result = await git(['-C', projectPath, 'config', '--local', '--unset-all', '--', key]);
  if (result.code !== 0 && result.code !== EXIT_KEY_NOT_FOUND) throw gitFailed(`remove ${key}`, result);
}

export async function removeLocalSection(git, projectPath, section) {
  const result = await git(['-C', projectPath, 'config', '--local', '--remove-section', section]);
  if (result.code !== 0) throw gitFailed(`remove the ${section} section`, result);
}

/** Writes a key in a standalone config file, creating the file if needed. */
export async function setInFile(git, filePath, key, value) {
  const result = await git(['config', '--file', filePath, '--replace-all', '--', key, value]);
  if (result.code !== 0) throw gitFailed(`write ${key}`, result);
}

/** Lists the global entries whose key matches `pattern`, as `{ key, value }` in file order. */
export async function findGlobal(git, pattern) {
  const result = await git(['config', '--global', '--null', '--get-regexp', pattern]);
  if (result.code === EXIT_NO_MATCH) return [];
  if (result.code !== 0) throw gitFailed('read the global config', result);

  return result.stdout
    .split('\0')
    .filter((entry) => entry !== '')
    .map((entry) => {
      const [key, ...valueLines] = entry.split('\n');
      return { key, value: valueLines.join('\n') };
    });
}

/** Appends a value to the global config. A new section goes at the end of the file. */
export async function addGlobal(git, key, value) {
  const result = await git(['config', '--global', '--add', '--', key, value]);
  if (result.code !== 0) throw gitFailed('write to the global config', result);
}

/** Removes one exact value of a global key and leaves any other value of that key alone. */
export async function removeGlobalValue(git, key, value) {
  const result = await git(['config', '--global', '--fixed-value', '--unset', '--', key, value]);
  if (result.code !== 0 && result.code !== EXIT_KEY_NOT_FOUND) throw gitFailed('update the global config', result);
}

/**
 * The SSH command the person configured for themselves, or null when they have none.
 * Looking at one scope at a time skips included files, so a command that only comes
 * from one of the app's own rules is not mistaken for theirs.
 */
export async function readOwnSshCommand(git) {
  for (const scope of ['--global', '--system']) {
    const result = await git(['config', scope, '--get', 'core.sshCommand']);
    if (result.code === 0) return result.stdout.replace(/\r?\n$/, '');
  }
  return null;
}

/** Git lowercases section and variable names but keeps the subsection (a remote name, a URL) as written. */
export function normalizeKey(key) {
  const first = key.indexOf('.');
  const last = key.lastIndexOf('.');
  if (first === -1) return key.toLowerCase();
  if (first === last) return key.toLowerCase();
  return `${key.slice(0, first).toLowerCase()}${key.slice(first, last)}${key.slice(last).toLowerCase()}`;
}

// Git's own last words are passed on as they are: they name the file or the key at fault.
function gitFailed(action, result) {
  const detail = result.stderr.trim().split('\n').at(-1) || `exit code ${result.code}`;
  return new ProjectError('GIT_FAILED', `Git could not ${action}: ${detail}`, message('git.failed', { detail }));
}
