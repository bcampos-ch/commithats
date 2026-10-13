import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { languageForLocale, readSettings, validateSettingsChange } from '../src/core/settings.js';

describe('readSettings', () => {
  it('starts in the default language, following the system theme, with the tour still to see', () => {
    assert.deepEqual(readSettings({}, { defaultLanguage: 'es' }), { language: 'es', theme: 'system', tourSeen: false });
  });

  it('keeps what was saved', () => {
    const saved = { language: 'en', theme: 'dark', tourSeen: true };

    assert.deepEqual(readSettings(saved, { defaultLanguage: 'es' }), saved);
  });

  it('goes back to the default for a value it does not know', () => {
    const saved = { language: 'fr', theme: 'neon', tourSeen: 'yes' };

    assert.deepEqual(readSettings(saved, { defaultLanguage: 'en' }), { language: 'en', theme: 'system', tourSeen: false });
  });

  it('uses English when no default language is given', () => {
    assert.equal(readSettings(undefined).language, 'en');
  });
});

describe('validateSettingsChange', () => {
  it('accepts a change to a single setting', () => {
    assert.deepEqual(validateSettingsChange({ theme: 'dark' }), { ok: true, change: { theme: 'dark' } });
  });

  it('accepts every setting at once', () => {
    const change = { language: 'es', theme: 'light', tourSeen: true };

    assert.deepEqual(validateSettingsChange(change), { ok: true, change });
  });

  it('refuses a value it does not know', () => {
    assert.deepEqual(validateSettingsChange({ language: 'fr' }), { ok: false });
    assert.deepEqual(validateSettingsChange({ theme: 'neon' }), { ok: false });
    assert.deepEqual(validateSettingsChange({ tourSeen: 'yes' }), { ok: false });
  });

  it('refuses a setting that does not exist', () => {
    assert.deepEqual(validateSettingsChange({ theme: 'dark', volume: 11 }), { ok: false });
  });

  it('refuses anything that is not a set of settings', () => {
    for (const change of [null, undefined, 'dark', ['dark'], {}]) {
      assert.deepEqual(validateSettingsChange(change), { ok: false });
    }
  });
});

describe('languageForLocale', () => {
  it('is Spanish for every Spanish locale', () => {
    for (const locale of ['es', 'es-AR', 'es-419', 'ES-es', 'es_MX']) assert.equal(languageForLocale(locale), 'es');
  });

  it('is English for everything else', () => {
    for (const locale of ['en-US', 'pt-BR', 'est', '', undefined]) assert.equal(languageForLocale(locale), 'en');
  });
});
