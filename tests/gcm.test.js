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

const ok = (stdout) => ({ code: 0, stdout, stderr: '' });
const failed = (stderr = '') => ({ code: 1, stdout: '', stderr });

// A credential manager with two accounts signed in.
const working = (args) => (args.includes('--version') ? ok('2.2.1+abc123\r\n') : ok('ada-personal\r\nada-work\r\n\r\n'));

describe('Git Credential Manager', () => {
  it('lists the GitHub accounts that are signed in, along with its own version', async () => {
    const { git, calls } = fakeGit(working);

    const status = await createGcm(git).getStatus();

    assert.deepEqual(status, { available: true, accounts: ['ada-personal', 'ada-work'], version: '2.2.1' });
    assert.deepEqual(calls[0].args, ['credential-manager', 'github', 'list']);
  });

  it('asks for the version once, because it cannot change while the app runs', async () => {
    const { git, calls } = fakeGit(working);
    const gcm = createGcm(git);

    await gcm.getStatus();
    await gcm.getStatus();

    assert.equal(calls.filter((call) => call.args.includes('--version')).length, 1);
  });

  it('is available with no accounts when nobody is signed in', async () => {
    const { git } = fakeGit((args) => (args.includes('--version') ? failed() : ok('')));

    assert.deepEqual(await createGcm(git).getStatus(), { available: true, accounts: [], version: null });
  });

  it('is unavailable when git does not know the command', async () => {
    const { git } = fakeGit(() => failed("git: 'credential-manager' is not a git command."));

    assert.deepEqual(await createGcm(git).getStatus(), { available: false, accounts: [], version: null });
  });

  it('is unavailable when git cannot be run at all', async () => {
    const git = async () => {
      throw new Error('spawn git ENOENT');
    };

    assert.deepEqual(await createGcm(git).getStatus(), { available: false, accounts: [], version: null });
  });

  it('starts a sign-in for the requested user and waits as long as the user needs', async () => {
    const { git, calls } = fakeGit(() => ok(''));

    const result = await createGcm(git).signIn('ada-work');

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls[0].args, ['credential-manager', 'github', 'login', '--username', 'ada-work']);
    assert.equal(calls[0].options.timeout, 0);
  });

  it('reports why a sign-in did not finish', async () => {
    const { git } = fakeGit(() => failed('warning: noise\nfatal: User cancelled dialog.\n'));

    const result = await createGcm(git).signIn('ada-work');

    assert.deepEqual(result, { ok: false, detail: 'fatal: User cancelled dialog.' });
  });

  it('has nothing to add when the sign-in stopped without a word', async () => {
    const { git } = fakeGit(() => failed(''));

    assert.deepEqual(await createGcm(git).signIn('ada-work'), { ok: false, detail: null });
  });
});
