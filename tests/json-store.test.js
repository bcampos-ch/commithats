import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createJsonStore } from '../src/adapters/json-store.js';
import { work } from './helpers/sandbox.js';

const empty = { version: 1, accounts: [], projects: [], settings: {} };

async function tempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'gas-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe('json store', () => {
  it('starts empty when nothing was saved yet', async (t) => {
    const store = createJsonStore(path.join(await tempDir(t), 'state.json'));

    assert.deepEqual(await store.load(), empty);
  });

  it('returns what was saved', async (t) => {
    const store = createJsonStore(path.join(await tempDir(t), 'state.json'));
    const state = {
      version: 1,
      accounts: [{ ...work }],
      projects: ['/projects/api'],
      settings: { language: 'es', theme: 'dark' },
    };

    await store.save(state);

    assert.deepEqual(await store.load(), state);
  });

  it('creates the folder it lives in', async (t) => {
    const file = path.join(await tempDir(t), 'nested', 'deeper', 'state.json');

    await createJsonStore(file).save(empty);

    assert.equal(JSON.parse(await readFile(file, 'utf8')).version, 1);
  });

  it('keeps a copy of a damaged file instead of overwriting it', async (t) => {
    const dir = await tempDir(t);
    const file = path.join(dir, 'state.json');
    await writeFile(file, '{ not json');

    const state = await createJsonStore(file).load();

    assert.deepEqual(state, empty);
    const backups = (await readdir(dir)).filter((name) => name.startsWith('state.json.damaged-'));
    assert.equal(backups.length, 1);
    assert.equal(await readFile(path.join(dir, backups[0]), 'utf8'), '{ not json');
  });

  it('ignores entries that do not have the expected shape', async (t) => {
    const file = path.join(await tempDir(t), 'state.json');
    await writeFile(file, JSON.stringify({ version: 1, accounts: 'nope', projects: ['/projects/api', 42], settings: [] }));

    assert.deepEqual(await createJsonStore(file).load(), { ...empty, projects: ['/projects/api'] });
  });

  it('reads a file written before settings existed', async (t) => {
    const file = path.join(await tempDir(t), 'state.json');
    await writeFile(file, JSON.stringify({ version: 1, accounts: [], projects: ['/projects/api'] }));

    assert.deepEqual(await createJsonStore(file).load(), { ...empty, projects: ['/projects/api'] });
  });

  // A refresh reads while a change saves. On Windows a file cannot be replaced while it is open, even for reading.
  it('takes reads and saves that arrive together, and keeps the last save', async (t) => {
    const store = createJsonStore(path.join(await tempDir(t), 'state.json'));
    await store.save(empty);

    const work = [];
    for (let turn = 1; turn <= 40; turn += 1) {
      work.push(store.save({ ...empty, projects: [`/projects/${turn}`] }), store.load());
    }
    const results = await Promise.all(work);

    assert.deepEqual((await store.load()).projects, ['/projects/40']);
    // Each read saw a whole state, never a file half written.
    for (const state of results.filter(Boolean)) assert.equal(state.projects.length, 1);
  });
});

describe('json store, when something else holds the file', () => {
  const held = () => Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });

  // An antivirus looking at a file that was just written keeps it open for a moment.
  function storeWhoseFileIsHeld(file, { times, error = held }) {
    const attempts = [];
    const store = createJsonStore(file, {
      rename: async (from, to) => {
        attempts.push(to);
        if (attempts.length <= times) throw error();
        await rename(from, to);
      },
    });
    return { store, attempts };
  }

  it('tries again until the file is let go', async (t) => {
    const file = path.join(await tempDir(t), 'state.json');
    const { store, attempts } = storeWhoseFileIsHeld(file, { times: 2 });

    await store.save({ ...empty, projects: ['/projects/api'] });

    assert.equal(attempts.length, 3);
    assert.deepEqual((await store.load()).projects, ['/projects/api']);
  });

  it('gives up with the reason when the file is never let go, and keeps what was saved before', async (t) => {
    const file = path.join(await tempDir(t), 'state.json');
    await createJsonStore(file).save({ ...empty, projects: ['/projects/before'] });
    const { store, attempts } = storeWhoseFileIsHeld(file, { times: Infinity });

    await assert.rejects(() => store.save({ ...empty, projects: ['/projects/after'] }), { code: 'EPERM' });

    assert.equal(attempts.length, 5);
    assert.deepEqual((await store.load()).projects, ['/projects/before']);
  });

  it('does not wait on a failure that waiting cannot fix', async (t) => {
    const file = path.join(await tempDir(t), 'state.json');
    const diskFull = () => Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    const { store, attempts } = storeWhoseFileIsHeld(file, { times: Infinity, error: diskFull });

    await assert.rejects(() => store.save(empty), { code: 'ENOSPC' });

    assert.equal(attempts.length, 1);
  });
});
