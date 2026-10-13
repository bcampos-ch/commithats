import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createSshKeygen } from '../src/adapters/ssh-keygen.js';

async function tempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'gas-keys-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// These run the real ssh-keygen, always inside a throwaway folder.
describe('ssh-keygen', () => {
  it('creates an ed25519 key pair with the given comment', async (t) => {
    const keyPath = path.join(await tempDir(t), 'id_ed25519_work');
    const keygen = createSshKeygen();

    const result = await keygen.generate({ keyPath, comment: 'ada@company.example' });

    assert.deepEqual(result, { ok: true });
    assert.match(await readFile(keyPath, 'utf8'), /^-----BEGIN OPENSSH PRIVATE KEY-----/);
    assert.match(await keygen.readPublicKey(keyPath), /^ssh-ed25519 [A-Za-z0-9+/=]+ ada@company\.example$/);
  });

  it('reports a failure instead of throwing when the key cannot be written', async (t) => {
    const keyPath = path.join(await tempDir(t), 'missing-folder', 'id_ed25519_work');

    const result = await createSshKeygen().generate({ keyPath, comment: 'ada@company.example' });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'failed');
  });

  it('says so when ssh-keygen is not installed', async (t) => {
    const keyPath = path.join(await tempDir(t), 'id_ed25519_work');
    const keygen = createSshKeygen({ executable: 'ssh-keygen-that-does-not-exist' });

    const result = await keygen.generate({ keyPath, comment: 'ada@company.example' });

    assert.deepEqual(result, { ok: false, reason: 'not-found' });
  });

  it('has no public key to show when the .pub file is missing', async (t) => {
    const keyPath = path.join(await tempDir(t), 'id_ed25519_work');

    assert.equal(await createSshKeygen().readPublicKey(keyPath), null);
  });

  it('does not show a .pub file that is not a public key', async (t) => {
    const keyPath = path.join(await tempDir(t), 'notes');
    await writeFile(`${keyPath}.pub`, 'these are my private notes\n');

    assert.equal(await createSshKeygen().readPublicKey(keyPath), null);
  });
});
