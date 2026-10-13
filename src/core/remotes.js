const GITHUB_HOSTS = new Set(['github.com', 'ssh.github.com']);
const GITHUB_USERNAME_MAX_LENGTH = 39;
const TOKEN_PREFIX = /^(gh[pousr]_|github_pat_)/i;
const SCHEME_URL = /^[a-z][a-z0-9+.-]*:\/\//i;
const SCP_LIKE_URL = /^(?:([^@/\s]+)@)?([^:/\s]+):(?!\/\/)(.+)$/;
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;
const MASK = '***';

/**
 * Describes a remote URL so the app can show it and reason about which account git will use.
 * `owner` is the GitHub user or organization the repository belongs to.
 * `display` never contains a password or token, so it is safe to show and to log.
 */
export function parseRemoteUrl(rawUrl) {
  const url = String(rawUrl ?? '').trim();
  if (WINDOWS_DRIVE_PATH.test(url)) return localRemote(url);
  return parseSchemeUrl(url) ?? parseScpLikeUrl(url) ?? localRemote(url);
}

function parseSchemeUrl(url) {
  if (!SCHEME_URL.test(url)) return null;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const protocol = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const isGithub = GITHUB_HOSTS.has(host);
  const username = safeDecode(parsed.username);
  const usernameIsToken = looksLikeToken(username);
  const shownUser = username === '' ? '' : `${usernameIsToken ? MASK : username}@`;

  return {
    transport: transportFor(protocol),
    host,
    user: username !== '' && !usernameIsToken ? username : null,
    owner: isGithub ? firstSegment(safeDecode(parsed.pathname)) : null,
    hasEmbeddedSecret: parsed.password !== '' || usernameIsToken,
    isGithub,
    display: `${protocol}//${shownUser}${parsed.host}${parsed.pathname}`,
  };
}

function parseScpLikeUrl(url) {
  const match = SCP_LIKE_URL.exec(url);
  if (!match) return null;

  const [, user, rawHost, repositoryPath] = match;
  const host = rawHost.toLowerCase();
  const isGithub = GITHUB_HOSTS.has(host);
  return {
    transport: 'ssh',
    host,
    user: user ?? null,
    owner: isGithub ? firstSegment(repositoryPath) : null,
    hasEmbeddedSecret: false,
    isGithub,
    display: url,
  };
}

function localRemote(url) {
  return {
    transport: 'other',
    host: null,
    user: null,
    owner: null,
    hasEmbeddedSecret: false,
    isGithub: false,
    display: url,
  };
}

function transportFor(protocol) {
  if (protocol === 'https:') return 'https';
  if (protocol === 'ssh:') return 'ssh';
  return 'other';
}

function firstSegment(repositoryPath) {
  return repositoryPath.split('/').find((segment) => segment !== '') ?? null;
}

// A token pasted where the username goes is a secret, even though the URL has no password.
function looksLikeToken(username) {
  return TOKEN_PREFIX.test(username) || username.length > GITHUB_USERNAME_MAX_LENGTH;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
