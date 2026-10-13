import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseConfigList } from '../src/core/git-config.js';

describe('parseConfigList', () => {
  it('reads scope, origin, key, and value from null-separated output', () => {
    const output =
      'global\0file:/home/ada/.gitconfig\0user.name\nAda Lovelace\0' +
      'local\0file:.git/config\0user.email\nada@example.com\0';

    assert.deepEqual(parseConfigList(output), [
      { scope: 'global', origin: 'file:/home/ada/.gitconfig', key: 'user.name', value: 'Ada Lovelace' },
      { scope: 'local', origin: 'file:.git/config', key: 'user.email', value: 'ada@example.com' },
    ]);
  });

  it('keeps line breaks that are part of a value', () => {
    const [entry] = parseConfigList('local\0file:.git/config\0alias.multi\nfirst\nsecond\0');

    assert.equal(entry.value, 'first\nsecond');
  });

  it('reads a key that has no value as an empty string', () => {
    assert.deepEqual(parseConfigList('local\0file:.git/config\0core.bare\0'), [
      { scope: 'local', origin: 'file:.git/config', key: 'core.bare', value: '' },
    ]);
  });

  it('lowercases the section and variable but keeps the subsection as written', () => {
    const [entry] = parseConfigList('local\0file:.git/config\0Remote.Upstream.URL\nhttps://github.com/acme/api.git\0');

    assert.equal(entry.key, 'remote.Upstream.url');
  });

  it('returns nothing for empty output', () => {
    assert.deepEqual(parseConfigList(''), []);
  });
});
