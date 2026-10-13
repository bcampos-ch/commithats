import path from 'node:path';
import { validateAccount } from './accounts.js';
import { collectWarnings, describeAssignment } from './assignment.js';
import { ProjectError, readOwnSshCommand } from './git-config.js';
import { abbreviateHome } from './paths.js';
import { applyAccount, clearAccount, findRepositoryRoot, inspectProject } from './project-identity.js';
import {
  accountIdFromInclude,
  hasPatternCharacters,
  includePathFor,
  listRules,
  saveRules,
  writeAccountInclude,
} from './rules.js';
import { DEFAULT_SSH_COMMAND } from './ssh-command.js';

const DRIFT_WARNING =
  "This project's git config no longer matches the account. Choose the account again to reapply it.";
const KEYGEN_PROBLEMS = {
  'not-found': 'ssh-keygen was not found. Install the OpenSSH client, or create the key yourself and choose it.',
  failed: "The key couldn't be created. Check that you can write to the .ssh folder.",
};
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const GITHUB_OWNER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/;
const OWNER_IN_GITHUB_URL = /github\.com[:/]+([^/\s]+)/i;

/**
 * The use cases of the app, independent of Electron.
 *
 * Every operation answers with `{ ok: true, snapshot, notices? }` or
 * `{ ok: false, error | errors }`. The snapshot is the whole picture the UI shows,
 * so the UI never has to work anything out by itself.
 *
 * Ports: `git` runs git, `store` persists accounts and tracked projects, `gcm` talks
 * to the credential manager, `files` touches the file system, `keygen` creates SSH keys.
 * `includeDir` is where the settings files that rules include are kept, and `sshDir`
 * is where new keys go.
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
}) {
  const exclusive = createQueue();
  const ruleOptions = { includeDir, platform };

  const samePath = (a, b) => (platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
  const shown = (fullPath) => abbreviateHome(fullPath, homeDir, platform);

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
    if (assignment.kind === 'drifted') warnings.unshift(DRIFT_WARNING);

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
        if (error instanceof ProjectError) return { ok: false, error: error.message };
        throw error;
      }
    };

  return {
    async getSnapshot() {
      return buildSnapshot(await store.load());
    },

    saveAccount: exclusive(
      reportingGitFailures(async (input) => {
        const state = await store.load();
        const validation = validateAccount(input, { existing: state.accounts });
        if (!validation.ok) return { ok: false, errors: validation.errors };

        const { account } = validation;
        if (account.sshKeyPath !== null && !(await files.exists(account.sshKeyPath))) {
          return { ok: false, errors: { sshKeyPath: "That file doesn't exist. Choose the private key again." } };
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
          return { ok: false, error: 'That account no longer exists.' };
        }

        const inspections = await Promise.all(state.projects.map((projectPath) => inspectProject(git, projectPath)));
        const projectCount = inspections.filter((inspection) => inspection.managedAccountId === accountId).length;
        if (projectCount > 0) {
          const projects = projectCount === 1 ? '1 project' : `${projectCount} projects`;
          return { ok: false, error: `This account is assigned to ${projects}. Move them to another account first.` };
        }

        const rules = await listRules(git, ruleOptions);
        const folderCount = rules.folders.filter((rule) => rule.accountId === accountId).length;
        const ownerCount = rules.owners.filter((rule) => rule.accountId === accountId).length;
        if (folderCount + ownerCount > 0) {
          const inUse = [countOf(folderCount, 'folder rule'), countOf(ownerCount, 'owner rule')].filter(Boolean);
          const them = folderCount + ownerCount === 1 ? 'it' : 'them';
          return { ok: false, error: `This account still has ${inUse.join(' and ')}. Remove ${them} first.` };
        }

        const nextState = { ...state, accounts: state.accounts.filter((account) => account.id !== accountId) };
        await store.save(nextState);
        await files.remove(includePathFor(includeDir, accountId));
        return { ok: true, snapshot: await buildSnapshot(nextState) };
      }),
    ),

    // Not queued: a sign-in waits on a person and must not hold up everything else.
    async signIn(accountId) {
      const account = (await store.load()).accounts.find((candidate) => candidate.id === accountId);
      if (!account) return { ok: false, error: 'That account no longer exists.' };

      const result = await gcm.signIn(account.githubUser);
      if (!result.ok) return { ok: false, error: `The sign-in didn't finish. ${result.message ?? ''}`.trim() };

      const snapshot = await buildSnapshot(await store.load());
      const signedIn = snapshot.accounts.find((candidate) => candidate.id === accountId)?.signedIn;
      const notice =
        signedIn === false
          ? `The sign-in finished, but "${account.githubUser}" isn't signed in. Check which GitHub account your browser used.`
          : `Signed in as ${account.githubUser}.`;
      return { ok: true, snapshot, notices: [notice] };
    },

    /** Creates a new key in the SSH folder, named after the account label. It never replaces a file. */
    generateSshKey: exclusive(async (input) => {
      const label = text(input?.label).trim();
      if (label === '') return { ok: false, errors: { label: 'Enter a label first. The key file is named after it.' } };

      const keyPath = path.join(sshDir, `id_ed25519_${slugify(label)}`);
      if ((await files.exists(keyPath)) || (await files.exists(`${keyPath}.pub`))) {
        const name = path.basename(keyPath);
        return { ok: false, errors: { sshKeyPath: `A key named ${name} already exists. Select it with "Choose file".` } };
      }

      await files.ensureDir(sshDir);
      const comment = text(input?.gitEmail).replace(CONTROL_CHARACTERS, '').trim() || label;
      const result = await keygen.generate({ keyPath, comment });
      if (!result.ok) return { ok: false, errors: { sshKeyPath: KEYGEN_PROBLEMS[result.reason] ?? KEYGEN_PROBLEMS.failed } };

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
        if (!account) return { ok: false, error: 'That account no longer exists.' };
        if (text(folderPath).trim() === '') return { ok: false, error: 'Choose a folder first.' };

        const folder = path.resolve(folderPath);
        if (!(await files.exists(folder))) return { ok: false, error: `"${shown(folder)}" doesn't exist anymore.` };
        if (hasPatternCharacters(folder)) {
          return {
            ok: false,
            error: `Git can't target "${shown(folder)}" exactly because its path contains *, ?, or brackets. Choose another folder.`,
          };
        }

        const rules = await listRules(git, ruleOptions);
        const taken = rules.folders.find((rule) => samePath(rule.folder, folder));
        if (taken) {
          const owner = state.accounts.find((candidate) => candidate.id === taken.accountId)?.label ?? 'another account';
          return { ok: false, error: `"${shown(folder)}" already uses ${owner}. Remove that rule first.` };
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
        if (!account) return { ok: false, error: 'That account no longer exists.' };

        const owner = ownerFrom(text(input));
        if (owner === null) {
          return {
            ok: false,
            errors: { owner: 'Enter a GitHub user or organization, like "acme", or paste a repository URL.' },
          };
        }

        const rules = await listRules(git, ruleOptions);
        const taken = rules.owners.find((rule) => sameName(rule.owner, owner));
        if (taken) {
          const label = state.accounts.find((candidate) => candidate.id === taken.accountId)?.label ?? 'another account';
          return { ok: false, errors: { owner: `"${taken.owner}" already uses ${label}. Remove that rule first.` } };
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
        if (root === null) notices.push(notARepositoryNotice(name));
        else if (projects.some((existing) => samePath(existing, root))) notices.push(`"${name}" is already in the list.`);
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

    assignProject: exclusive(
      reportingGitFailures(async (projectPath, accountId) => {
        const state = await store.load();
        const tracked = state.projects.find((existing) => samePath(existing, text(projectPath)));
        if (tracked === undefined) return { ok: false, error: "That project isn't in the list anymore." };

        if (accountId === null) {
          await clearAccount(git, tracked);
        } else {
          const account = state.accounts.find((candidate) => candidate.id === accountId);
          if (!account) return { ok: false, error: 'That account no longer exists.' };
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

// A plain folder is usually where repositories are about to be cloned, which is what a folder rule is for.
function notARepositoryNotice(name) {
  return (
    `"${name}" isn't a git repository, so it can't be a project. ` +
    'To use an account for everything you clone into it, choose "Add folder" on that account.'
  );
}

function countOf(count, noun) {
  if (count === 0) return null;
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
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

// Runs one mutating operation at a time, so two quick clicks cannot interleave their writes.
function createQueue() {
  let tail = Promise.resolve();
  return (task) =>
    (...args) => {
      const run = tail.then(() => task(...args));
      tail = run.catch(() => {});
      return run;
    };
}
