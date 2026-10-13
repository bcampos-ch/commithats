import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSshCommand, sshCommandFor } from '../src/core/ssh-command.js';

describe('buildSshCommand', () => {
  it('forces the given key and ignores keys offered by the agent', () => {
    assert.equal(
      buildSshCommand('/home/ada/.ssh/id_work', { platform: 'linux' }),
      "ssh -i '/home/ada/.ssh/id_work' -o IdentitiesOnly=yes",
    );
  });

  it('uses forward slashes for Windows paths so the shell does not eat the backslashes', () => {
    assert.equal(
      buildSshCommand('C:\\Users\\Ada Lovelace\\.ssh\\id_work', { platform: 'win32' }),
      "ssh -i 'C:/Users/Ada Lovelace/.ssh/id_work' -o IdentitiesOnly=yes",
    );
  });

  it('keeps a quote in the path from ending the quoted argument', () => {
    assert.equal(
      buildSshCommand("/home/ada/it's mine/id_work", { platform: 'linux' }),
      "ssh -i '/home/ada/it'\\''s mine/id_work' -o IdentitiesOnly=yes",
    );
  });

  it('keeps shell syntax in the path inert', () => {
    const command = buildSshCommand('/tmp/key; rm -rf $HOME', { platform: 'linux' });

    assert.equal(command, "ssh -i '/tmp/key; rm -rf $HOME' -o IdentitiesOnly=yes");
  });

  it('rejects an empty path', () => {
    assert.throws(() => buildSshCommand('  '), TypeError);
  });

  it('rejects a path with control characters', () => {
    assert.throws(() => buildSshCommand('/home/ada/.ssh/id\nwork'), TypeError);
  });
});

describe('sshCommandFor', () => {
  it('uses the key of the account', () => {
    const account = { sshKeyPath: '/home/ada/.ssh/id_work' };

    assert.equal(sshCommandFor(account, { platform: 'linux' }), "ssh -i '/home/ada/.ssh/id_work' -o IdentitiesOnly=yes");
  });

  it('falls back to plain ssh for an account without a key', () => {
    assert.equal(sshCommandFor({ sshKeyPath: null }), 'ssh');
  });

  it('falls back to the SSH command the person already uses, when they have one', () => {
    const own = 'C:/Windows/System32/OpenSSH/ssh.exe';

    assert.equal(sshCommandFor({ sshKeyPath: null }, { baselineSshCommand: own }), own);
  });
});
