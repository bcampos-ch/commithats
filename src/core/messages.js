/**
 * Something the app has to tell the person: an error, a warning, a notice.
 *
 * The core never writes sentences. It names what happened with a code and the
 * values that go with it, and the interface turns that into words in the
 * language the person chose.
 */
export function message(code, params) {
  return params === undefined ? { code } : { code, params };
}
