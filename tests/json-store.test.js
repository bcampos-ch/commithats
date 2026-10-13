import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createJsonStore } from '../src/adapters/json-store.js';
import { work } from './helpers/sandbox.js';

async function tempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'gas-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe('json store', () => {
  it('starts empty when nothing was saved yet', async (t) => {
    const store = createJsonStore(path.join(await tempDir(t), 'state.json'));

    assert.deepEqual(await store.load(), { version: 1, accounts: [], projects: [] });
  });

  it('returns what was saved', async (t) => {
    const store = createJsonStore(path.join(await tempDir(t), 'state.json'));
    const state = { version: 1, accounts: [{ ...work }], projects: ['/projects/api'] };

    await store.save(state);

    assert.deepEqual(await store.load(), state);
  });

  it('creates the folder it lives in', async (t) => {
    const file = path.join(await tempDir(t), 'nested', 'deeper', 'state.json');

    await createJsonStore(file).save({ version: 1, accounts: [], projects: [] });

    assert.equal(JSON.parse(await readFile(file, 'utf8')).version, 1);
  });

  it('keeps a copy of a damaged file instead of overwriting it', async (t) => {
    const dir = await tempDir(t);
    const file = path.join(dir, 'state.json');
    await writeFile(file, '{ not json');

    const state = await createJsonStore(file).load();

    assert.deepEqual(state, { version: 1, accounts: [], projects: [] });
    const backups = (await readdir(dir)).filter((name) => name.startsWith('state.json.damaged-'));
    assert.equal(backups.length, 1);
    assert.equal(await readFile(path.join(dir, backups[0]), 'utf8'), '{ not json');
  });

  it('ignores entries that do not have the expected shape', async (t) => {
    const file = path.join(await tempDir(t), 'state.json');
    await writeFile(file, JSON.stringify({ version: 1, accounts: 'nope', projects: ['/projects/api', 42] }));

    assert.deepEqual(await createJsonStore(file).load(), { version: 1, accounts: [], projects: ['/projects/api'] });
  });
});
