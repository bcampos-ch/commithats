import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectWarnings, describeAssignment } from '../src/core/assignment.js';
import { parseRemoteUrl } from '../src/core/remotes.js';
import { sshCommandFor } from '../src/core/ssh-command.js';
import { personal, work } from './helpers/sandbox.js';

const accounts = [personal, work];
const options = { platform: 'linux' };

function inspection(overrides = {}) {
  return {
    path: '/projects/api',
    isRepo: true,
    author: { name: null, email: null },
    pushAccount: null,
    sshCommand: null,
    remotes: [],
    managedAccountId: null,
    ...overrides,
  };
}

function assignedTo(account, overrides = {}) {
  return inspection({
    author: {
      name: { value: account.gitName, scope: 'local' },
      email: { value: account.gitEmail, scope: 'local' },
    },
    pushAccount: { value: account.githubUser, scope: 'local' },
    sshCommand: { value: sshCommandFor(account, options), scope: 'local' },
    managedAccountId: account.id,
    ...overrides,
  });
}

const remote = (name, url) => ({ name, ...parseRemoteUrl(url) });

describe('describeAssignment', () => {
  it('is unset when the project only inherits the global identity', () => {
    const inherited = inspection({
      author: { name: { value: 'Global', scope: 'global' }, email: { value: 'g@example.com', scope: 'global' } },
    });

    assert.deepEqual(describeAssignment(inherited, accounts, options), { kind: 'unset', accountId: null });
  });

  it('names the account when the project config matches it', () => {
    assert.deepEqual(describeAssignment(assignedTo(work), accounts, options), { kind: 'account', accountId: work.id });
  });

  it('names an account with a key when the project uses that key', () => {
    const withKey = { ...work, sshKeyPath: '/home/ada/.ssh/id_work' };

    const assignment = describeAssignment(assignedTo(withKey), [personal, withKey], options);

    assert.deepEqual(assignment, { kind: 'account', accountId: work.id });
  });

  it('flags drift when someone edited the project config by hand', () => {
    const edited = assignedTo(work, {
      author: {
        name: { value: work.gitName, scope: 'local' },
        email: { value: 'someone-else@example.com', scope: 'local' },
      },
    });

    assert.deepEqual(describeAssignment(edited, accounts, options), { kind: 'drifted', accountId: work.id });
  });

  it('flags drift when the SSH command no longer matches the key of the account', () => {
    const withKey = { ...work, sshKeyPath: '/home/ada/.ssh/id_work' };
    const edited = assignedTo(withKey, { sshCommand: { value: 'ssh -i /other/key', scope: 'local' } });

    const assignment = describeAssignment(edited, [personal, withKey], options);

    assert.deepEqual(assignment, { kind: 'drifted', accountId: work.id });
  });

  it('flags drift when the project does not pin its own SSH command', () => {
    const fromARule = assignedTo(work, { sshCommand: { value: 'ssh -i /rule/key', scope: 'global' } });

    assert.deepEqual(describeAssignment(fromARule, accounts, options), { kind: 'drifted', accountId: work.id });
  });

  it('expects the SSH command the person already uses when the account has no key', () => {
    const own = 'C:/Windows/System32/OpenSSH/ssh.exe';
    const pinned = assignedTo(work, { sshCommand: { value: own, scope: 'local' } });

    const assignment = describeAssignment(pinned, accounts, { ...options, baselineSshCommand: own });

    assert.deepEqual(assignment, { kind: 'account', accountId: work.id });
  });

  it('is custom when the project has its own identity that the app did not write', () => {
    const handwritten = inspection({
      author: { name: null, email: { value: 'handwritten@example.com', scope: 'local' } },
    });

    assert.deepEqual(describeAssignment(handwritten, accounts, options), { kind: 'custom', accountId: null });
  });

  it('is custom when the assigned account no longer exists', () => {
    assert.deepEqual(describeAssignment(assignedTo(work), [personal], options), { kind: 'custom', accountId: null });
  });

  it('is unset for a folder that is not a repository', () => {
    const notARepo = inspection({ isRepo: false });

    assert.deepEqual(describeAssignment(notARepo, accounts, options), { kind: 'unset', accountId: null });
  });
});

describe('collectWarnings', () => {
  it('has nothing to say about a plain GitHub HTTPS remote when the account is signed in', () => {
    const project = assignedTo(work, { remotes: [remote('origin', 'https://github.com/acme/api.git')] });

    assert.deepEqual(collectWarnings(project, work, { signedInAccounts: ['ada-work'] }), []);
  });

  it('warns when the account is not signed in yet', () => {
    const project = assignedTo(work, { remotes: [remote('origin', 'https://github.com/acme/api.git')] });

    const warnings = collectWarnings(project, work, { signedInAccounts: ['ada-personal'] });

    assert.deepEqual(warnings, [{ code: 'warning.notSignedIn', params: { user: 'ada-work' } }]);
  });

  it('compares signed-in accounts without regard to case', () => {
    const project = assignedTo(work, { remotes: [remote('origin', 'https://github.com/acme/api.git')] });

    assert.deepEqual(collectWarnings(project, work, { signedInAccounts: ['Ada-Work'] }), []);
  });

  it('skips the sign-in check when the credential manager is unavailable', () => {
    const project = assignedTo(work, { remotes: [remote('origin', 'https://github.com/acme/api.git')] });

    assert.deepEqual(collectWarnings(project, work, { signedInAccounts: null }), []);
  });

  it('warns when the remote URL pins a different user', () => {
    const project = assignedTo(work, { remotes: [remote('origin', 'https://ada-personal@github.com/acme/api.git')] });

    const warnings = collectWarnings(project, work, { signedInAccounts: ['ada-work'] });

    assert.deepEqual(warnings, [{ code: 'warning.pinnedUser', params: { remote: 'origin', user: 'ada-personal' } }]);
  });

  it('warns when the remote URL carries a credential', () => {
    const project = assignedTo(work, { remotes: [remote('origin', 'https://ada-work:s3cr3t@github.com/acme/api.git')] });

    const warnings = collectWarnings(project, work, { signedInAccounts: ['ada-work'] });

    assert.deepEqual(warnings, [{ code: 'warning.embeddedCredential', params: { remote: 'origin' } }]);
    assert.doesNotMatch(JSON.stringify(warnings), /s3cr3t/);
  });

  it('warns when the remote uses SSH and the account has no key', () => {
    const project = assignedTo(work, { remotes: [remote('origin', 'git@github.com:acme/api.git')] });

    const warnings = collectWarnings(project, work, { signedInAccounts: ['ada-work'] });

    assert.deepEqual(warnings, [{ code: 'warning.sshNoKey', params: { remote: 'origin' } }]);
  });

  it('accepts an SSH remote when the account has a key', () => {
    const withKey = { ...work, sshKeyPath: '/home/ada/.ssh/id_work' };
    const project = assignedTo(withKey, { remotes: [remote('origin', 'git@github.com:acme/api.git')] });

    assert.deepEqual(collectWarnings(project, withKey, { signedInAccounts: [] }), []);
  });

  it('warns when the remote is not hosted on GitHub', () => {
    const project = assignedTo(work, { remotes: [remote('origin', 'https://gitlab.com/acme/api.git')] });

    const warnings = collectWarnings(project, work, { signedInAccounts: ['ada-work'] });

    assert.deepEqual(warnings, [{ code: 'warning.notGithub', params: { remote: 'origin' } }]);
  });
});
