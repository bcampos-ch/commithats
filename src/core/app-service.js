import path from 'node:path';
import { validateAccount } from './accounts.js';
import { collectWarnings, describeAssignment } from './assignment.js';
import { ProjectError, readOwnSshCommand } from './git-config.js';
import { message } from './messages.js';
import { abbreviateHome } from './paths.js';
import { applyAccount, clearAccount, findRepositoryRoot, inspectProject } from './project-identity.js';
import { createQueue } from './queue.js';
import {
  accountIdFromInclude,
  hasPatternCharacters,
  includePathFor,
  listRules,
  saveRules,
  writeAccountInclude,
} from './rules.js';
import { readSettings, validateSettingsChange } from './settings.js';
import { DEFAULT_SSH_COMMAND } from './ssh-command.js';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const GITHUB_OWNER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/;
const OWNER_IN_GITHUB_URL = /github\.com[:/]+([^/\s]+)/i;

/**
 * The use cases of the app, independent of Electron.
 *
 * Every operation answers with `{ ok: true, snapshot, notices? }` or
 * `{ ok: false, error | errors }`. The snapshot is the whole picture the UI shows,
 * so the UI never has to work anything out by itself. Errors, warnings and notices
 * are messages (see messages.js), never sentences: the UI says them in the language
 * the person chose. Input that the UI's own controls cannot produce is a bug, so it
 * throws instead of being explained.
 *
 * Ports: `git` runs git, `store` persists accounts, tracked projects and settings,
 * `gcm` talks to the credential manager, `files` touches the file system, `keygen`
 * creates SSH keys. `includeDir` is where the settings files that rules include are
 * kept, `sshDir` is where new keys go, and `defaultLanguage` is the language used
 * until the person picks one.
 */
export function createAppService({
  git,
  store,
  gcm,
  files,
  keygen,
  includeDir,
  sshDir,
  homeDir = '',
  platform = process.platform,
  defaultLanguage = 'en',
}) {
  // One operation at a time, reads included. Two quick clicks cannot interleave their writes,
  // and answers come back in the order things happened: the UI shows the last answer it got,
  // so a read asked for before a change must not answer after it.
  const exclusive = createQueue();
  const ruleOptions = { includeDir, platform };

  const samePath = (a, b) => (platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
  const shown = (fullPath) => abbreviateHome(fullPath, homeDir, platform);
  const settingsOf = (state) => readSettings(state.settings, { defaultLanguage });

  async function readGitVersion() {
    try {
      const result = await git(['--version']);
      return /git version (\S+)/.exec(result.stdout)?.[1] ?? null;
    } catch {
      return null;
    }
  }

  // What an account without a key pins: the SSH command the person already uses, or plain ssh.
  async function readSshOptions() {
    return { platform, baselineSshCommand: (await readOwnSshCommand(git)) ?? DEFAULT_SSH_COMMAND };
  }

  async function buildSnapshot(state) {
    const [gitVersion, credentialManager] = await Promise.all([readGitVersion(), gcm.getStatus()]);
    const [inspections, rules, sshOptions] =
      gitVersion === null
        ? [state.projects.map(notInspected), { folders: [], owners: [] }, { platform }]
        : await Promise.all([
            Promise.all(state.projects.map((projectPath) => inspectProject(git, projectPath))),
            listRules(git, ruleOptions),
            readSshOptions(),
          ]);

    const context = {
      accounts: state.accounts,
      rules,
      sshOptions,
      signedInAccounts: credentialManager.available ? credentialManager.accounts : null,
    };
    const projects = inspections.map((inspection) => toProjectView(inspection, context));
    const toFolderView = (rule) => ({ path: rule.folder, displayPath: shown(rule.folder) });
    const hasAccount = (rule) => state.accounts.some((account) => account.id === rule.accountId);
    const accounts = state.accounts.map((account) => ({
      ...account,
      signedIn:
        context.signedInAccounts === null
          ? null
          : context.signedInAccounts.some((name) => sameName(name, account.githubUser)),
      projectCount: projects.filter((project) => project.assignment.accountId === account.id).length,
      folders: rules.folders.filter((rule) => rule.accountId === account.id).map(toFolderView),
      owners: rules.owners.filter((rule) => rule.accountId === account.id).map((rule) => rule.owner),
    }));

    return {
      environment: { gitVersion, credentialManager },
      settings: settingsOf(state),
      accounts,
      projects,
      strayFolderRules: rules.folders.filter((rule) => !hasAccount(rule)).map(toFolderView),
      strayOwnerRules: rules.owners.filter((rule) => !hasAccount(rule)).map((rule) => rule.owner),
    };
  }

  function toProjectView(inspection, { accounts, rules, sshOptions, signedInAccounts }) {
    const assignment = describeAssignment(inspection, accounts, sshOptions);

    // Which kind of rule a value comes from, judged by the file git read it from.
    const ruleBehind = (entry) => {
      if (!entry || entry.scope !== 'global' || !entry.origin?.startsWith('file:')) return null;
      const accountId = accountIdFromInclude(entry.origin.slice('file:'.length), ruleOptions);
      if (accountId === null) return null;

      const byOwner = inspection.remotes.some((remote) =>
        rules.owners.some(
          (rule) => rule.accountId === accountId && remote.owner !== null && sameName(rule.owner, remote.owner),
        ),
      );
      return { accountId, via: byOwner ? 'owner' : 'folder' };
    };
    const toResolvedView = (entry) =>
      entry === null ? null : { value: entry.value, scope: entry.scope, viaRule: ruleBehind(entry)?.via ?? null };

    const inherited =
      assignment.kind === 'unset'
        ? ([inspection.pushAccount, inspection.author.email, inspection.author.name]
            .map(ruleBehind)
            .find((rule) => rule !== null && accounts.some((account) => account.id === rule.accountId)) ?? null)
        : null;

    const effectiveAccountId = assignment.accountId ?? inherited?.accountId ?? null;
    const account = accounts.find((candidate) => candidate.id === effectiveAccountId) ?? null;
    const warnings = account === null ? [] : collectWarnings(inspection, account, { signedInAccounts });
    if (assignment.kind === 'drifted') warnings.unshift(message('warning.drifted'));

    return {
      path: inspection.path,
      displayPath: shown(inspection.path),
      name: path.basename(inspection.path),
      isRepo: inspection.isRepo,
      assignment,
      inherited,
      author: { name: toResolvedView(inspection.author.name), email: toResolvedView(inspection.author.email) },
      pushAccount: toResolvedView(inspection.pushAccount),
      sshCommand: toResolvedView(inspection.sshCommand),
      remotes: inspection.remotes.map(({ name, display, transport, isGithub }) => ({ name, display, transport, isGithub })),
      warnings,
    };
  }

  function writeInclude(account, sshOptions) {
    return writeAccountInclude(git, files, includePathFor(includeDir, account.id), account, sshOptions);
  }

  // Hands an edited account to everything that uses it: assigned projects and rules.
  async function reapply(account, projects) {
    const sshOptions = await readSshOptions();
    for (const projectPath of projects) {
      const inspection = await inspectProject(git, projectPath);
      if (inspection.managedAccountId === account.id) await applyAccount(git, projectPath, account, sshOptions);
    }

    const rules = await listRules(git, ruleOptions);
    const hasRules = [...rules.folders, ...rules.owners].some((rule) => rule.accountId === account.id);
    if (hasRules) await writeInclude(account, sshOptions);
  }

  // Turns a git failure into an answer the UI can show, instead of an exception.
  const reportingGitFailures = (task) =>
    async (...args) => {
      try {
        return await task(...args);
      } catch (error) {
        if (error instanceof ProjectError) return { ok: false, error: error.problem };
        throw error;
      }
    };

  const readSnapshot = exclusive(async () => buildSnapshot(await store.load()));

  return {
    getSnapshot: readSnapshot,

    /** The settings alone, for whoever needs them before there is a window to show a snapshot in. */
    async getSettings() {
      return settingsOf(await store.load());
    },

    /** Changes one or more settings and answers with all of them. Nothing in git depends on a setting. */
    saveSettings: exclusive(async (change) => {
      const validation = validateSettingsChange(change);
      if (!validation.ok) throw new TypeError('That is not a setting of the app, or not a value it can take.');

      const state = await store.load();
      const nextState = { ...state, settings: { ...state.settings, ...validation.change } };
      await store.save(nextState);
      return { ok: true, settings: settingsOf(nextState) };
    }),

    saveAccount: exclusive(
      reportingGitFailures(async (input) => {
        const state = await store.load();
        const validation = validateAccount(input, { existing: state.accounts });
        if (!validation.ok) return { ok: false, errors: validation.errors };

        const { account } = validation;
        if (account.sshKeyPath !== null && !(await files.exists(account.sshKeyPath))) {
          return { ok: false, errors: { sshKeyPath: message('sshKeyPath.missing') } };
        }

        const isUpdate = state.accounts.some((existing) => existing.id === account.id);
        const accounts = isUpdate
          ? state.accounts.map((existing) => (existing.id === account.id ? account : existing))
          : [...state.accounts, account];
        const nextState = { ...state, accounts };
        await store.save(nextState);
        if (isUpdate) await reapply(account, nextState.projects);

        return { ok: true, snapshot: await buildSnapshot(nextState) };
      }),
    ),

    removeAccount: exclusive(
      reportingGitFailures(async (accountId) => {
        const state = await store.load();
        if (!state.accounts.some((account) => account.id === accountId)) {
          return { ok: false, error: message('account.missing') };
        }

        const inspections = await Promise.all(state.projects.map((projectPath) => inspectProject(git, projectPath)));
        const projectCount = inspections.filter((inspection) => inspection.managedAccountId === accountId).length;
        if (projectCount > 0) return { ok: false, error: message('account.inUse', { count: projectCount }) };

        const rules = await listRules(git, ruleOptions);
        const ruleCount = [...rules.folders, ...rules.owners].filter((rule) => rule.accountId === accountId).length;
        if (ruleCount > 0) return { ok: false, error: message('account.hasRules', { count: ruleCount }) };

        const nextState = { ...state, accounts: state.accounts.filter((account) => account.id !== accountId) };
        await store.save(nextState);
        await files.remove(includePathFor(includeDir, accountId));
        return { ok: true, snapshot: await buildSnapshot(nextState) };
      }),
    ),

    // The sign-in itself is not queued: it waits on a person and must not hold up everything else.
    async signIn(accountId) {
      const account = (await store.load()).accounts.find((candidate) => candidate.id === accountId);
      if (!account) return { ok: false, error: message('account.missing') };

      const result = await gcm.signIn(account.githubUser);
      if (!result.ok) {
        const error = result.detail ? message('signIn.failedBecause', { detail: result.detail }) : message('signIn.failed');
        return { ok: false, error };
      }

      const snapshot = await readSnapshot();
      const signedIn = snapshot.accounts.find((candidate) => candidate.id === accountId)?.signedIn;
      const user = account.githubUser;
      // The browser decides which GitHub account signs in, and it may not be the one that was asked for.
      const notice = signedIn === false ? message('signIn.otherAccount', { user }) : message('signIn.done', { user });
      return { ok: true, snapshot, notices: [notice] };
    },

    /** Creates a new key in the SSH folder, named after the account label. It never replaces a file. */
    generateSshKey: exclusive(async (input) => {
      const label = text(input?.label).trim();
      if (label === '') return { ok: false, errors: { label: message('sshKey.labelRequired') } };

      const keyPath = path.join(sshDir, `id_ed25519_${slugify(label)}`);
      if ((await files.exists(keyPath)) || (await files.exists(`${keyPath}.pub`))) {
        return { ok: false, errors: { sshKeyPath: message('sshKey.exists', { name: path.basename(keyPath) }) } };
      }

      await files.ensureDir(sshDir);
      const comment = text(input?.gitEmail).replace(CONTROL_CHARACTERS, '').trim() || label;
      const result = await keygen.generate({ keyPath, comment });
      if (!result.ok) return { ok: false, errors: { sshKeyPath: keygenProblem(result.reason) } };

      return { ok: true, path: keyPath, publicKey: await keygen.readPublicKey(keyPath) };
    }),

    async readPublicKey(keyPath) {
      const publicKey = text(keyPath).trim() === '' ? null : await keygen.readPublicKey(keyPath);
      return { ok: true, publicKey };
    },

    /** Makes every repository inside a folder use an account, through the global git config. */
    addFolderRule: exclusive(
      reportingGitFailures(async (accountId, folderPath) => {
        const state = await store.load();
        const account = state.accounts.find((candidate) => candidate.id === accountId);
        if (!account) return { ok: false, error: message('account.missing') };
        if (text(folderPath).trim() === '') return { ok: false, error: message('folder.required') };

        const folder = path.resolve(folderPath);
        if (!(await files.exists(folder))) return { ok: false, error: message('folder.missing', { folder: shown(folder) }) };
        // Git reads *, ? and brackets in a path as a pattern, so such a folder cannot be targeted exactly.
        if (hasPatternCharacters(folder)) return { ok: false, error: message('folder.pattern', { folder: shown(folder) }) };

        const rules = await listRules(git, ruleOptions);
        const taken = rules.folders.find((rule) => samePath(rule.folder, folder));
        if (taken) {
          const holder = state.accounts.find((candidate) => candidate.id === taken.accountId);
          const error = holder
            ? message('folder.taken', { folder: shown(folder), account: holder.label })
            : message('folder.takenByStray', { folder: shown(folder) });
          return { ok: false, error };
        }

        await writeInclude(account, await readSshOptions());
        await saveRules(git, { ...rules, folders: [...rules.folders, { folder, accountId: account.id }] }, ruleOptions);
        return { ok: true, snapshot: await buildSnapshot(state) };
      }),
    ),

    removeFolderRule: exclusive(
      reportingGitFailures(async (folderPath) => {
        const state = await store.load();
        const rules = await listRules(git, ruleOptions);
        const folders = rules.folders.filter((rule) => !samePath(rule.folder, text(folderPath)));
        await saveRules(git, { ...rules, folders }, ruleOptions);
        return { ok: true, snapshot: await buildSnapshot(state) };
      }),
    ),

    /**
     * Makes every repository whose remote belongs to a GitHub user or organization use an
     * account, through the global git config. `input` is the name, a handle, or a repository URL.
     */
    addOwnerRule: exclusive(
      reportingGitFailures(async (accountId, input) => {
        const state = await store.load();
        const account = state.accounts.find((candidate) => candidate.id === accountId);
        if (!account) return { ok: false, error: message('account.missing') };

        const owner = ownerFrom(text(input));
        if (owner === null) return { ok: false, errors: { owner: message('owner.invalid') } };

        const rules = await listRules(git, ruleOptions);
        const taken = rules.owners.find((rule) => sameName(rule.owner, owner));
        if (taken) {
          const holder = state.accounts.find((candidate) => candidate.id === taken.accountId);
          const error = holder
            ? message('owner.taken', { owner: taken.owner, account: holder.label })
            : message('owner.takenByStray', { owner: taken.owner });
          return { ok: false, errors: { owner: error } };
        }

        await writeInclude(account, await readSshOptions());
        await saveRules(git, { ...rules, owners: [...rules.owners, { owner, accountId: account.id }] }, ruleOptions);
        return { ok: true, snapshot: await buildSnapshot(state) };
      }),
    ),

    removeOwnerRule: exclusive(
      reportingGitFailures(async (owner) => {
        const state = await store.load();
        const rules = await listRules(git, ruleOptions);
        const owners = rules.owners.filter((rule) => !sameName(rule.owner, text(owner)));
        await saveRules(git, { ...rules, owners }, ruleOptions);
        return { ok: true, snapshot: await buildSnapshot(state) };
      }),
    ),

    addProjects: exclusive(async (folderPaths) => {
      const state = await store.load();
      const projects = [...state.projects];
      const notices = [];

      for (const folderPath of folderPaths) {
        if (typeof folderPath !== 'string') continue;
        const root = await findRepositoryRoot(git, folderPath);
        const name = path.basename(root ?? folderPath);
        // A plain folder is usually where repositories are about to be cloned, which is what a folder rule is for.
        if (root === null) notices.push(message('project.notRepository', { name }));
        else if (projects.some((existing) => samePath(existing, root))) notices.push(message('project.alreadyListed', { name }));
        else projects.push(root);
      }

      const nextState = { ...state, projects };
      await store.save(nextState);
      return { ok: true, snapshot: await buildSnapshot(nextState), notices };
    }),

    removeProject: exclusive(async (projectPath) => {
      const state = await store.load();
      const projects = state.projects.filter((existing) => !samePath(existing, text(projectPath)));
      const nextState = { ...state, projects };
      await store.save(nextState);
      return { ok: true, snapshot: await buildSnapshot(nextState) };
    }),

    /**
     * Puts a tracked project at `index` in the list, counting from zero. A place past
     * either end of the list means that end. Only the order the app shows changes.
     */
    moveProject: exclusive(async (projectPath, index) => {
      if (!Number.isInteger(index)) throw new TypeError('The place of a project in the list must be a whole number.');

      const state = await store.load();
      const tracked = state.projects.find((existing) => samePath(existing, text(projectPath)));
      if (tracked === undefined) return { ok: false, error: message('project.untracked') };

      const projects = state.projects.filter((existing) => existing !== tracked);
      projects.splice(Math.max(0, Math.min(index, projects.length)), 0, tracked);
      const nextState = { ...state, projects };
      await store.save(nextState);
      return { ok: true, snapshot: await buildSnapshot(nextState) };
    }),

    assignProject: exclusive(
      reportingGitFailures(async (projectPath, accountId) => {
        const state = await store.load();
        const tracked = state.projects.find((existing) => samePath(existing, text(projectPath)));
        if (tracked === undefined) return { ok: false, error: message('project.untracked') };

        if (accountId === null) {
          await clearAccount(git, tracked);
        } else {
          const account = state.accounts.find((candidate) => candidate.id === accountId);
          if (!account) return { ok: false, error: message('account.missing') };
          await applyAccount(git, tracked, account, await readSshOptions());
        }

        return { ok: true, snapshot: await buildSnapshot(state) };
      }),
    ),
  };
}

function notInspected(projectPath) {
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

function text(value) {
  return typeof value === 'string' ? value : '';
}

function keygenProblem(reason) {
  return reason === 'not-found' ? message('sshKey.keygenMissing') : message('sshKey.failed');
}

// Accepts "acme", "@acme", "acme/api" or a GitHub URL, and answers with the owner in lowercase.
function ownerFrom(input) {
  const trimmed = input.trim().replace(/^@/, '');
  const candidate = OWNER_IN_GITHUB_URL.exec(trimmed)?.[1] ?? trimmed.split('/')[0];
  return GITHUB_OWNER.test(candidate) ? candidate.toLowerCase() : null;
}

function slugify(label) {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'account' : slug;
}
