import { randomUUID } from 'node:crypto';

const MAX_LABEL_LENGTH = 40;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+$/;
// Hyphens are the public rule; underscores appear in enterprise-managed usernames.
const GITHUB_USERNAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Turns form input into an account, or explains what is wrong with each field.
 *
 * An account is the pair git needs to act as someone: the commit author (name and
 * email) and the GitHub user that pushes, plus an optional SSH key for SSH remotes.
 */
export function validateAccount(input, { existing = [], createId = randomUUID } = {}) {
  const raw = {
    label: text(input?.label),
    gitName: text(input?.gitName),
    gitEmail: text(input?.gitEmail),
    githubUser: text(input?.githubUser),
    sshKeyPath: text(input?.sshKeyPath),
  };
  const isUpdate = existing.some((account) => account.id === input?.id);
  const id = isUpdate ? input.id : createId();

  const draft = {
    label: raw.label.trim(),
    gitName: raw.gitName.trim(),
    gitEmail: raw.gitEmail.trim(),
    githubUser: raw.githubUser.trim().replace(/^@/, ''),
    sshKeyPath: raw.sshKeyPath.trim() || null,
  };

  const errors = {};
  const report = (field, message) => {
    errors[field] ??= message;
  };

  for (const field of Object.keys(raw)) {
    if (CONTROL_CHARACTERS.test(raw[field])) report(field, "Remove the line breaks or control characters.");
  }

  if (draft.label === '') report('label', 'Enter a label, like "Work" or "Personal".');
  else if (draft.label.length > MAX_LABEL_LENGTH) report('label', `Keep the label under ${MAX_LABEL_LENGTH} characters.`);
  else if (labelIsTaken(draft.label, id, existing)) report('label', 'Another account already uses this label. Pick a different one.');

  if (draft.gitName === '') report('gitName', 'Enter the name that should appear on your commits.');
  else if (draft.gitName.length > MAX_NAME_LENGTH) report('gitName', `Keep the name under ${MAX_NAME_LENGTH} characters.`);

  if (draft.gitEmail === '') report('gitEmail', 'Enter the email that should appear on your commits.');
  else if (!EMAIL.test(draft.gitEmail) || draft.gitEmail.length > MAX_EMAIL_LENGTH) {
    report('gitEmail', "That doesn't look like an email address.");
  }

  if (draft.githubUser === '') report('githubUser', 'Enter the GitHub username you push with.');
  else if (!GITHUB_USERNAME.test(draft.githubUser)) {
    report('githubUser', 'GitHub usernames use letters, numbers, hyphens, and underscores, up to 39 characters.');
  }

  if (draft.sshKeyPath?.toLowerCase().endsWith('.pub')) {
    report('sshKeyPath', 'Choose the private key, not the .pub file.');
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, account: { id, ...draft } };
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function labelIsTaken(label, id, existing) {
  const wanted = label.toLowerCase();
  return existing.some((account) => account.id !== id && String(account.label).toLowerCase() === wanted);
}
