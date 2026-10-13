import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createFiles } from '../src/adapters/files.js';
import { readOwnSshCommand } from '../src/core/git-config.js';
import { applyAccount } from '../src/core/project-identity.js';
import {
  folderFromCondition,
  gitdirCondition,
  hasPatternCharacters,
  includePathFor,
  listRules,
  ownerConditions,
  ownerFromCondition,
  saveRules,
  writeAccountInclude,
} from '../src/core/rules.js';
import { createSandbox, personal, work } from './helpers/sandbox.js';

describe('gitdirCondition', () => {
  it('matches everything inside a Windows folder, ignoring case', () => {
    assert.equal(gitdirCondition('C:\\Users\\ada\\work', 'win32'), 'gitdir/i:C:/Users/ada/work/');
  });

  it('matches everything inside a Linux folder, respecting case', () => {
    assert.equal(gitdirCondition('/home/ada/work/', 'linux'), 'gitdir:/home/ada/work/');
  });

  it('ignores case on macOS, where the default file system does too', () => {
    assert.equal(gitdirCondition('/Users/ada/work', 'darwin'), 'gitdir/i:/Users/ada/work/');
  });
});

describe('folderFromCondition', () => {
  it('reads back the folder of a Windows rule', () => {
    assert.equal(folderFromCondition('gitdir/i:C:/Users/ada/work/', 'win32'), 'C:\\Users\\ada\\work');
  });

  it('reads back the folder of a Linux rule', () => {
    assert.equal(folderFromCondition('gitdir:/home/ada/work/', 'linux'), '/home/ada/work');
  });

  it('has no folder for conditions that are not about the repository location', () => {
    assert.equal(folderFromCondition('onbranch:main', 'linux'), null);
    assert.equal(folderFromCondition('hasconfig:remote.*.url:https://github.com/**', 'linux'), null);
  });
});

describe('hasPatternCharacters', () => {
  it('flags folders whose name git would read as a pattern', () => {
    assert.equal(hasPatternCharacters('/home/ada/[archive]'), true);
    assert.equal(hasPatternCharacters('/home/ada/what?'), true);
    assert.equal(hasPatternCharacters('/home/ada/all*'), true);
  });

  it('accepts ordinary folders, including Windows ones', () => {
    assert.equal(hasPatternCharacters('C:\\Users\\Ada Lovelace\\work'), false);
    assert.equal(hasPatternCharacters('/home/ada/work'), false);
  });
});

describe('ownerConditions', () => {
  it('covers the URL forms a GitHub remote can take, whatever case the owner is written in', () => {
    assert.deepEqual(ownerConditions('Acme-2'), [
      'hasconfig:remote.*.url:git@github.com:[aA][cC][mM][eE]-2/**',
      'hasconfig:remote.*.url:ssh://git@github.com/[aA][cC][mM][eE]-2/**',
      'hasconfig:remote.*.url:https://github.com/[aA][cC][mM][eE]-2/**',
    ]);
  });
});

describe('ownerFromCondition', () => {
  it('reads back the owner from every form, in lowercase', () => {
    for (const condition of ownerConditions('Acme-2')) assert.equal(ownerFromCondition(condition), 'acme-2');
  });

  it('has no owner for other conditions, including broader remote patterns', () => {
    assert.equal(ownerFromCondition('gitdir:/home/ada/work/'), null);
    assert.equal(ownerFromCondition('hasconfig:remote.*.url:https://github.com/**'), null);
    assert.equal(ownerFromCondition('hasconfig:remote.*.url:https://gitlab.com/acme/**'), null);
  });
});

// These run the real git, so they use the conventions of the platform they run on.
describe('rules in the global config', () => {
  const platform = process.platform;
  const files = createFiles();
  const withKey = { ...work, sshKeyPath: 'C:\\Users\\ada\\.ssh\\id_work' };

  async function setup(t) {
    const sandbox = await createSandbox(t);
    await sandbox.setGlobal('user.name', 'Global Person');
    await sandbox.setGlobal('user.email', 'global@example.com');
    const includeDir = path.join(sandbox.root, 'app-data', 'accounts');
    const options = { includeDir, platform };

    const writeInclude = (account) =>
      writeAccountInclude(sandbox.git, files, includePathFor(includeDir, account.id), account, { platform });

    async function addFolderRule(folder, account) {
      await writeInclude(account);
      const rules = await listRules(sandbox.git, options);
      await saveRules(sandbox.git, { ...rules, folders: [...rules.folders, { folder, accountId: account.id }] }, options);
    }

    async function addOwnerRule(owner, account) {
      await writeInclude(account);
      const rules = await listRules(sandbox.git, options);
      await saveRules(sandbox.git, { ...rules, owners: [...rules.owners, { owner, accountId: account.id }] }, options);
    }

    async function repoWithRemote(name, url) {
      const repo = await sandbox.initRepo(name);
      await sandbox.setLocal(repo, 'remote.origin.url', url);
      return repo;
    }

    async function resolved(repo, key) {
      const result = await sandbox.git(['-C', repo, 'config', '--get', key]);
      return result.code === 0 ? result.stdout.replace(/\r?\n$/, '') : null;
    }

    return { sandbox, options, includeDir, writeInclude, addFolderRule, addOwnerRule, repoWithRemote, resolved };
  }

  describe('by folder', () => {
    it('makes every repository inside the folder use the account', async (t) => {
      const { sandbox, addFolderRule, resolved } = await setup(t);
      const workFolder = await sandbox.makeDir('work');
      const inside = await sandbox.initRepo(path.join('work', 'api'));
      const outside = await sandbox.initRepo('website');

      await addFolderRule(workFolder, withKey);

      assert.equal(await resolved(inside, 'user.email'), 'ada@company.example');
      assert.equal(await resolved(inside, 'user.name'), 'Ada L.');
      assert.equal(await resolved(inside, 'credential.https://github.com.username'), 'ada-work');
      assert.match(await resolved(inside, 'core.sshCommand'), /id_work' -o IdentitiesOnly=yes$/);
      assert.equal(await resolved(outside, 'user.email'), 'global@example.com');
    });

    it('covers a repository created after the rule', async (t) => {
      const { sandbox, addFolderRule, resolved } = await setup(t);
      const workFolder = await sandbox.makeDir('work');
      await addFolderRule(workFolder, work);

      const later = await sandbox.initRepo(path.join('work', 'deep', 'new-clone'));

      assert.equal(await resolved(later, 'user.email'), 'ada@company.example');
    });

    it('lets the most specific folder win, whichever rule was added first', async (t) => {
      const { sandbox, addFolderRule, resolved } = await setup(t);
      const code = await sandbox.makeDir('code');
      const client = await sandbox.makeDir(path.join('code', 'client'));
      const inClient = await sandbox.initRepo(path.join('code', 'client', 'api'));
      const inCode = await sandbox.initRepo(path.join('code', 'blog'));

      await addFolderRule(client, work);
      await addFolderRule(code, personal);

      assert.equal(await resolved(inClient, 'user.email'), 'ada@company.example');
      assert.equal(await resolved(inCode, 'user.email'), 'ada@example.com');
    });

    it('lets a project that was given its own account keep it', async (t) => {
      const { sandbox, addFolderRule, resolved } = await setup(t);
      const workFolder = await sandbox.makeDir('work');
      const repo = await sandbox.initRepo(path.join('work', 'side-project'));
      await addFolderRule(workFolder, withKey);

      await applyAccount(sandbox.git, repo, personal);

      assert.equal(await resolved(repo, 'user.email'), 'ada@example.com');
      assert.equal(await resolved(repo, 'core.sshCommand'), 'ssh', 'the key of the folder rule must not leak in');
    });
  });

  describe('by owner of the remote', () => {
    it('makes repositories of that owner use the account, wherever they are', async (t) => {
      const { addOwnerRule, repoWithRemote, resolved } = await setup(t);
      const overSsh = await repoWithRemote('a', 'git@github.com:acme/api.git');
      const overHttps = await repoWithRemote('b', 'https://github.com/acme/web.git');
      const overSshUrl = await repoWithRemote('c', 'ssh://git@github.com/acme/tools.git');
      const otherCase = await repoWithRemote('d', 'git@github.com:ACME/legacy.git');
      const someoneElse = await repoWithRemote('e', 'git@github.com:acme-labs/api.git');

      await addOwnerRule('acme', work);

      for (const repo of [overSsh, overHttps, overSshUrl, otherCase]) {
        assert.equal(await resolved(repo, 'user.email'), 'ada@company.example', repo);
      }
      assert.equal(await resolved(someoneElse, 'user.email'), 'global@example.com');
    });

    it('leaves a repository without a remote on the global identity', async (t) => {
      const { sandbox, addOwnerRule, resolved } = await setup(t);
      const repo = await sandbox.initRepo('no-remote');

      await addOwnerRule('acme', work);

      assert.equal(await resolved(repo, 'user.email'), 'global@example.com');
    });

    it('already applies while a repository is being cloned', async (t) => {
      const { sandbox, options, includeDir } = await setup(t);
      // A stand-in SSH command that reports it was used, so nothing goes over the network.
      const marker = 'echo used-the-rule >&2; exit 1 #';
      const include = includePathFor(includeDir, work.id);
      await files.ensureDir(includeDir);
      await sandbox.git(['config', '--file', include, 'core.sshCommand', marker]);
      await saveRules(sandbox.git, { folders: [], owners: [{ owner: 'acme', accountId: work.id }] }, options);

      const clone = spawnSync('git', ['clone', 'git@github.com:acme/new.git', path.join(sandbox.root, 'cloned')], {
        // If the rule were ignored, git would fall back to this missing program instead of a real connection.
        env: { ...sandbox.env, GIT_SSH: 'ssh-is-disabled-in-tests' },
        encoding: 'utf8',
      });

      assert.match(clone.stderr, /used-the-rule/);
    });

    it('wins over a folder rule', async (t) => {
      const { sandbox, addFolderRule, addOwnerRule, repoWithRemote, resolved } = await setup(t);
      const workFolder = await sandbox.makeDir('work');
      const repo = await repoWithRemote(path.join('work', 'dotfiles'), 'git@github.com:ada-personal/dotfiles.git');

      await addOwnerRule('ada-personal', personal);
      await addFolderRule(workFolder, work);

      assert.equal(await resolved(repo, 'user.email'), 'ada@example.com');
      assert.equal(await resolved(repo, 'credential.https://github.com.username'), 'ada-personal');
    });

    it('does not hand the key of a folder rule to an account that has none', async (t) => {
      const { sandbox, addFolderRule, addOwnerRule, repoWithRemote, resolved } = await setup(t);
      const workFolder = await sandbox.makeDir('work');
      const repo = await repoWithRemote(path.join('work', 'dotfiles'), 'git@github.com:ada-personal/dotfiles.git');

      await addFolderRule(workFolder, withKey);
      await addOwnerRule('ada-personal', personal);

      assert.equal(await resolved(repo, 'core.sshCommand'), 'ssh');
    });
  });

  describe('bookkeeping', () => {
    it('lists its own rules and ignores includes written by someone else', async (t) => {
      const { sandbox, options, addFolderRule, addOwnerRule } = await setup(t);
      const workFolder = await sandbox.makeDir('work');
      await sandbox.setGlobal('includeIf.gitdir:~/elsewhere/.path', '~/.gitconfig-elsewhere');
      await sandbox.setGlobal('includeIf.hasconfig:remote.*.url:https://example.com/**.path', '~/.gitconfig-example');

      await addFolderRule(workFolder, work);
      await addOwnerRule('Acme', work);

      assert.deepEqual(await listRules(sandbox.git, options), {
        folders: [{ folder: workFolder, accountId: work.id }],
        owners: [{ owner: 'acme', accountId: work.id }],
      });
    });

    it('leaves the global config as it was once the rules are removed', async (t) => {
      const { sandbox, options, addFolderRule, addOwnerRule, resolved } = await setup(t);
      const workFolder = await sandbox.makeDir('work');
      const repo = await sandbox.initRepo(path.join('work', 'api'));
      await sandbox.setGlobal('includeIf.gitdir:~/elsewhere/.path', '~/.gitconfig-elsewhere');
      const before = await sandbox.readGlobalFile();
      await addFolderRule(workFolder, work);
      await addOwnerRule('acme', work);

      await saveRules(sandbox.git, { folders: [], owners: [] }, options);

      assert.equal(await sandbox.readGlobalFile(), before);
      assert.equal(await resolved(repo, 'user.email'), 'global@example.com');
    });

    it('goes back to plain ssh when the account no longer has a key', async (t) => {
      const { sandbox, writeInclude, addFolderRule, resolved } = await setup(t);
      const workFolder = await sandbox.makeDir('work');
      const repo = await sandbox.initRepo(path.join('work', 'api'));
      await addFolderRule(workFolder, withKey);

      await writeInclude(work);

      assert.equal(await resolved(repo, 'core.sshCommand'), 'ssh');
      assert.equal(await resolved(repo, 'user.email'), 'ada@company.example');
    });
  });
});

describe('readOwnSshCommand', () => {
  it('is null when the person has not configured one', async (t) => {
    const sandbox = await createSandbox(t);

    assert.equal(await readOwnSshCommand(sandbox.git), null);
  });

  it('returns the command the person configured globally', async (t) => {
    const sandbox = await createSandbox(t);
    await sandbox.setGlobal('core.sshCommand', 'C:/Windows/System32/OpenSSH/ssh.exe');

    assert.equal(await readOwnSshCommand(sandbox.git), 'C:/Windows/System32/OpenSSH/ssh.exe');
  });
});
