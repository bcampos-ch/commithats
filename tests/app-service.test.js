import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createFiles } from '../src/adapters/files.js';
import { createJsonStore } from '../src/adapters/json-store.js';
import { createAppService } from '../src/core/app-service.js';
import { createSandbox } from './helpers/sandbox.js';

const workDraft = {
  label: 'Work',
  gitName: 'Ada L.',
  gitEmail: 'ada@company.example',
  githubUser: 'ada-work',
  sshKeyPath: '',
};

const personalDraft = {
  label: 'Personal',
  gitName: 'Ada Lovelace',
  gitEmail: 'ada@example.com',
  githubUser: 'ada-personal',
  sshKeyPath: '',
};

async function setup(
  t,
  {
    signedIn = ['ada-work'],
    gcmAvailable = true,
    // What the stand-in credential manager does with a sign-in: the browser signs in as
    // the requested user ('requested'), as someone else ('someone-else'), or the person gives up.
    signInOutcome = 'requested',
    existingFiles = [],
    keygenResult = { ok: true },
    platform = 'linux',
    defaultLanguage = 'en',
  } = {},
) {
  const sandbox = await createSandbox(t);
  const signIns = [];
  const gcm = {
    getStatus: async () => ({
      available: gcmAvailable,
      accounts: gcmAvailable ? [...signedIn] : [],
      version: gcmAvailable ? '2.6.1' : null,
    }),
    signIn: async (username) => {
      signIns.push(username);
      if (signInOutcome === 'gave-up') return { ok: false, detail: null };
      if (signInOutcome === 'failed') return { ok: false, detail: 'fatal: User cancelled dialog.' };
      signedIn.push(signInOutcome === 'someone-else' ? 'someone-else' : username);
      return { ok: true };
    },
  };
  const realFiles = createFiles();
  const files = {
    ...realFiles,
    exists: async (file) => existingFiles.includes(file) || realFiles.exists(file),
  };
  const keyRequests = [];
  const keygen = {
    generate: async (request) => {
      keyRequests.push(request);
      return keygenResult;
    },
    readPublicKey: async (keyPath) => `ssh-ed25519 AAAAexample ${path.basename(keyPath)}`,
  };
  const store = createJsonStore(path.join(sandbox.root, 'app-data', 'state.json'));
  const sshDir = path.join(sandbox.root, 'ssh');
  const createService = () =>
    createAppService({
      git: sandbox.git,
      store,
      gcm,
      files,
      keygen,
      includeDir: path.join(sandbox.root, 'app-data', 'accounts'),
      sshDir,
      platform,
      homeDir: sandbox.root,
      defaultLanguage,
    });
  return { sandbox, service: createService(), createService, signIns, keyRequests, sshDir, store, existingFiles };
}

async function resolvedValue(sandbox, repo, key) {
  const result = await sandbox.git(['-C', repo, 'config', '--get', key]);
  return result.code === 0 ? result.stdout.replace(/\r?\n$/, '') : null;
}

async function addAccount(service, draft) {
  const result = await service.saveAccount(draft);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return result.snapshot.accounts.find((account) => account.label === draft.label);
}

describe('projects', () => {
  it('tracks the repository root when one of its subfolders is added', async (t) => {
    const { sandbox, service } = await setup(t);
    const repo = await sandbox.initRepo('api');
    const nested = await sandbox.makeDir(path.join('api', 'src'));

    const result = await service.addProjects([nested]);

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.snapshot.projects.map((project) => ({ path: project.path, name: project.name })),
      [{ path: path.resolve(repo), name: 'api' }],
    );
  });

  it('shows project paths relative to the home folder', async (t) => {
    const { sandbox, service } = await setup(t);
    const repo = await sandbox.initRepo('api');

    const result = await service.addProjects([repo]);

    assert.equal(result.snapshot.projects[0].displayPath, `~${path.sep}api`);
  });

  it('skips folders that are not git repositories and says why', async (t) => {
    const { sandbox, service } = await setup(t);
    const folder = await sandbox.makeDir('notes');

    const result = await service.addProjects([folder]);

    assert.equal(result.snapshot.projects.length, 0);
    assert.deepEqual(result.notices, [{ code: 'project.notRepository', params: { name: 'notes' } }]);
  });

  it('does not track the same project twice', async (t) => {
    const { sandbox, service } = await setup(t);
    const repo = await sandbox.initRepo('api');
    await service.addProjects([repo]);

    const result = await service.addProjects([repo]);

    assert.equal(result.snapshot.projects.length, 1);
    assert.deepEqual(result.notices, [{ code: 'project.alreadyListed', params: { name: 'api' } }]);
  });

  it('stops tracking a project without changing its git config', async (t) => {
    const { sandbox, service } = await setup(t);
    const repo = await sandbox.initRepo('api');
    const work = await addAccount(service, workDraft);
    await service.addProjects([repo]);
    await service.assignProject(path.resolve(repo), work.id);

    const result = await service.removeProject(path.resolve(repo));

    assert.equal(result.snapshot.projects.length, 0);
    assert.equal(await sandbox.getLocal(repo, 'user.email'), 'ada@company.example');
  });

  it('remembers accounts and projects after a restart', async (t) => {
    const { sandbox, service, createService } = await setup(t);
    const repo = await sandbox.initRepo('api');
    await addAccount(service, workDraft);
    await service.addProjects([repo]);

    const snapshot = await createService().getSnapshot();

    assert.deepEqual(snapshot.accounts.map((account) => account.label), ['Work']);
    assert.deepEqual(snapshot.projects.map((project) => project.name), ['api']);
  });
});

describe('assigning accounts', () => {
  it('switches a project to the chosen account', async (t) => {
    const { sandbox, service } = await setup(t);
    const repo = await sandbox.initRepo('api');
    const work = await addAccount(service, workDraft);
    await service.addProjects([repo]);

    const result = await service.assignProject(path.resolve(repo), work.id);

    const [project] = result.snapshot.projects;
    assert.deepEqual(project.assignment, { kind: 'account', accountId: work.id });
    assert.deepEqual(project.author.email, { value: 'ada@company.example', scope: 'local', viaRule: null });
    assert.deepEqual(project.pushAccount, { value: 'ada-work', scope: 'local', viaRule: null });
    assert.deepEqual(project.sshCommand, { value: 'ssh', scope: 'local', viaRule: null });
    assert.equal(project.inherited, null);
    assert.equal(result.snapshot.accounts[0].projectCount, 1);
  });

  it('returns a project to the global config when no account is chosen', async (t) => {
    const { sandbox, service } = await setup(t);
    const repo = await sandbox.initRepo('api');
    const work = await addAccount(service, workDraft);
    await service.addProjects([repo]);
    await service.assignProject(path.resolve(repo), work.id);

    const result = await service.assignProject(path.resolve(repo), null);

    assert.deepEqual(result.snapshot.projects[0].assignment, { kind: 'unset', accountId: null });
    assert.equal(await sandbox.getLocal(repo, 'user.email'), null);
  });

  it('refuses projects it does not track', async (t) => {
    const { sandbox, service } = await setup(t);
    const repo = await sandbox.initRepo('untracked');
    const work = await addAccount(service, workDraft);

    const result = await service.assignProject(path.resolve(repo), work.id);

    assert.deepEqual(result, { ok: false, error: { code: 'project.untracked' } });
    assert.equal(await sandbox.getLocal(repo, 'user.email'), null);
  });

  it('refuses an account that does not exist', async (t) => {
    const { sandbox, service } = await setup(t);
    const repo = await sandbox.initRepo('api');
    await service.addProjects([repo]);

    const result = await service.assignProject(path.resolve(repo), 'missing-account');

    assert.deepEqual(result, { ok: false, error: { code: 'account.missing' } });
  });

  it('says so when the folder of a project stopped being a repository', async (t) => {
    const { sandbox, service } = await setup(t);
    const repo = await sandbox.initRepo('api');
    const work = await addAccount(service, workDraft);
    await service.addProjects([repo]);
    await rm(path.join(repo, '.git'), { recursive: true, force: true });

    const result = await service.assignProject(path.resolve(repo), work.id);

    assert.deepEqual(result, { ok: false, error: { code: 'project.noLongerRepository' } });
  });

  it('passes on what git said when git refuses to write', async (t) => {
    const { sandbox, service } = await setup(t);
    const repo = await sandbox.initRepo('api');
    const work = await addAccount(service, workDraft);
    await service.addProjects([repo]);
    // A lock file left behind is how git says someone else is writing the config.
    await writeFile(path.join(repo, '.git', 'config.lock'), '');

    const result = await service.assignProject(path.resolve(repo), work.id);

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'git.failed');
    assert.match(result.error.params.detail, /config/);
  });

  it('warns about what would make git ignore the assignment', async (t) => {
    const { sandbox, service } = await setup(t, { signedIn: [] });
    const repo = await sandbox.initRepo('api');
    await sandbox.setLocal(repo, 'remote.origin.url', 'https://github.com/acme/api.git');
    const work = await addAccount(service, workDraft);
    await service.addProjects([repo]);

    const result = await service.assignProject(path.resolve(repo), work.id);

    assert.deepEqual(result.snapshot.projects[0].warnings, [{ code: 'warning.notSignedIn', params: { user: 'ada-work' } }]);
  });

  it('flags a project whose config was edited behind its back, before any other warning', async (t) => {
    const { sandbox, service } = await setup(t, { signedIn: [] });
    const repo = await sandbox.initRepo('api');
    await sandbox.setLocal(repo, 'remote.origin.url', 'https://github.com/acme/api.git');
    const work = await addAccount(service, workDraft);
    await service.addProjects([repo]);
    await service.assignProject(path.resolve(repo), work.id);
    await sandbox.setLocal(repo, 'user.email', 'someone-else@example.com');

    const [project] = (await service.getSnapshot()).projects;

    assert.deepEqual(project.assignment, { kind: 'drifted', accountId: work.id });
    assert.deepEqual(project.warnings, [
      { code: 'warning.drifted' },
      { code: 'warning.notSignedIn', params: { user: 'ada-work' } },
    ]);
  });
});

describe('ordering projects', () => {
  async function tracked(t, names) {
    const context = await setup(t);
    const repos = [];
    for (const name of names) repos.push(path.resolve(await context.sandbox.initRepo(name)));
    await context.service.addProjects(repos);
    return { ...context, repos };
  }
  const names = (snapshot) => snapshot.projects.map((project) => project.name);

  it('moves a project to the place it was dropped on', async (t) => {
    const { service, repos } = await tracked(t, ['api', 'website', 'docs']);

    const result = await service.moveProject(repos[2], 0);

    assert.equal(result.ok, true);
    assert.deepEqual(names(result.snapshot), ['docs', 'api', 'website']);
  });

  it('moves a project down as well as up', async (t) => {
    const { service, repos } = await tracked(t, ['api', 'website', 'docs']);

    const result = await service.moveProject(repos[0], 1);

    assert.deepEqual(names(result.snapshot), ['website', 'api', 'docs']);
  });

  it('keeps the order after a restart', async (t) => {
    const { service, createService, repos } = await tracked(t, ['api', 'website', 'docs']);
    await service.moveProject(repos[0], 2);

    assert.deepEqual(names(await createService().getSnapshot()), ['website', 'docs', 'api']);
  });

  it('stops at the ends of the list when the place is out of range', async (t) => {
    const { service, repos } = await tracked(t, ['api', 'website', 'docs']);

    const past = await service.moveProject(repos[0], 99);
    const before = await service.moveProject(repos[2], -5);

    assert.deepEqual(names(past.snapshot), ['website', 'docs', 'api']);
    assert.deepEqual(names(before.snapshot), ['docs', 'website', 'api']);
  });

  // The page can only send a position in the list, so anything else is a bug, not something to explain.
  it('rejects a place that is not a whole number', async (t) => {
    const { service, repos } = await tracked(t, ['api', 'website']);

    await assert.rejects(() => service.moveProject(repos[1], 'first'), TypeError);
    assert.deepEqual(names(await service.getSnapshot()), ['api', 'website']);
  });

  it('refuses a project it does not track', async (t) => {
    const { sandbox, service } = await tracked(t, ['api', 'website']);
    const stranger = path.resolve(await sandbox.initRepo('stranger'));

    const result = await service.moveProject(stranger, 0);

    assert.deepEqual(result, { ok: false, error: { code: 'project.untracked' } });
    assert.deepEqual(names(await service.getSnapshot()), ['api', 'website']);
  });

  it('changes nothing in the git config of the projects', async (t) => {
    const { sandbox, service, repos } = await tracked(t, ['api', 'website']);
    const work = await addAccount(service, workDraft);
    await service.assignProject(repos[0], work.id);

    await service.moveProject(repos[0], 1);

    assert.equal(await sandbox.getLocal(repos[0], 'user.email'), 'ada@company.example');
    assert.equal(await sandbox.getLocal(repos[1], 'user.email'), null);
  });
});

describe('accounts', () => {
  it('rejects an invalid account and explains each problem', async (t) => {
    const { service } = await setup(t);

    const result = await service.saveAccount({ ...workDraft, gitEmail: 'nope' });

    assert.deepEqual(result, { ok: false, errors: { gitEmail: { code: 'gitEmail.invalid' } } });
    assert.equal((await service.getSnapshot()).accounts.length, 0);
  });

  it('rejects an SSH key that does not exist on disk', async (t) => {
    const { service } = await setup(t);

    const result = await service.saveAccount({ ...workDraft, sshKeyPath: '/home/ada/.ssh/missing' });

    assert.deepEqual(result, { ok: false, errors: { sshKeyPath: { code: 'sshKeyPath.missing' } } });
  });

  it('accepts an SSH key that exists on disk', async (t) => {
    const { service } = await setup(t, { existingFiles: ['/home/ada/.ssh/id_work'] });

    const result = await service.saveAccount({ ...workDraft, sshKeyPath: '/home/ada/.ssh/id_work' });

    assert.equal(result.ok, true);
    assert.equal(result.snapshot.accounts[0].sshKeyPath, '/home/ada/.ssh/id_work');
  });

  it('shows which accounts are signed in to the credential manager', async (t) => {
    const { service } = await setup(t, { signedIn: ['Ada-Work'] });
    await addAccount(service, workDraft);
    await addAccount(service, personalDraft);

    const { accounts } = await service.getSnapshot();

    assert.deepEqual(
      accounts.map((account) => [account.label, account.signedIn]),
      [['Work', true], ['Personal', false]],
    );
  });

  it('does not guess the sign-in state when the credential manager is unavailable', async (t) => {
    const { service } = await setup(t, { gcmAvailable: false });
    await addAccount(service, workDraft);

    const snapshot = await service.getSnapshot();

    assert.equal(snapshot.accounts[0].signedIn, null);
    assert.equal(snapshot.environment.credentialManager.available, false);
  });

  it('signs in with the username of the account', async (t) => {
    const { service, signIns } = await setup(t, { signedIn: [] });
    const personal = await addAccount(service, personalDraft);

    const result = await service.signIn(personal.id);

    assert.equal(result.ok, true);
    assert.deepEqual(signIns, ['ada-personal']);
    assert.equal(result.snapshot.accounts[0].signedIn, true);
    assert.deepEqual(result.notices, [{ code: 'signIn.done', params: { user: 'ada-personal' } }]);
  });

  it('points out a sign-in that ended up in another GitHub account', async (t) => {
    const { service } = await setup(t, { signedIn: [], signInOutcome: 'someone-else' });
    const personal = await addAccount(service, personalDraft);

    const result = await service.signIn(personal.id);

    assert.equal(result.ok, true);
    assert.equal(result.snapshot.accounts[0].signedIn, false);
    assert.deepEqual(result.notices, [{ code: 'signIn.otherAccount', params: { user: 'ada-personal' } }]);
  });

  it('passes on why a sign-in did not finish', async (t) => {
    const { service } = await setup(t, { signedIn: [], signInOutcome: 'failed' });
    const personal = await addAccount(service, personalDraft);

    const result = await service.signIn(personal.id);

    assert.deepEqual(result, {
      ok: false,
      error: { code: 'signIn.failedBecause', params: { detail: 'fatal: User cancelled dialog.' } },
    });
  });

  it('says a sign-in did not finish even when the credential manager gave no reason', async (t) => {
    const { service } = await setup(t, { signedIn: [], signInOutcome: 'gave-up' });
    const personal = await addAccount(service, personalDraft);

    assert.deepEqual(await service.signIn(personal.id), { ok: false, error: { code: 'signIn.failed' } });
  });

  it('refuses to sign in to an account that does not exist', async (t) => {
    const { service, signIns } = await setup(t);

    assert.deepEqual(await service.signIn('missing-account'), { ok: false, error: { code: 'account.missing' } });
    assert.deepEqual(signIns, []);
  });

  it('applies an edited account to the projects that use it', async (t) => {
    const { sandbox, service } = await setup(t);
    const assigned = await sandbox.initRepo('api');
    const other = await sandbox.initRepo('website');
    const work = await addAccount(service, workDraft);
    const personal = await addAccount(service, personalDraft);
    await service.addProjects([assigned, other]);
    await service.assignProject(path.resolve(assigned), work.id);
    await service.assignProject(path.resolve(other), personal.id);

    const result = await service.saveAccount({ ...workDraft, id: work.id, gitEmail: 'ada@new-company.example' });

    assert.equal(result.ok, true);
    assert.equal(await sandbox.getLocal(assigned, 'user.email'), 'ada@new-company.example');
    assert.equal(await sandbox.getLocal(other, 'user.email'), 'ada@example.com');
  });

  it('keeps an account that projects still use', async (t) => {
    const { sandbox, service } = await setup(t);
    const repo = await sandbox.initRepo('api');
    const work = await addAccount(service, workDraft);
    await service.addProjects([repo]);
    await service.assignProject(path.resolve(repo), work.id);

    const result = await service.removeAccount(work.id);

    assert.deepEqual(result, { ok: false, error: { code: 'account.inUse', params: { count: 1 } } });
    assert.equal((await service.getSnapshot()).accounts.length, 1);
  });

  it('refuses to remove an account that is already gone', async (t) => {
    const { service } = await setup(t);

    assert.deepEqual(await service.removeAccount('missing-account'), { ok: false, error: { code: 'account.missing' } });
  });

  it('removes an account that no project uses', async (t) => {
    const { service } = await setup(t);
    const work = await addAccount(service, workDraft);

    const result = await service.removeAccount(work.id);

    assert.equal(result.ok, true);
    assert.equal(result.snapshot.accounts.length, 0);
  });
});

// Folder rules go through the real git, so these use the path conventions of the platform they run on.
describe('folder rules', () => {
  const onThisPlatform = { platform: process.platform };

  it('uses the account for every repository inside the folder, including later ones', async (t) => {
    const { sandbox, service } = await setup(t, onThisPlatform);
    const folder = await sandbox.makeDir('work');
    const work = await addAccount(service, workDraft);

    const result = await service.addFolderRule(work.id, folder);

    assert.equal(result.ok, true);
    assert.deepEqual(result.snapshot.accounts[0].folders, [{ path: folder, displayPath: `~${path.sep}work` }]);
    const later = await sandbox.initRepo(path.join('work', 'new-clone'));
    assert.equal(await resolvedValue(sandbox, later, 'user.email'), 'ada@company.example');
    assert.equal(await resolvedValue(sandbox, later, 'credential.https://github.com.username'), 'ada-work');
  });

  it('shows that a project follows a folder rule', async (t) => {
    const { sandbox, service } = await setup(t, onThisPlatform);
    const folder = await sandbox.makeDir('work');
    const repo = await sandbox.initRepo(path.join('work', 'api'));
    const work = await addAccount(service, workDraft);
    await service.addProjects([repo]);

    const result = await service.addFolderRule(work.id, folder);

    const [project] = result.snapshot.projects;
    assert.deepEqual(project.assignment, { kind: 'unset', accountId: null });
    assert.deepEqual(project.inherited, { accountId: work.id, via: 'folder' });
    assert.deepEqual(project.author.email, { value: 'ada@company.example', scope: 'global', viaRule: 'folder' });
    assert.equal(result.snapshot.accounts[0].projectCount, 0);
  });

  it('warns about a project that follows a rule but would push with another key', async (t) => {
    const { sandbox, service } = await setup(t, onThisPlatform);
    const folder = await sandbox.makeDir('work');
    const repo = await sandbox.initRepo(path.join('work', 'api'));
    await sandbox.setLocal(repo, 'remote.origin.url', 'git@github.com:acme/api.git');
    const work = await addAccount(service, workDraft);
    await service.addProjects([repo]);

    const result = await service.addFolderRule(work.id, folder);

    assert.deepEqual(result.snapshot.projects[0].warnings, [{ code: 'warning.sshNoKey', params: { remote: 'origin' } }]);
  });

  it('lets a project inside the folder keep its own account', async (t) => {
    const { sandbox, service } = await setup(t, onThisPlatform);
    const folder = await sandbox.makeDir('work');
    const repo = await sandbox.initRepo(path.join('work', 'side-project'));
    const work = await addAccount(service, workDraft);
    const personal = await addAccount(service, personalDraft);
    await service.addProjects([repo]);
    await service.addFolderRule(work.id, folder);

    const result = await service.assignProject(path.resolve(repo), personal.id);

    const [project] = result.snapshot.projects;
    assert.deepEqual(project.assignment, { kind: 'account', accountId: personal.id });
    assert.equal(project.inherited, null);
    assert.equal(await resolvedValue(sandbox, repo, 'user.email'), 'ada@example.com');
  });

  it('keeps the SSH key of a folder rule out of a project assigned to an account without a key', async (t) => {
    const keyPath = 'C:\\Users\\ada\\.ssh\\id_work';
    const { sandbox, service } = await setup(t, { ...onThisPlatform, existingFiles: [keyPath] });
    const folder = await sandbox.makeDir('work');
    const repo = await sandbox.initRepo(path.join('work', 'side-project'));
    const work = await addAccount(service, { ...workDraft, sshKeyPath: keyPath });
    const personal = await addAccount(service, personalDraft);
    await service.addProjects([repo]);
    await service.addFolderRule(work.id, folder);
    assert.match(await resolvedValue(sandbox, repo, 'core.sshCommand'), /id_work/);

    await service.assignProject(path.resolve(repo), personal.id);

    assert.equal(await resolvedValue(sandbox, repo, 'core.sshCommand'), 'ssh');
  });

  it('pins the SSH command the person already uses instead of plain ssh', async (t) => {
    const { sandbox, service } = await setup(t, onThisPlatform);
    await sandbox.setGlobal('core.sshCommand', 'C:/Windows/System32/OpenSSH/ssh.exe');
    const repo = await sandbox.initRepo('api');
    const personal = await addAccount(service, personalDraft);
    await service.addProjects([repo]);

    const result = await service.assignProject(path.resolve(repo), personal.id);

    assert.equal(await sandbox.getLocal(repo, 'core.sshCommand'), 'C:/Windows/System32/OpenSSH/ssh.exe');
    assert.deepEqual(result.snapshot.projects[0].assignment, { kind: 'account', accountId: personal.id });
  });

  it('applies an edited account to its folders', async (t) => {
    const { sandbox, service } = await setup(t, onThisPlatform);
    const folder = await sandbox.makeDir('work');
    const repo = await sandbox.initRepo(path.join('work', 'api'));
    const work = await addAccount(service, workDraft);
    await service.addFolderRule(work.id, folder);

    await service.saveAccount({ ...workDraft, id: work.id, gitEmail: 'ada@new-company.example' });

    assert.equal(await resolvedValue(sandbox, repo, 'user.email'), 'ada@new-company.example');
  });

  it('refuses a second rule for a folder that already has one', async (t) => {
    const { sandbox, service } = await setup(t, onThisPlatform);
    const folder = await sandbox.makeDir('work');
    const work = await addAccount(service, workDraft);
    const personal = await addAccount(service, personalDraft);
    await service.addFolderRule(work.id, folder);

    const result = await service.addFolderRule(personal.id, folder);

    assert.deepEqual(result, {
      ok: false,
      error: { code: 'folder.taken', params: { folder: `~${path.sep}work`, account: 'Work' } },
    });
  });

  it('refuses a folder already covered by a rule whose account is gone', async (t) => {
    const { sandbox, service, store } = await setup(t, onThisPlatform);
    const folder = await sandbox.makeDir('work');
    const work = await addAccount(service, workDraft);
    await service.addFolderRule(work.id, folder);
    await store.save({ version: 1, accounts: [], projects: [] });
    const personal = await addAccount(service, personalDraft);

    const result = await service.addFolderRule(personal.id, folder);

    assert.deepEqual(result, {
      ok: false,
      error: { code: 'folder.takenByStray', params: { folder: `~${path.sep}work` } },
    });
  });

  it('asks for a folder when none was chosen', async (t) => {
    const { service } = await setup(t, onThisPlatform);
    const work = await addAccount(service, workDraft);

    assert.deepEqual(await service.addFolderRule(work.id, ' '), { ok: false, error: { code: 'folder.required' } });
  });

  it('refuses a folder that does not exist', async (t) => {
    const { sandbox, service } = await setup(t, onThisPlatform);
    const work = await addAccount(service, workDraft);

    const result = await service.addFolderRule(work.id, path.join(sandbox.root, 'nowhere'));

    assert.deepEqual(result, {
      ok: false,
      error: { code: 'folder.missing', params: { folder: `~${path.sep}nowhere` } },
    });
    assert.doesNotMatch(await sandbox.readGlobalFile(), /includeif/i);
  });

  it('refuses a folder whose name git would read as a pattern', async (t) => {
    const { sandbox, service } = await setup(t, onThisPlatform);
    const folder = await sandbox.makeDir('[archive]');
    const work = await addAccount(service, workDraft);

    const result = await service.addFolderRule(work.id, folder);

    assert.deepEqual(result, {
      ok: false,
      error: { code: 'folder.pattern', params: { folder: `~${path.sep}[archive]` } },
    });
    assert.doesNotMatch(await sandbox.readGlobalFile(), /includeif/i);
  });

  it('keeps an account that still has folder rules', async (t) => {
    const { sandbox, service } = await setup(t, onThisPlatform);
    const folder = await sandbox.makeDir('work');
    const work = await addAccount(service, workDraft);
    await service.addFolderRule(work.id, folder);

    const result = await service.removeAccount(work.id);

    assert.deepEqual(result, { ok: false, error: { code: 'account.hasRules', params: { count: 1 } } });
  });

  it('removes a folder rule and leaves no trace in the global config', async (t) => {
    const { sandbox, service } = await setup(t, onThisPlatform);
    await sandbox.setGlobal('user.email', 'global@example.com');
    const before = await sandbox.readGlobalFile();
    const folder = await sandbox.makeDir('work');
    const repo = await sandbox.initRepo(path.join('work', 'api'));
    const work = await addAccount(service, workDraft);
    await service.addFolderRule(work.id, folder);

    const result = await service.removeFolderRule(folder);

    assert.deepEqual(result.snapshot.accounts[0].folders, []);
    assert.equal(await resolvedValue(sandbox, repo, 'user.email'), 'global@example.com');
    assert.equal(await sandbox.readGlobalFile(), before);
  });

  it('still lists a rule whose account is gone, so it can be removed', async (t) => {
    const { sandbox, service, store } = await setup(t, onThisPlatform);
    const folder = await sandbox.makeDir('work');
    const work = await addAccount(service, workDraft);
    await service.addFolderRule(work.id, folder);
    await store.save({ version: 1, accounts: [], projects: [] });

    const stray = (await service.getSnapshot()).strayFolderRules;
    const result = await service.removeFolderRule(folder);

    assert.deepEqual(stray, [{ path: folder, displayPath: `~${path.sep}work` }]);
    assert.deepEqual(result.snapshot.strayFolderRules, []);
  });
});

describe('owner rules', () => {
  const onThisPlatform = { platform: process.platform };

  async function repoWithRemote(sandbox, name, url) {
    const repo = await sandbox.initRepo(name);
    await sandbox.setLocal(repo, 'remote.origin.url', url);
    return repo;
  }

  it('uses the account for repositories of that owner, wherever they are', async (t) => {
    const { sandbox, service } = await setup(t, onThisPlatform);
    const repo = await repoWithRemote(sandbox, 'api', 'git@github.com:Acme/api.git');
    const work = await addAccount(service, workDraft);

    const result = await service.addOwnerRule(work.id, 'acme');

    assert.equal(result.ok, true);
    assert.deepEqual(result.snapshot.accounts[0].owners, ['acme']);
    assert.equal(await resolvedValue(sandbox, repo, 'user.email'), 'ada@company.example');
    assert.equal(await resolvedValue(sandbox, repo, 'credential.https://github.com.username'), 'ada-work');
  });

  it('accepts a repository URL or a handle in place of the owner name', async (t) => {
    const { service } = await setup(t, onThisPlatform);
    const work = await addAccount(service, workDraft);

    await service.addOwnerRule(work.id, 'https://github.com/Acme/api.git');
    await service.addOwnerRule(work.id, 'git@github.com:acme-labs/tools.git');
    const result = await service.addOwnerRule(work.id, ' @ada-work ');

    assert.deepEqual(result.snapshot.accounts[0].owners, ['acme', 'acme-labs', 'ada-work']);
  });

  it('shows that a project follows an owner rule', async (t) => {
    const { sandbox, service } = await setup(t, onThisPlatform);
    const repo = await repoWithRemote(sandbox, 'api', 'https://github.com/acme/api.git');
    const work = await addAccount(service, workDraft);
    await service.addProjects([repo]);

    const result = await service.addOwnerRule(work.id, 'acme');

    const [project] = result.snapshot.projects;
    assert.deepEqual(project.assignment, { kind: 'unset', accountId: null });
    assert.deepEqual(project.inherited, { accountId: work.id, via: 'owner' });
    assert.deepEqual(project.author.email, { value: 'ada@company.example', scope: 'global', viaRule: 'owner' });
  });

  it('lets the owner of the remote decide inside a folder that has its own rule', async (t) => {
    const { sandbox, service } = await setup(t, onThisPlatform);
    const folder = await sandbox.makeDir('work');
    const repo = await repoWithRemote(sandbox, path.join('work', 'dotfiles'), 'git@github.com:ada-personal/dotfiles.git');
    const work = await addAccount(service, workDraft);
    const personal = await addAccount(service, personalDraft);
    await service.addProjects([repo]);
    await service.addOwnerRule(personal.id, 'ada-personal');

    const result = await service.addFolderRule(work.id, folder);

    assert.deepEqual(result.snapshot.projects[0].inherited, { accountId: personal.id, via: 'owner' });
    assert.equal(await resolvedValue(sandbox, repo, 'user.email'), 'ada@example.com');
  });

  it('refuses a name that cannot be a GitHub user or organization', async (t) => {
    const { sandbox, service } = await setup(t, onThisPlatform);
    const work = await addAccount(service, workDraft);

    const result = await service.addOwnerRule(work.id, 'not a name/**');

    assert.deepEqual(result, { ok: false, errors: { owner: { code: 'owner.invalid' } } });
    assert.doesNotMatch(await sandbox.readGlobalFile(), /includeif/i);
  });

  it('refuses a second rule for an owner that already has one', async (t) => {
    const { service } = await setup(t, onThisPlatform);
    const work = await addAccount(service, workDraft);
    const personal = await addAccount(service, personalDraft);
    await service.addOwnerRule(work.id, 'acme');

    const result = await service.addOwnerRule(personal.id, 'ACME');

    assert.deepEqual(result, {
      ok: false,
      errors: { owner: { code: 'owner.taken', params: { owner: 'acme', account: 'Work' } } },
    });
  });

  it('refuses an owner already covered by a rule whose account is gone', async (t) => {
    const { service, store } = await setup(t, onThisPlatform);
    const work = await addAccount(service, workDraft);
    await service.addOwnerRule(work.id, 'acme');
    await store.save({ version: 1, accounts: [], projects: [] });
    const personal = await addAccount(service, personalDraft);

    const result = await service.addOwnerRule(personal.id, 'acme');

    assert.deepEqual(result, {
      ok: false,
      errors: { owner: { code: 'owner.takenByStray', params: { owner: 'acme' } } },
    });
  });

  it('counts folder and owner rules together when they keep an account from being removed', async (t) => {
    const { sandbox, service } = await setup(t, onThisPlatform);
    const folder = await sandbox.makeDir('work');
    const work = await addAccount(service, workDraft);
    await service.addOwnerRule(work.id, 'acme');
    await service.addOwnerRule(work.id, 'acme-labs');
    await service.addFolderRule(work.id, folder);

    const result = await service.removeAccount(work.id);

    assert.deepEqual(result, { ok: false, error: { code: 'account.hasRules', params: { count: 3 } } });
  });

  it('removes an owner rule and leaves no trace in the global config', async (t) => {
    const { sandbox, service } = await setup(t, onThisPlatform);
    await sandbox.setGlobal('user.email', 'global@example.com');
    const before = await sandbox.readGlobalFile();
    const repo = await repoWithRemote(sandbox, 'api', 'git@github.com:acme/api.git');
    const work = await addAccount(service, workDraft);
    await service.addOwnerRule(work.id, 'acme');

    const result = await service.removeOwnerRule('Acme');

    assert.deepEqual(result.snapshot.accounts[0].owners, []);
    assert.equal(await resolvedValue(sandbox, repo, 'user.email'), 'global@example.com');
    assert.equal(await sandbox.readGlobalFile(), before);
  });

  it('still lists an owner rule whose account is gone, so it can be removed', async (t) => {
    const { service, store } = await setup(t, onThisPlatform);
    const work = await addAccount(service, workDraft);
    await service.addOwnerRule(work.id, 'acme');
    await store.save({ version: 1, accounts: [], projects: [] });

    const stray = (await service.getSnapshot()).strayOwnerRules;
    const result = await service.removeOwnerRule('acme');

    assert.deepEqual(stray, ['acme']);
    assert.deepEqual(result.snapshot.strayOwnerRules, []);
  });
});

describe('SSH keys', () => {
  it('creates a key named after the account label', async (t) => {
    const { service, keyRequests, sshDir } = await setup(t);

    const result = await service.generateSshKey({ label: 'Work Laptop', gitEmail: 'ada@company.example' });

    const keyPath = path.join(sshDir, 'id_ed25519_work-laptop');
    assert.deepEqual(result, { ok: true, path: keyPath, publicKey: 'ssh-ed25519 AAAAexample id_ed25519_work-laptop' });
    assert.deepEqual(keyRequests, [{ keyPath, comment: 'ada@company.example' }]);
  });

  it('asks for a label before creating a key', async (t) => {
    const { service, keyRequests } = await setup(t);

    const result = await service.generateSshKey({ label: ' ', gitEmail: 'ada@company.example' });

    assert.deepEqual(result, { ok: false, errors: { label: { code: 'sshKey.labelRequired' } } });
    assert.deepEqual(keyRequests, []);
  });

  it('never replaces a key that already exists', async (t) => {
    const { service, keyRequests, sshDir, existingFiles } = await setup(t);
    existingFiles.push(path.join(sshDir, 'id_ed25519_work.pub'));

    const result = await service.generateSshKey({ label: 'Work', gitEmail: 'ada@company.example' });

    assert.deepEqual(result, {
      ok: false,
      errors: { sshKeyPath: { code: 'sshKey.exists', params: { name: 'id_ed25519_work' } } },
    });
    assert.deepEqual(keyRequests, []);
  });

  it('says so when ssh-keygen is missing', async (t) => {
    const { service } = await setup(t, { keygenResult: { ok: false, reason: 'not-found' } });

    const result = await service.generateSshKey({ label: 'Work', gitEmail: 'ada@company.example' });

    assert.deepEqual(result, { ok: false, errors: { sshKeyPath: { code: 'sshKey.keygenMissing' } } });
  });

  it('says so when the key could not be created', async (t) => {
    const { service } = await setup(t, { keygenResult: { ok: false, reason: 'failed' } });

    const result = await service.generateSshKey({ label: 'Work', gitEmail: 'ada@company.example' });

    assert.deepEqual(result, { ok: false, errors: { sshKeyPath: { code: 'sshKey.failed' } } });
  });

  it('reads the public key that belongs to a private key', async (t) => {
    const { service, sshDir } = await setup(t);

    const result = await service.readPublicKey(path.join(sshDir, 'id_ed25519_work'));

    assert.deepEqual(result, { ok: true, publicKey: 'ssh-ed25519 AAAAexample id_ed25519_work' });
  });
});

describe('environment', () => {
  it('reports the git version in use', async (t) => {
    const { service } = await setup(t);

    const snapshot = await service.getSnapshot();

    assert.match(snapshot.environment.gitVersion, /^\d+\.\d+/);
  });

  it('reports the credential manager and its version', async (t) => {
    const { service } = await setup(t);

    const { credentialManager } = (await service.getSnapshot()).environment;

    assert.deepEqual(credentialManager, { available: true, accounts: ['ada-work'], version: '2.6.1' });
  });
});

describe('settings', () => {
  it('start in the language of the system, following its theme, with the tour still to see', async (t) => {
    const { service } = await setup(t, { defaultLanguage: 'es' });

    const expected = { language: 'es', theme: 'system', tourSeen: false };
    assert.deepEqual((await service.getSnapshot()).settings, expected);
    assert.deepEqual(await service.getSettings(), expected);
  });

  it('change one at a time and keep the others', async (t) => {
    const { service } = await setup(t);
    await service.saveSettings({ theme: 'dark' });

    const result = await service.saveSettings({ language: 'es' });

    assert.deepEqual(result, { ok: true, settings: { language: 'es', theme: 'dark', tourSeen: false } });
    assert.deepEqual((await service.getSnapshot()).settings, result.settings);
  });

  it('are remembered after a restart, whatever the system language is by then', async (t) => {
    const { service, createService } = await setup(t, { defaultLanguage: 'es' });
    await service.saveSettings({ language: 'en', theme: 'light', tourSeen: true });

    assert.deepEqual(await createService().getSettings(), { language: 'en', theme: 'light', tourSeen: true });
  });

  it('leave accounts and projects as they are', async (t) => {
    const { sandbox, service } = await setup(t);
    const repo = await sandbox.initRepo('api');
    await addAccount(service, workDraft);
    await service.addProjects([repo]);

    await service.saveSettings({ theme: 'dark' });

    const snapshot = await service.getSnapshot();
    assert.deepEqual(snapshot.accounts.map((account) => account.label), ['Work']);
    assert.deepEqual(snapshot.projects.map((project) => project.name), ['api']);
  });

  it('survive saving an account or a project', async (t) => {
    const { sandbox, service } = await setup(t);
    await service.saveSettings({ language: 'es', theme: 'dark' });

    await addAccount(service, workDraft);
    await service.addProjects([await sandbox.initRepo('api')]);

    assert.deepEqual(await service.getSettings(), { language: 'es', theme: 'dark', tourSeen: false });
  });

  // The page shows the last answer it got. A refresh asked for before a change must not answer after it.
  it('are never reported older than they are: reads and changes answer in the order they were asked', async (t) => {
    const { service } = await setup(t);
    const answers = [];

    await Promise.all([
      service.getSnapshot().then((snapshot) => answers.push(`read ${snapshot.settings.theme}`)),
      service.saveSettings({ theme: 'dark' }).then(() => answers.push('saved dark')),
      service.getSnapshot().then((snapshot) => answers.push(`read ${snapshot.settings.theme}`)),
    ]);

    assert.deepEqual(answers, ['read system', 'saved dark', 'read dark']);
  });

  // The page only offers values that exist, so anything else is a bug, not something to explain.
  it('reject a value the app does not have', async (t) => {
    const { service } = await setup(t);

    await assert.rejects(() => service.saveSettings({ language: 'fr' }), TypeError);
    assert.equal((await service.getSettings()).language, 'en');
  });
});
