import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { abbreviateHome } from '../src/core/paths.js';

describe('abbreviateHome', () => {
  it('replaces the home folder with a tilde', () => {
    assert.equal(abbreviateHome('/home/ada/code/api', '/home/ada', 'linux'), '~/code/api');
  });

  it('keeps Windows separators', () => {
    assert.equal(abbreviateHome('C:\\Users\\ada\\code\\api', 'C:\\Users\\ada', 'win32'), '~\\code\\api');
  });

  it('ignores case on Windows, where paths are case-insensitive', () => {
    assert.equal(abbreviateHome('c:\\users\\ADA\\code', 'C:\\Users\\ada', 'win32'), '~\\code');
  });

  it('respects case elsewhere', () => {
    assert.equal(abbreviateHome('/home/Ada/code', '/home/ada', 'linux'), '/home/Ada/code');
  });

  it('leaves a sibling folder that only shares a prefix with the home folder', () => {
    assert.equal(abbreviateHome('/home/adam/code', '/home/ada', 'linux'), '/home/adam/code');
  });

  it('shows the home folder itself as a tilde', () => {
    assert.equal(abbreviateHome('/home/ada', '/home/ada', 'linux'), '~');
  });

  it('leaves the path alone when the home folder is unknown', () => {
    assert.equal(abbreviateHome('/home/ada/code', '', 'linux'), '/home/ada/code');
  });
});
