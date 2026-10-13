export const LANGUAGES = Object.freeze(['en', 'es']);
export const THEMES = Object.freeze(['system', 'light', 'dark']);

const ALLOWED = {
  language: (value) => LANGUAGES.includes(value),
  theme: (value) => THEMES.includes(value),
  tourSeen: (value) => typeof value === 'boolean',
};

/**
 * The settings in effect: what was saved, with the default for anything missing
 * or unknown. `theme: 'system'` follows the operating system, and `tourSeen` says
 * whether the guided tour already greeted this person.
 */
export function readSettings(saved, { defaultLanguage = 'en' } = {}) {
  return {
    language: ALLOWED.language(saved?.language) ? saved.language : defaultLanguage,
    theme: ALLOWED.theme(saved?.theme) ? saved.theme : 'system',
    tourSeen: saved?.tourSeen === true,
  };
}

/**
 * Checks a change to one or more settings. Answers with `{ ok: true, change }`,
 * or `{ ok: false }` when it names a setting or a value that does not exist.
 */
export function validateSettingsChange(change) {
  if (change === null || typeof change !== 'object' || Array.isArray(change)) return { ok: false };

  const entries = Object.entries(change);
  const isKnown = ([name, value]) => Object.hasOwn(ALLOWED, name) && ALLOWED[name](value);
  if (entries.length === 0 || !entries.every(isKnown)) return { ok: false };
  return { ok: true, change: Object.fromEntries(entries) };
}

/** The language to start in on a system that uses `locale`: Spanish for any Spanish locale, English otherwise. */
export function languageForLocale(locale) {
  return /^es([-_]|$)/i.test(locale ?? '') ? 'es' : 'en';
}
