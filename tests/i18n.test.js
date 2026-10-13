import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LANGUAGES as languagesInSettings } from '../src/core/settings.js';
import en from '../src/i18n/en.js';
import { createTranslator, DICTIONARIES, LANGUAGE_NAMES, LANGUAGES } from '../src/i18n/translator.js';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('translator', () => {
  const dictionaries = {
    en: {
      greeting: 'Hello',
      welcome: 'Welcome, {name}. You have {count} hats.',
      hats: { one: '{count} hat', other: '{count} hats' },
      onlyInEnglish: 'Still in English',
    },
    es: {
      greeting: 'Hola',
      welcome: 'Te damos la bienvenida, {name}. Tienes {count} sombreros.',
      hats: { one: '{count} sombrero', other: '{count} sombreros' },
    },
  };
  const english = createTranslator('en', dictionaries);
  const spanish = createTranslator('es', dictionaries);

  it('says a sentence in the chosen language', () => {
    assert.equal(english('greeting'), 'Hello');
    assert.equal(spanish('greeting'), 'Hola');
  });

  it('fills in the values that go with a sentence', () => {
    assert.equal(spanish('welcome', { name: 'Ada', count: 3 }), 'Te damos la bienvenida, Ada. Tienes 3 sombreros.');
  });

  it('takes a message from the core as it comes', () => {
    assert.equal(english({ code: 'welcome', params: { name: 'Ada', count: 3 } }), 'Welcome, Ada. You have 3 hats.');
    assert.equal(english({ code: 'greeting' }), 'Hello');
  });

  it('picks the singular or the plural by the count', () => {
    assert.equal(english('hats', { count: 1 }), '1 hat');
    assert.equal(english('hats', { count: 2 }), '2 hats');
    assert.equal(spanish('hats', { count: 1 }), '1 sombrero');
    assert.equal(spanish('hats', { count: 0 }), '0 sombreros');
  });

  it('never reads a value as a template', () => {
    assert.equal(english('welcome', { name: '{count}', count: 3 }), 'Welcome, {count}. You have 3 hats.');
  });

  it('leaves a placeholder in sight when its value is missing', () => {
    assert.equal(english('welcome', { name: 'Ada' }), 'Welcome, Ada. You have {count} hats.');
  });

  it('falls back to English for a sentence the language does not have yet', () => {
    assert.equal(spanish('onlyInEnglish'), 'Still in English');
  });

  it('falls back to English for a language it does not have', () => {
    assert.equal(createTranslator('fr', dictionaries)('greeting'), 'Hello');
  });

  it('shows the code itself when no language has the sentence', () => {
    assert.equal(spanish('nowhere.to.be.found'), 'nowhere.to.be.found');
  });
});

describe('dictionaries', () => {
  const placeholders = (sentence) => [...sentence.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  // The values a sentence needs, whichever of its plural forms is used.
  const valuesOf = (entry) => {
    const forms = typeof entry === 'string' ? [entry] : Object.values(entry);
    return [...new Set(forms.flatMap(placeholders))].sort();
  };

  async function filesIn(folder, extension) {
    const entries = await readdir(path.join(source, folder), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
      .map((entry) => path.join(source, folder, entry.name));
  }

  async function codesIn(files, patterns) {
    const codes = new Set();
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      for (const pattern of patterns) {
        for (const match of content.matchAll(pattern)) codes.add(match[1]);
      }
    }
    return codes;
  }

  // Everything the app can say, found where it is said: messages built by the core and the
  // main process, sentences the page asks for, and the static texts of the page.
  async function codesInUse() {
    const message = /\bmessage\(\s*'([^']+)'/g;
    const translate = /\bt\(\s*'([^']+)'/g;
    const attribute = /data-i18n(?:-[a-z-]+)?="([^"]+)"/g;
    return new Set([
      ...(await codesIn(await filesIn('core', '.js'), [message])),
      ...(await codesIn(await filesIn('main', '.js'), [message, translate])),
      ...(await codesIn(await filesIn('renderer', '.js'), [translate])),
      ...(await codesIn(await filesIn('renderer', '.html'), [attribute])),
    ]);
  }

  // English is the reference: every other language is held against it.
  const translations = Object.entries(DICTIONARIES).filter(([language]) => language !== 'en');

  it('exist for exactly the languages the settings offer', () => {
    assert.deepEqual([...LANGUAGES].sort(), [...languagesInSettings].sort());
  });

  it('come with the name of their language, to pick it by', () => {
    assert.deepEqual(Object.keys(LANGUAGE_NAMES).sort(), [...LANGUAGES].sort());
  });

  it('say the same things in every language', () => {
    assert.ok(translations.length > 0);
    for (const [language, dictionary] of translations) {
      assert.deepEqual(Object.keys(dictionary).sort(), Object.keys(en).sort(), `what "${language}" says`);
    }
  });

  it('need the same values in every language', () => {
    for (const [language, dictionary] of translations) {
      for (const code of Object.keys(en)) {
        assert.deepEqual(valuesOf(dictionary[code] ?? ''), valuesOf(en[code]), `the values of "${code}" in "${language}"`);
      }
    }
  });

  it('have a singular and a plural wherever a sentence counts something', () => {
    for (const [language, dictionary] of Object.entries(DICTIONARIES)) {
      for (const [code, entry] of Object.entries(dictionary)) {
        if (typeof entry === 'string') continue;
        assert.deepEqual(Object.keys(entry).sort(), ['one', 'other'], `the forms of "${code}" in "${language}"`);
      }
    }
  });

  it('have a sentence for everything the app says', async () => {
    const missing = [...(await codesInUse())].filter((code) => !(code in en)).sort();

    assert.deepEqual(missing, []);
  });

  it('carry no sentence the app never says', async () => {
    const inUse = await codesInUse();
    const unused = Object.keys(en).filter((code) => !inUse.has(code)).sort();

    assert.deepEqual(unused, []);
  });
});
