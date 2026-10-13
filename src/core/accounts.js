import { randomUUID } from 'node:crypto';
import { message } from './messages.js';

const MAX_LABEL_LENGTH = 40;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+$/;
// Hyphens are the public rule; underscores appear in enterprise-managed usernames.
const GITHUB_USERNAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Turns form input into an account, or says what is wrong with each field.
 *
 * An account is the pair git needs to act as someone: the commit author (name and
 * email) and the GitHub user that pushes, plus an optional SSH key for SSH remotes.
 * `errors` maps a field name to a message (see messages.js).
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

  // The first problem found in a field is the one reported.
  const errors = {};
  const report = (field, problem) => {
    errors[field] ??= problem;
  };

  for (const field of Object.keys(raw)) {
    if (CONTROL_CHARACTERS.test(raw[field])) report(field, message('field.controlCharacters'));
  }

  if (draft.label === '') report('label', message('label.required'));
  else if (draft.label.length > MAX_LABEL_LENGTH) report('label', message('label.tooLong', { max: MAX_LABEL_LENGTH }));
  else if (labelIsTaken(draft.label, id, existing)) report('label', message('label.taken'));

  if (draft.gitName === '') report('gitName', message('gitName.required'));
  else if (draft.gitName.length > MAX_NAME_LENGTH) report('gitName', message('gitName.tooLong', { max: MAX_NAME_LENGTH }));

  if (draft.gitEmail === '') report('gitEmail', message('gitEmail.required'));
  else if (!EMAIL.test(draft.gitEmail) || draft.gitEmail.length > MAX_EMAIL_LENGTH) report('gitEmail', message('gitEmail.invalid'));

  if (draft.githubUser === '') report('githubUser', message('githubUser.required'));
  else if (!GITHUB_USERNAME.test(draft.githubUser)) report('githubUser', message('githubUser.invalid'));

  if (draft.sshKeyPath?.toLowerCase().endsWith('.pub')) report('sshKeyPath', message('sshKeyPath.publicKey'));

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
