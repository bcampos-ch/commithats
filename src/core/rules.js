import path from 'node:path';
import { addGlobal, findGlobal, removeGlobalValue, setInFile } from './git-config.js';
import { KEYS } from './project-identity.js';
import { sshCommandFor } from './ssh-command.js';

// A rule makes git use an account without anyone choosing it per project:
//
//   by folder  "every repository inside this folder"
//   by owner   "every repository whose remote belongs to this GitHub user or organization"
//
// Both are git's own conditional includes in the global config, so they also cover
// repositories that are cloned later and need nothing running in the background:
//
//   [includeIf "gitdir/i:C:/Users/ada/work/"]
//       path = <app data>/accounts/<account id>.gitconfig
//   [includeIf "hasconfig:remote.*.url:git@github.com:[aA][cC][mM][eE]/**"]
//       path = <app data>/accounts/<account id>.gitconfig
//
// The included file holds the account's settings. A rule is recognized as the app's
// own by where its `path` points, so includes written by hand are never touched.

const INCLUDE_KEYS = /^includeif\..*\.path$/;
const INCLUDE_EXTENSION = '.gitconfig';
const CASE_INSENSITIVE_PLATFORMS = new Set(['win32', 'darwin']);
const PATTERN_CHARACTERS = /[*?[\]]/;

const REMOTE_URL_CONDITION = 'hasconfig:remote.*.url:';
// The ways a remote can spell "this owner on github.com". Each one needs its own condition.
const OWNER_URL_PREFIXES = ['git@github.com:', 'ssh://git@github.com/', 'https://github.com/'];
const EVERY_REPOSITORY = '/**';
const GITHUB_OWNER = /^[a-z0-9][a-z0-9_-]{0,38}$/;

/** The `includeIf` condition that matches every repository inside `folder`. */
export function gitdirCondition(folder, platform = process.platform) {
  const prefix = CASE_INSENSITIVE_PLATFORMS.has(platform) ? 'gitdir/i:' : 'gitdir:';
  // A trailing slash is what makes git match the folder and everything below it.
  return `${prefix}${toForwardSlashes(folder, platform).replace(/\/+$/, '')}/`;
}

/** The folder a `gitdir` condition talks about, or null for any other kind of condition. */
export function folderFromCondition(condition, platform = process.platform) {
  const match = /^gitdir(?:\/i)?:(.+)$/.exec(condition);
  if (!match) return null;

  const folder = match[1].replace(/\/+$/, '');
  return platform === 'win32' ? folder.replaceAll('/', '\\') : folder;
}

/** Git reads `*`, `?` and brackets in a condition as a pattern, so such a folder cannot be named exactly. */
export function hasPatternCharacters(folder) {
  return PATTERN_CHARACTERS.test(folder);
}

/**
 * The `includeIf` conditions that match every repository of a GitHub user or organization.
 *
 * GitHub ignores case in owner names but git compares remote URLs exactly, so every
 * letter is written as a two-letter class: "acme" becomes "[aA][cC][mM][eE]".
 */
export function ownerConditions(owner) {
  const anyCase = [...owner.toLowerCase()]
    .map((character) => (/[a-z]/.test(character) ? `[${character}${character.toUpperCase()}]` : character))
    .join('');
  return OWNER_URL_PREFIXES.map((prefix) => `${REMOTE_URL_CONDITION}${prefix}${anyCase}${EVERY_REPOSITORY}`);
}

/** The owner one of `ownerConditions` talks about, in lowercase, or null for any other condition. */
export function ownerFromCondition(condition) {
  if (!condition.startsWith(REMOTE_URL_CONDITION) || !condition.endsWith(EVERY_REPOSITORY)) return null;

  const pattern = condition.slice(REMOTE_URL_CONDITION.length, -EVERY_REPOSITORY.length);
  const prefix = OWNER_URL_PREFIXES.find((candidate) => pattern.startsWith(candidate));
  if (prefix === undefined) return null;

  const owner = pattern.slice(prefix.length).replace(/\[([a-z])[A-Z]\]/g, '$1');
  return GITHUB_OWNER.test(owner) ? owner : null;
}

export function includePathFor(includeDir, accountId) {
  return path.join(includeDir, `${accountId}${INCLUDE_EXTENSION}`);
}

/** The account a config file belongs to, or null when the file is not one of the app's. */
export function accountIdFromInclude(filePath, { includeDir, platform = process.platform }) {
  const comparable = (value) =>
    CASE_INSENSITIVE_PLATFORMS.has(platform) ? path.resolve(value).toLowerCase() : path.resolve(value);

  if (comparable(path.dirname(filePath)) !== comparable(includeDir)) return null;
  if (!filePath.endsWith(INCLUDE_EXTENSION)) return null;
  return path.basename(filePath, INCLUDE_EXTENSION);
}

/** Writes the settings of `account` to the file that its rules include. */
export async function writeAccountInclude(git, files, includePath, account, sshOptions = {}) {
  await files.ensureDir(path.dirname(includePath));
  await setInFile(git, includePath, KEYS.authorName, account.gitName);
  await setInFile(git, includePath, KEYS.authorEmail, account.gitEmail);
  await setInFile(git, includePath, KEYS.pushAccount, account.githubUser);
  await setInFile(git, includePath, KEYS.sshCommand, sshCommandFor(account, sshOptions));
}

/** Lists the app's rules, read from the global config, as `{ folders, owners }`. */
export async function listRules(git, options) {
  const folders = [];
  const owners = [];
  for (const { folder, owner, accountId } of await readOwnIncludes(git, options)) {
    if (folder !== null) folders.push({ folder, accountId });
    // One owner rule is several includes, one per URL form.
    else if (!owners.some((rule) => rule.owner === owner)) owners.push({ owner, accountId });
  }
  return { folders, owners };
}

/**
 * Makes the app's rules in the global config be exactly `folders` and `owners`.
 *
 * Git applies includes in file order and the last one wins, so the order written here
 * is the order of precedence: folders from the shallowest to the deepest, so that
 * `code/client` beats `code`, and then owners, because the owner of the remote says
 * more about who must push than the folder a repository happens to sit in.
 */
export async function saveRules(git, { folders, owners }, { includeDir, platform = process.platform }) {
  for (const { key, value } of await readOwnIncludes(git, { includeDir, platform })) {
    await removeGlobalValue(git, key, value);
  }

  const include = (accountId) => toForwardSlashes(includePathFor(includeDir, accountId), platform);
  const shallowestFirst = [...folders].sort(
    (a, b) => a.folder.length - b.folder.length || a.folder.localeCompare(b.folder),
  );
  for (const { folder, accountId } of shallowestFirst) {
    await addGlobal(git, `includeIf.${gitdirCondition(folder, platform)}.path`, include(accountId));
  }

  const byName = [...owners].sort((a, b) => a.owner.localeCompare(b.owner));
  for (const { owner, accountId } of byName) {
    for (const condition of ownerConditions(owner)) {
      await addGlobal(git, `includeIf.${condition}.path`, include(accountId));
    }
  }
}

async function readOwnIncludes(git, { includeDir, platform = process.platform }) {
  const own = [];
  for (const { key, value } of await findGlobal(git, INCLUDE_KEYS.source)) {
    const accountId = accountIdFromInclude(value, { includeDir, platform });
    if (accountId === null) continue;

    const condition = key.slice('includeif.'.length, -'.path'.length);
    const folder = folderFromCondition(condition, platform);
    const owner = ownerFromCondition(condition);
    if (folder !== null || owner !== null) own.push({ key, value, folder, owner, accountId });
  }
  return own;
}

function toForwardSlashes(value, platform) {
  return platform === 'win32' ? value.replaceAll('\\', '/') : value;
}
