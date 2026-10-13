import path from 'node:path';
import { ProjectError, normalizeKey, readConfig, removeLocalSection, setLocal, unsetLocal } from './git-config.js';
import { message } from './messages.js';
import { parseRemoteUrl } from './remotes.js';
import { sshCommandFor } from './ssh-command.js';

/** The git settings that decide who a project commits and pushes as. */
export const KEYS = Object.freeze({
  authorName: 'user.name',
  authorEmail: 'user.email',
  pushAccount: 'credential.https://github.com.username',
  sshCommand: 'core.sshCommand',
});

const FALLBACK_PUSH_ACCOUNT = 'credential.username';
const IDENTITY_KEYS = [KEYS.authorName, KEYS.authorEmail, KEYS.pushAccount];

// The app keeps its own notes in the project config, next to the settings they describe.
const SECTION = 'accountswitcher';
const ASSIGNED_ACCOUNT = `${SECTION}.account`;
const OWNS_SSH_COMMAND = `${SECTION}.owns-ssh-command`;
const SAVED = Object.freeze({
  [KEYS.authorName]: `${SECTION}.saved-user-name`,
  [KEYS.authorEmail]: `${SECTION}.saved-user-email`,
  [KEYS.pushAccount]: `${SECTION}.saved-push-account`,
  [KEYS.sshCommand]: `${SECTION}.saved-ssh-command`,
});

const REMOTE_URL_KEY = /^remote\.(.+)\.url$/;

/** Returns the root folder of the repository that contains `folderPath`, or null outside one. */
export async function findRepositoryRoot(git, folderPath) {
  const result = await git(['-C', folderPath, 'rev-parse', '--show-toplevel']);
  if (result.code !== 0) return null;

  const root = result.stdout.replace(/\r?\n$/, '');
  return root === '' ? null : path.resolve(root);
}

/**
 * Reports who git would commit and push as inside a project, and which config scope
 * (this project, the global config, ...) each answer comes from.
 */
export async function inspectProject(git, projectPath) {
  const root = await findRepositoryRoot(git, projectPath);
  const config = root === null ? null : await readConfig(git, projectPath);
  if (config === null) return notARepository(projectPath);

  const assigned = read(config, ASSIGNED_ACCOUNT);
  return {
    path: projectPath,
    isRepo: true,
    author: { name: read(config, KEYS.authorName), email: read(config, KEYS.authorEmail) },
    pushAccount: read(config, KEYS.pushAccount) ?? read(config, FALLBACK_PUSH_ACCOUNT),
    sshCommand: read(config, KEYS.sshCommand),
    remotes: listRemotes(config),
    managedAccountId: assigned?.scope === 'local' ? assigned.value : null,
  };
}

/**
 * Makes a project commit and push as `account` by writing to the project's own config.
 * The global config is never written. Values the project already had are kept aside
 * the first time, so `clearAccount` can put them back.
 *
 * `sshOptions` are the options of `sshCommandFor`. The SSH command is always written,
 * even for an account without a key, so that no rule can change it for this project.
 */
export async function applyAccount(git, projectPath, account, sshOptions = {}) {
  const local = await requireLocalConfig(git, projectPath);

  if (read(local, ASSIGNED_ACCOUNT) === null) {
    for (const key of IDENTITY_KEYS) await keepAside(git, projectPath, local, key);
  }
  await setLocal(git, projectPath, KEYS.authorName, account.gitName);
  await setLocal(git, projectPath, KEYS.authorEmail, account.gitEmail);
  await setLocal(git, projectPath, KEYS.pushAccount, account.githubUser);

  // Tracked apart from the identity keys: older assignments left the SSH command alone.
  if (read(local, OWNS_SSH_COMMAND) === null) await keepAside(git, projectPath, local, KEYS.sshCommand);
  await setLocal(git, projectPath, KEYS.sshCommand, sshCommandFor(account, sshOptions));
  await setLocal(git, projectPath, OWNS_SSH_COMMAND, 'true');

  await setLocal(git, projectPath, ASSIGNED_ACCOUNT, account.id);
}

/**
 * Undoes `applyAccount`: removes what the app wrote and restores what was there before.
 * A project the app never managed is left exactly as it is.
 */
export async function clearAccount(git, projectPath) {
  const local = await requireLocalConfig(git, projectPath);
  if (read(local, ASSIGNED_ACCOUNT) === null) return;

  for (const key of IDENTITY_KEYS) await putBack(git, projectPath, local, key);
  if (read(local, OWNS_SSH_COMMAND) !== null) await putBack(git, projectPath, local, KEYS.sshCommand);
  await removeLocalSection(git, projectPath, SECTION);
}

async function requireLocalConfig(git, projectPath) {
  const local = await readConfig(git, projectPath, { localOnly: true });
  if (local === null) {
    throw new ProjectError(
      'NOT_A_REPOSITORY',
      "This folder isn't a git repository anymore.",
      message('project.noLongerRepository'),
    );
  }
  return local;
}

async function keepAside(git, projectPath, local, key) {
  const current = read(local, key);
  if (current !== null) await setLocal(git, projectPath, SAVED[key], current.value);
}

async function putBack(git, projectPath, local, key) {
  const saved = read(local, SAVED[key]);
  if (saved === null) {
    await unsetLocal(git, projectPath, key);
    return;
  }
  await setLocal(git, projectPath, key, saved.value);
  await unsetLocal(git, projectPath, SAVED[key]);
}

// `origin` is where git read the value from, such as `file:.git/config`.
function read(config, key) {
  const entry = config.get(normalizeKey(key));
  return entry ? { value: entry.value, scope: entry.scope, origin: entry.origin } : null;
}

function listRemotes(config) {
  const remotes = [];
  for (const [key, entry] of config) {
    const match = REMOTE_URL_KEY.exec(key);
    if (match) remotes.push({ name: match[1], ...parseRemoteUrl(entry.value) });
  }
  return remotes.sort(originFirst);
}

function originFirst(a, b) {
  if (a.name === 'origin') return -1;
  if (b.name === 'origin') return 1;
  return a.name.localeCompare(b.name);
}

function notARepository(projectPath) {
  return {
    path: projectPath,
    isRepo: false,
    author: { name: null, email: null },
    pushAccount: null,
    sshCommand: null,
    remotes: [],
    managedAccountId: null,
  };
}
