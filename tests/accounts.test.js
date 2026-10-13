import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateAccount } from '../src/core/accounts.js';

const draft = {
  label: 'Work',
  gitName: 'Ada Lovelace',
  gitEmail: 'ada@company.example',
  githubUser: 'ada-work',
  sshKeyPath: '',
};

describe('validateAccount', () => {
  it('accepts a complete draft and gives it an id', () => {
    const result = validateAccount(draft, { createId: () => 'new-id' });

    assert.deepEqual(result, {
      ok: true,
      account: {
        id: 'new-id',
        label: 'Work',
        gitName: 'Ada Lovelace',
        gitEmail: 'ada@company.example',
        githubUser: 'ada-work',
        sshKeyPath: null,
      },
    });
  });

  it('trims whitespace and drops a leading @ from the username', () => {
    const result = validateAccount(
      { ...draft, label: '  Work ', githubUser: ' @ada-work ', sshKeyPath: ' /home/ada/.ssh/id_work ' },
      { createId: () => 'new-id' },
    );

    assert.equal(result.account.label, 'Work');
    assert.equal(result.account.githubUser, 'ada-work');
    assert.equal(result.account.sshKeyPath, '/home/ada/.ssh/id_work');
  });

  it('keeps the id when the account already exists', () => {
    const existing = [{ id: 'known-id', label: 'Work' }];

    const result = validateAccount({ ...draft, id: 'known-id' }, { existing, createId: () => 'new-id' });

    assert.equal(result.account.id, 'known-id');
  });

  it('ignores an id that does not belong to an existing account', () => {
    const result = validateAccount({ ...draft, id: 'made-up' }, { createId: () => 'new-id' });

    assert.equal(result.account.id, 'new-id');
  });

  it('reports every missing field', () => {
    const result = validateAccount({});

    assert.equal(result.ok, false);
    assert.deepEqual(Object.keys(result.errors).sort(), ['gitEmail', 'gitName', 'githubUser', 'label']);
  });

  it('names each problem with a code, so the interface can say it in any language', () => {
    const result = validateAccount({ ...draft, label: 'x'.repeat(41), gitEmail: 'ada' });

    assert.deepEqual(result.errors, {
      label: { code: 'label.tooLong', params: { max: 40 } },
      gitEmail: { code: 'gitEmail.invalid' },
    });
  });

  it('rejects an email without a domain', () => {
    const result = validateAccount({ ...draft, gitEmail: 'ada' });

    assert.equal(result.ok, false);
    assert.ok(result.errors.gitEmail);
  });

  it('accepts a GitHub noreply address', () => {
    const result = validateAccount({ ...draft, gitEmail: '12345+ada-work@users.noreply.github.com' });

    assert.equal(result.ok, true);
  });

  it('rejects a username with characters GitHub does not allow', () => {
    const result = validateAccount({ ...draft, githubUser: 'ada work!' });

    assert.equal(result.ok, false);
    assert.ok(result.errors.githubUser);
  });

  it('rejects a label another account already uses, ignoring case', () => {
    const existing = [{ id: 'other-id', label: 'work' }];

    const result = validateAccount(draft, { existing });

    assert.equal(result.ok, false);
    assert.ok(result.errors.label);
  });

  it('lets an account keep its own label when it is edited', () => {
    const existing = [{ id: 'known-id', label: 'Work' }];

    const result = validateAccount({ ...draft, id: 'known-id' }, { existing });

    assert.equal(result.ok, true);
  });

  it('rejects a public key in place of the private key', () => {
    const result = validateAccount({ ...draft, sshKeyPath: '/home/ada/.ssh/id_work.pub' });

    assert.equal(result.ok, false);
    assert.ok(result.errors.sshKeyPath);
  });

  it('rejects values that contain line breaks', () => {
    const result = validateAccount({ ...draft, gitName: 'Ada\n[core]' });

    assert.equal(result.ok, false);
    assert.ok(result.errors.gitName);
  });
});
