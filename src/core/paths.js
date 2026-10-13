const SEPARATOR = /^[\\/]/;

/**
 * Shows a path the way people write it: with `~` standing for the home folder.
 * Paths outside the home folder are returned unchanged.
 */
export function abbreviateHome(fullPath, homeDir, platform = process.platform) {
  if (!homeDir) return fullPath;

  const comparable = (value) => (platform === 'win32' ? value.toLowerCase() : value);
  if (!comparable(fullPath).startsWith(comparable(homeDir))) return fullPath;

  const rest = fullPath.slice(homeDir.length);
  return rest === '' || SEPARATOR.test(rest) ? `~${rest}` : fullPath;
}
