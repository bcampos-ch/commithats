import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRemoteUrl } from '../src/core/remotes.js';

describe('parseRemoteUrl', () => {
  it('recognizes a GitHub HTTPS remote', () => {
    assert.deepEqual(parseRemoteUrl('https://github.com/acme/api.git'), {
      transport: 'https',
      host: 'github.com',
      user: null,
      owner: 'acme',
      hasEmbeddedSecret: false,
      isGithub: true,
      display: 'https://github.com/acme/api.git',
    });
  });

  it('reports the user pinned in an HTTPS remote', () => {
    const remote = parseRemoteUrl('https://ada-work@github.com/acme/api.git');

    assert.equal(remote.user, 'ada-work');
    assert.equal(remote.hasEmbeddedSecret, false);
    assert.equal(remote.display, 'https://ada-work@github.com/acme/api.git');
  });

  it('hides a password embedded in the URL', () => {
    const remote = parseRemoteUrl('https://ada-work:s3cr3t-value@github.com/acme/api.git');

    assert.equal(remote.hasEmbeddedSecret, true);
    assert.equal(remote.user, 'ada-work');
    assert.doesNotMatch(remote.display, /s3cr3t-value/);
  });

  it('hides a token used in place of the username', () => {
    const remote = parseRemoteUrl('https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/acme/api.git');

    assert.equal(remote.hasEmbeddedSecret, true);
    assert.equal(remote.user, null);
    assert.doesNotMatch(remote.display, /ghp_/);
    assert.equal(remote.display, 'https://***@github.com/acme/api.git');
  });

  it('recognizes the scp-like SSH form', () => {
    assert.deepEqual(parseRemoteUrl('git@github.com:acme/api.git'), {
      transport: 'ssh',
      host: 'github.com',
      user: 'git',
      owner: 'acme',
      hasEmbeddedSecret: false,
      isGithub: true,
      display: 'git@github.com:acme/api.git',
    });
  });

  it('recognizes an ssh:// remote with a port', () => {
    const remote = parseRemoteUrl('ssh://git@ssh.github.com:443/acme/api.git');

    assert.equal(remote.transport, 'ssh');
    assert.equal(remote.host, 'ssh.github.com');
    assert.equal(remote.isGithub, true);
    assert.equal(remote.owner, 'acme');
  });

  it('flags remotes hosted somewhere other than GitHub and gives them no owner', () => {
    const remote = parseRemoteUrl('https://gitlab.com/acme/api.git');

    assert.equal(remote.transport, 'https');
    assert.equal(remote.isGithub, false);
    assert.equal(remote.owner, null);
  });

  it('treats a Windows path as a local remote, not as an SSH host', () => {
    const remote = parseRemoteUrl('C:/repos/api.git');

    assert.equal(remote.transport, 'other');
    assert.equal(remote.host, null);
    assert.equal(remote.owner, null);
    assert.equal(remote.display, 'C:/repos/api.git');
  });

  it('treats a relative path as a local remote', () => {
    assert.equal(parseRemoteUrl('../api.git').transport, 'other');
  });
});
