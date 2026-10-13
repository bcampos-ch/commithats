import { message } from './messages.js';
import { sshCommandFor } from './ssh-command.js';

/**
 * Says how a project relates to the accounts the app knows:
 * - `unset`: it has no identity of its own and follows a rule or the global config.
 * - `account`: its config matches the account the app assigned.
 * - `drifted`: the app assigned an account, but the config no longer matches it.
 * - `custom`: it has its own identity that the app did not write.
 *
 * `sshOptions` are the options of `sshCommandFor`.
 */
export function describeAssignment(inspection, accounts, sshOptions = {}) {
  if (!inspection.isRepo) return unset();

  const account = accounts.find((candidate) => candidate.id === inspection.managedAccountId) ?? null;
  if (account !== null) {
    return { kind: matches(inspection, account, sshOptions) ? 'account' : 'drifted', accountId: account.id };
  }
  return hasOwnIdentity(inspection) ? { kind: 'custom', accountId: null } : unset();
}

/**
 * Lists the reasons git would ignore the account a project uses, as messages
 * (see messages.js). `signedInAccounts` is null when the credential manager cannot be asked.
 */
export function collectWarnings(inspection, account, { signedInAccounts = null } = {}) {
  const warnings = [];
  let reliesOnSignIn = false;

  for (const remote of inspection.remotes) {
    if (remote.transport === 'other') continue;

    if (!remote.isGithub) {
      warnings.push(message('warning.notGithub', { remote: remote.name }));
    } else if (remote.transport === 'ssh') {
      if (!account.sshKeyPath) warnings.push(message('warning.sshNoKey', { remote: remote.name }));
    } else if (remote.hasEmbeddedSecret) {
      warnings.push(message('warning.embeddedCredential', { remote: remote.name }));
    } else if (remote.user !== null && !sameUser(remote.user, account.githubUser)) {
      warnings.push(message('warning.pinnedUser', { remote: remote.name, user: remote.user }));
    } else {
      reliesOnSignIn = true;
    }
  }

  const isSignedIn = signedInAccounts?.some((name) => sameUser(name, account.githubUser));
  if (reliesOnSignIn && signedInAccounts !== null && !isSignedIn) {
    warnings.push(message('warning.notSignedIn', { user: account.githubUser }));
  }
  return warnings;
}

function unset() {
  return { kind: 'unset', accountId: null };
}

function matches(inspection, account, sshOptions) {
  return (
    isLocalValue(inspection.author.name, account.gitName) &&
    isLocalValue(inspection.author.email, account.gitEmail) &&
    isLocalValue(inspection.pushAccount, account.githubUser) &&
    isLocalValue(inspection.sshCommand, expectedSshCommand(account, sshOptions))
  );
}

// A stored key path that can no longer be turned into a command counts as a mismatch.
function expectedSshCommand(account, sshOptions) {
  try {
    return sshCommandFor(account, sshOptions);
  } catch {
    return null;
  }
}

function hasOwnIdentity(inspection) {
  return [inspection.author.name, inspection.author.email, inspection.pushAccount].some(
    (entry) => entry?.scope === 'local',
  );
}

function isLocalValue(entry, expected) {
  return expected !== null && entry?.scope === 'local' && entry.value === expected;
}

function sameUser(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}
