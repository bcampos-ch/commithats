import assert from 'node:assert/strict';
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
    existingFiles = [],
    keygenResult = { ok: true },
    platform = 'linux',
  } = {},
) {
  const sandbox = await createSandbox(t);
  const signIns = [];
  const gcm = {
    getStatus: async () => ({ available: gcmAvailable, accounts: gcmAvailable ? [...signedIn] : [] }),
    signIn: async (username) => {
      signIns.push(username);
      signedIn.push(username);
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
    assert.equal(result.notices.length, 1);
    assert.match(result.notices[0], /"notes" isn't a git repository/);
    assert.match(result.notices[0], /"Add folder"/, 'it points to the way to cover a folder of future clones');
  });

  it('does not track the same project twice', async (t) => {
    const { sandbox, service } = await setup(t);
    const repo = await sandbox.initRepo('api');
    await service.addProjects([repo]);

    const result = await service.addProjects([repo]);

    assert.equal(result.snapshot.projects.length, 1);
    assert.match(result.notices[0], /already in the list/);
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

    assert.equal(result.ok, false);
    assert.equal(await sandbox.getLocal(repo, 'user.email'), null);
  });

  it('refuses an account that does not exist', async (t) => {
    const { sandbox, service } = await setup(t);
    const repo = await sandbox.initRepo('api');
    await service.addProjects([repo]);

    const result = await service.assignProject(path.resolve(repo), 'missing-account');

    assert.equal(result.ok, false);
  });

  it('warns about what would make git ignore the assignment', async (t) => {
    const { sandbox, service } = await setup(t, { signedIn: [] });
    const repo = await sandbox.initRepo('api');
    await sandbox.setLocal(repo, 'remote.origin.url', 'https://github.com/acme/api.git');
    const work = await addAccount(service, workDraft);
    await service.addProjects([repo]);

    const result = await service.assignProject(path.resolve(repo), work.id);

    assert.equal(result.snapshot.projects[0].warnings.length, 1);
    assert.match(result.snapshot.projects[0].warnings[0], /not signed in as "ada-work"/);
  });
});

describe('accounts', () => {
  it('rejects an invalid account and explains each problem', async (t) => {
    const { service } = await setup(t);

    const result = await service.saveAccount({ ...workDraft, gitEmail: 'nope' });

    assert.equal(result.ok, false);
    assert.ok(result.errors.gitEmail);
    assert.equal((await service.getSnapshot()).accounts.length, 0);
  });

  it('rejects an SSH key that does not exist on disk', async (t) => {
    const { service } = await setup(t);

    const result = await service.saveAccount({ ...workDraft, sshKeyPath: '/home/ada/.ssh/missing' });

    assert.equal(result.ok, false);
    assert.ok(result.errors.sshKeyPath);
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

    assert.equal(result.ok, false);
    assert.match(result.error, /1 project/);
    assert.equal((await service.getSnapshot()).accounts.length, 1);
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

    assert.match(result.snapshot.projects[0].warnings[0], /uses SSH and this account has no SSH key/);
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

    assert.equal(result.ok, false);
    assert.match(result.error, /already uses Work/);
  });

  it('refuses a folder that does not exist', async (t) => {
    const { sandbox, service } = await setup(t, onThisPlatform);
    const work = await addAccount(service, workDraft);

    const result = await service.addFolderRule(work.id, path.join(sandbox.root, 'nowhere'));

    assert.equal(result.ok, false);
    assert.doesNotMatch(await sandbox.readGlobalFile(), /includeif/i);
  });

  it('refuses a folder whose name git would read as a pattern', async (t) => {
    const { sandbox, service } = await setup(t, onThisPlatform);
    const folder = await sandbox.makeDir('[archive]');
    const work = await addAccount(service, workDraft);

    const result = await service.addFolderRule(work.id, folder);

    assert.equal(result.ok, false);
    assert.doesNotMatch(await sandbox.readGlobalFile(), /includeif/i);
  });

  it('keeps an account that still has folder rules', async (t) => {
    const { sandbox, service } = await setup(t, onThisPlatform);
    const folder = await sandbox.makeDir('work');
    const work = await addAccount(service, workDraft);
    await service.addFolderRule(work.id, folder);

    const result = await service.removeAccount(work.id);

    assert.equal(result.ok, false);
    assert.match(result.error, /1 folder/);
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

    assert.equal(result.ok, false);
    assert.ok(result.errors.owner);
    assert.doesNotMatch(await sandbox.readGlobalFile(), /includeif/i);
  });

  it('refuses a second rule for an owner that already has one', async (t) => {
    const { service } = await setup(t, onThisPlatform);
    const work = await addAccount(service, workDraft);
    const personal = await addAccount(service, personalDraft);
    await service.addOwnerRule(work.id, 'acme');

    const result = await service.addOwnerRule(personal.id, 'ACME');

    assert.equal(result.ok, false);
    assert.match(result.errors.owner, /already uses Work/);
  });

  it('keeps an account that still has owner rules', async (t) => {
    const { service } = await setup(t, onThisPlatform);
    const work = await addAccount(service, workDraft);
    await service.addOwnerRule(work.id, 'acme');

    const result = await service.removeAccount(work.id);

    assert.equal(result.ok, false);
    assert.match(result.error, /1 owner rule/);
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

    assert.equal(result.ok, false);
    assert.ok(result.errors.label);
    assert.deepEqual(keyRequests, []);
  });

  it('never replaces a key that already exists', async (t) => {
    const { service, keyRequests, sshDir, existingFiles } = await setup(t);
    existingFiles.push(path.join(sshDir, 'id_ed25519_work.pub'));

    const result = await service.generateSshKey({ label: 'Work', gitEmail: 'ada@company.example' });

    assert.equal(result.ok, false);
    assert.match(result.errors.sshKeyPath, /already exists/);
    assert.deepEqual(keyRequests, []);
  });

  it('explains what to do when ssh-keygen is missing', async (t) => {
    const { service } = await setup(t, { keygenResult: { ok: false, reason: 'not-found' } });

    const result = await service.generateSshKey({ label: 'Work', gitEmail: 'ada@company.example' });

    assert.equal(result.ok, false);
    assert.match(result.errors.sshKeyPath, /ssh-keygen was not found/);
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
});
