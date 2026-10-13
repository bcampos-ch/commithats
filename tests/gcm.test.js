import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGcm } from '../src/core/gcm.js';

function fakeGit(respond) {
  const calls = [];
  const git = async (args, options) => {
    calls.push({ args, options });
    return respond(args);
  };
  return { git, calls };
}

describe('Git Credential Manager', () => {
  it('lists the GitHub accounts that are signed in', async () => {
    const { git, calls } = fakeGit(() => ({ code: 0, stdout: 'ada-personal\r\nada-work\r\n\r\n', stderr: '' }));

    const status = await createGcm(git).getStatus();

    assert.deepEqual(status, { available: true, accounts: ['ada-personal', 'ada-work'] });
    assert.deepEqual(calls[0].args, ['credential-manager', 'github', 'list']);
  });

  it('is available with no accounts when nobody is signed in', async () => {
    const { git } = fakeGit(() => ({ code: 0, stdout: '', stderr: '' }));

    assert.deepEqual(await createGcm(git).getStatus(), { available: true, accounts: [] });
  });

  it('is unavailable when git does not know the command', async () => {
    const { git } = fakeGit(() => ({ code: 1, stdout: '', stderr: "git: 'credential-manager' is not a git command." }));

    assert.deepEqual(await createGcm(git).getStatus(), { available: false, accounts: [] });
  });

  it('is unavailable when git cannot be run at all', async () => {
    const git = async () => {
      throw new Error('spawn git ENOENT');
    };

    assert.deepEqual(await createGcm(git).getStatus(), { available: false, accounts: [] });
  });

  it('starts a sign-in for the requested user and waits as long as the user needs', async () => {
    const { git, calls } = fakeGit(() => ({ code: 0, stdout: '', stderr: '' }));

    const result = await createGcm(git).signIn('ada-work');

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls[0].args, ['credential-manager', 'github', 'login', '--username', 'ada-work']);
    assert.equal(calls[0].options.timeout, 0);
  });

  it('reports why a sign-in did not finish', async () => {
    const { git } = fakeGit(() => ({ code: 1, stdout: '', stderr: 'warning: noise\nfatal: User cancelled dialog.\n' }));

    const result = await createGcm(git).signIn('ada-work');

    assert.deepEqual(result, { ok: false, message: 'fatal: User cancelled dialog.' });
  });
});
