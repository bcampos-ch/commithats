import { createTranslator } from '../i18n/translator.js';

// Attributes that carry a text, besides the text of the element itself.
const TRANSLATED_ATTRIBUTES = {
  'data-i18n-placeholder': 'placeholder',
  'data-i18n-title': 'title',
  'data-i18n-aria-label': 'aria-label',
};

let language = null;
let translate = null;

/**
 * Says something in the language of the page. Takes a code with its values, or a
 * message from the main process (`{ code, params }`).
 */
export function t(messageOrCode, values) {
  return translate(messageOrCode, values);
}

/**
 * Switches the language of the page: the texts written in the HTML change now, and
 * everything said through `t` changes from here on. Whatever was drawn with `t` before
 * has to be drawn again by its owner.
 */
export function setLanguage(next) {
  if (next === language) return;

  language = next;
  translate = createTranslator(next);
  document.documentElement.lang = next;

  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.getAttribute('data-i18n'));
  }
  for (const [marker, attribute] of Object.entries(TRANSLATED_ATTRIBUTES)) {
    for (const element of document.querySelectorAll(`[${marker}]`)) {
      element.setAttribute(attribute, t(element.getAttribute(marker)));
    }
  }
}

// The main process puts the language in the address of the page, so there is one to speak before it answers anything.
setLanguage(new URLSearchParams(window.location.search).get('lang') ?? 'en');
