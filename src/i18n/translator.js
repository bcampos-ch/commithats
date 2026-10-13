import en from './en.js';
import es from './es.js';

// A new language is added here, with its name, and allowed in core/settings.js.
// tests/i18n.test.js fails until the three agree and the dictionary says everything en.js does.
export const DICTIONARIES = Object.freeze({ en, es });

/** Each language named in itself, so it can be found by someone who cannot read the current one. */
export const LANGUAGE_NAMES = Object.freeze({ en: 'English', es: 'Español' });

/** The languages the app can speak. */
export const LANGUAGES = Object.freeze(Object.keys(DICTIONARIES));

const FALLBACK_LANGUAGE = 'en';
const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Builds the function that says things in one language. It takes a code with its
 * values, or a message from the core (`{ code, params }`, see core/messages.js), and
 * answers with the sentence.
 *
 * A dictionary maps a code to a sentence with `{placeholders}`, or to `{ one, other }`
 * when the sentence depends on a `count`. A sentence the language does not have yet is
 * said in English, and a code nobody has a sentence for is shown as it is, so a gap is
 * visible instead of blank. Values are written in as plain text, never read as a template.
 */
export function createTranslator(language, dictionaries = DICTIONARIES) {
  const spoken = Object.hasOwn(dictionaries, language) ? language : FALLBACK_LANGUAGE;
  const plural = new Intl.PluralRules(spoken);

  return function translate(messageOrCode, values) {
    const { code, params = {} } =
      typeof messageOrCode === 'string' ? { code: messageOrCode, params: values } : messageOrCode;

    const entry = dictionaries[spoken][code] ?? dictionaries[FALLBACK_LANGUAGE][code];
    if (entry === undefined) return code;

    const sentence = typeof entry === 'string' ? entry : (entry[plural.select(Number(params.count))] ?? entry.other);
    return sentence.replace(PLACEHOLDER, (placeholder, name) => (Object.hasOwn(params, name) ? String(params[name]) : placeholder));
  };
}
