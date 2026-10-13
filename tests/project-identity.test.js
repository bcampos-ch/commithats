import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { applyAccount, clearAccount, findRepositoryRoot, inspectProject } from '../src/core/project-identity.js';
import { createSandbox, personal, work } from './helpers/sandbox.js';

const plain = (entry) => entry && { value: entry.value, scope: entry.scope };

describe('inspectProject', () => {
  it('reports a folder that is not a git repository', async (t) => {
    const sandbox = await createSandbox(t);
    const folder = await sandbox.makeDir('plain-folder');

    const inspection = await inspectProject(sandbox.git, folder);

    assert.equal(inspection.isRepo, false);
    assert.equal(inspection.managedAccountId, null);
  });

  it('reports a folder that no longer exists', async (t) => {
    const sandbox = await createSandbox(t);

    const inspection = await inspectProject(sandbox.git, path.join(sandbox.root, 'deleted'));

    assert.equal(inspection.isRepo, false);
  });

  it('shows the identity a project inherits from the global config', async (t) => {
    const sandbox = await createSandbox(t);
    await sandbox.setGlobal('user.name', 'Global Person');
    await sandbox.setGlobal('user.email', 'global@example.com');
    const repo = await sandbox.initRepo('repo');

    const inspection = await inspectProject(sandbox.git, repo);

    assert.equal(inspection.isRepo, true);
    assert.deepEqual(plain(inspection.author.name), { value: 'Global Person', scope: 'global' });
    assert.deepEqual(plain(inspection.author.email), { value: 'global@example.com', scope: 'global' });
    assert.equal(inspection.pushAccount, null);
    assert.equal(inspection.managedAccountId, null);
  });

  it('says which file each answer comes from', async (t) => {
    const sandbox = await createSandbox(t);
    await sandbox.setGlobal('user.name', 'Global Person');
    const repo = await sandbox.initRepo('repo');
    await sandbox.setLocal(repo, 'user.email', 'handwritten@example.com');

    const inspection = await inspectProject(sandbox.git, repo);

    assert.match(inspection.author.name.origin, /^file:.*global\.gitconfig$/);
    assert.equal(inspection.author.email.origin, 'file:.git/config');
  });

  it('lists remotes without leaking credentials embedded in their URLs', async (t) => {
    const sandbox = await createSandbox(t);
    const repo = await sandbox.initRepo('repo');
    await sandbox.setLocal(repo, 'remote.origin.url', 'https://ada-work:s3cr3t-value@github.com/acme/api.git');

    const inspection = await inspectProject(sandbox.git, repo);

    assert.equal(inspection.remotes.length, 1);
    assert.equal(inspection.remotes[0].name, 'origin');
    assert.equal(inspection.remotes[0].hasEmbeddedSecret, true);
    assert.doesNotMatch(JSON.stringify(inspection), /s3cr3t-value/);
  });
});

describe('applyAccount', () => {
  it('writes the commit author and push account to the project, not to the global config', async (t) => {
    const sandbox = await createSandbox(t);
    await sandbox.setGlobal('user.name', 'Global Person');
    await sandbox.setGlobal('user.email', 'global@example.com');
    const repo = await sandbox.initRepo('repo');
    const globalBefore = await sandbox.readGlobalFile();

    await applyAccount(sandbox.git, repo, work);

    const inspection = await inspectProject(sandbox.git, repo);
    assert.deepEqual(plain(inspection.author.name), { value: 'Ada L.', scope: 'local' });
    assert.deepEqual(plain(inspection.author.email), { value: 'ada@company.example', scope: 'local' });
    assert.deepEqual(plain(inspection.pushAccount), { value: 'ada-work', scope: 'local' });
    assert.equal(inspection.managedAccountId, work.id);
    assert.equal(await sandbox.readGlobalFile(), globalBefore);
  });

  it('makes git ask the credential helper for the assigned account', async (t) => {
    const sandbox = await createSandbox(t);
    await sandbox.setGlobal('credential.helper', '!f() { test "$1" = get && echo password=not-a-real-secret; }; f');
    const repo = await sandbox.initRepo('repo');

    await applyAccount(sandbox.git, repo, work);

    const fill = spawnSync('git', ['credential', 'fill'], {
      cwd: repo,
      env: sandbox.env,
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
    });
    assert.match(fill.stdout, /^username=ada-work$/m);
  });

  it('leaves other projects on their own account', async (t) => {
    const sandbox = await createSandbox(t);
    const workRepo = await sandbox.initRepo('work-repo');
    const personalRepo = await sandbox.initRepo('personal-repo');

    await applyAccount(sandbox.git, workRepo, work);
    await applyAccount(sandbox.git, personalRepo, personal);

    assert.equal((await inspectProject(sandbox.git, workRepo)).pushAccount.value, 'ada-work');
    assert.equal((await inspectProject(sandbox.git, personalRepo)).pushAccount.value, 'ada-personal');
  });

  it('replaces the previous account when a project is switched', async (t) => {
    const sandbox = await createSandbox(t);
    const repo = await sandbox.initRepo('repo');

    await applyAccount(sandbox.git, repo, work);
    await applyAccount(sandbox.git, repo, personal);

    const inspection = await inspectProject(sandbox.git, repo);
    assert.equal(inspection.author.email.value, 'ada@example.com');
    assert.equal(inspection.pushAccount.value, 'ada-personal');
    assert.equal(inspection.managedAccountId, personal.id);
  });

  it('points SSH at the key of the account', async (t) => {
    const sandbox = await createSandbox(t);
    const repo = await sandbox.initRepo('repo');

    await applyAccount(sandbox.git, repo, { ...work, sshKeyPath: '/home/ada/.ssh/id_work' }, { platform: 'linux' });

    const inspection = await inspectProject(sandbox.git, repo);
    assert.deepEqual(plain(inspection.sshCommand), {
      value: "ssh -i '/home/ada/.ssh/id_work' -o IdentitiesOnly=yes",
      scope: 'local',
    });
  });

  it('goes back to plain ssh when the project moves to an account without a key', async (t) => {
    const sandbox = await createSandbox(t);
    const repo = await sandbox.initRepo('repo');
    await applyAccount(sandbox.git, repo, { ...work, sshKeyPath: '/home/ada/.ssh/id_work' }, { platform: 'linux' });

    await applyAccount(sandbox.git, repo, personal);

    assert.deepEqual(plain((await inspectProject(sandbox.git, repo)).sshCommand), { value: 'ssh', scope: 'local' });
  });

  it('pins the SSH command the person already uses for an account without a key', async (t) => {
    const sandbox = await createSandbox(t);
    const repo = await sandbox.initRepo('repo');
    const own = 'C:/Windows/System32/OpenSSH/ssh.exe';

    await applyAccount(sandbox.git, repo, personal, { baselineSshCommand: own });

    assert.equal(await sandbox.getLocal(repo, 'core.sshCommand'), own);
  });

  it('stores values that look like command-line options as plain values', async (t) => {
    const sandbox = await createSandbox(t);
    const repo = await sandbox.initRepo('repo');

    await applyAccount(sandbox.git, repo, { ...work, gitName: '--global' });

    assert.equal(await sandbox.getLocal(repo, 'user.name'), '--global');
  });

  it('refuses a folder that is not a git repository', async (t) => {
    const sandbox = await createSandbox(t);
    const folder = await sandbox.makeDir('plain-folder');

    await assert.rejects(() => applyAccount(sandbox.git, folder, work), { code: 'NOT_A_REPOSITORY' });
  });
});

describe('clearAccount', () => {
  it('removes what the app wrote so the project inherits the global config again', async (t) => {
    const sandbox = await createSandbox(t);
    await sandbox.setGlobal('user.email', 'global@example.com');
    const repo = await sandbox.initRepo('repo');
    await applyAccount(sandbox.git, repo, { ...work, sshKeyPath: '/home/ada/.ssh/id_work' }, { platform: 'linux' });

    await clearAccount(sandbox.git, repo);

    const inspection = await inspectProject(sandbox.git, repo);
    assert.deepEqual(plain(inspection.author.email), { value: 'global@example.com', scope: 'global' });
    assert.equal(inspection.author.name, null);
    assert.equal(inspection.pushAccount, null);
    assert.equal(inspection.sshCommand, null);
    assert.equal(inspection.managedAccountId, null);
    assert.equal(await sandbox.getLocal(repo, 'accountswitcher.account'), null);
  });

  it('restores the values the project had before the app managed it', async (t) => {
    const sandbox = await createSandbox(t);
    const repo = await sandbox.initRepo('repo');
    await sandbox.setLocal(repo, 'user.email', 'handwritten@example.com');
    await sandbox.setLocal(repo, 'core.sshCommand', 'ssh -i ~/.ssh/handwritten');
    await applyAccount(sandbox.git, repo, { ...work, sshKeyPath: '/home/ada/.ssh/id_work' }, { platform: 'linux' });
    await applyAccount(sandbox.git, repo, personal);

    await clearAccount(sandbox.git, repo);

    assert.equal(await sandbox.getLocal(repo, 'user.email'), 'handwritten@example.com');
    assert.equal(await sandbox.getLocal(repo, 'core.sshCommand'), 'ssh -i ~/.ssh/handwritten');
    assert.equal(await sandbox.getLocal(repo, 'user.name'), null);
  });

  it('puts a hand-written SSH command back after an account without a key is removed', async (t) => {
    const sandbox = await createSandbox(t);
    const repo = await sandbox.initRepo('repo');
    await sandbox.setLocal(repo, 'core.sshCommand', 'ssh -i ~/.ssh/handwritten');
    await applyAccount(sandbox.git, repo, personal);
    assert.equal(await sandbox.getLocal(repo, 'core.sshCommand'), 'ssh');

    await clearAccount(sandbox.git, repo);

    assert.equal(await sandbox.getLocal(repo, 'core.sshCommand'), 'ssh -i ~/.ssh/handwritten');
  });

  it('takes over the SSH command of a project assigned before the app pinned it', async (t) => {
    const sandbox = await createSandbox(t);
    const repo = await sandbox.initRepo('repo');
    await sandbox.setLocal(repo, 'accountswitcher.account', personal.id);
    await sandbox.setLocal(repo, 'core.sshCommand', 'ssh -i ~/.ssh/handwritten');

    await applyAccount(sandbox.git, repo, personal);
    await clearAccount(sandbox.git, repo);

    assert.equal(await sandbox.getLocal(repo, 'core.sshCommand'), 'ssh -i ~/.ssh/handwritten');
  });

  it('does not touch a project the app never managed', async (t) => {
    const sandbox = await createSandbox(t);
    const repo = await sandbox.initRepo('repo');
    await sandbox.setLocal(repo, 'user.email', 'handwritten@example.com');

    await clearAccount(sandbox.git, repo);

    assert.equal(await sandbox.getLocal(repo, 'user.email'), 'handwritten@example.com');
  });
});

describe('findRepositoryRoot', () => {
  it('finds the root of the repository that contains a subfolder', async (t) => {
    const sandbox = await createSandbox(t);
    const repo = await sandbox.initRepo('repo');
    const nested = await sandbox.makeDir(path.join('repo', 'packages', 'api'));

    assert.equal(await findRepositoryRoot(sandbox.git, nested), path.resolve(repo));
  });

  it('returns null outside a repository', async (t) => {
    const sandbox = await createSandbox(t);
    const folder = await sandbox.makeDir('plain-folder');

    assert.equal(await findRepositoryRoot(sandbox.git, folder), null);
  });
});
