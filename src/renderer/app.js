import { accountsView, detailView, environmentView, projectsView, strayRulesView } from './views.js';

// Container: owns the state, talks to the main process, and re-renders the views.

const api = window.accountSwitcher;
const TOAST_DURATION_MS = 6000;

const elements = {
  environment: document.getElementById('environment'),
  accounts: document.getElementById('accounts'),
  projects: document.getElementById('projects'),
  detail: document.getElementById('detail'),
  toasts: document.getElementById('toasts'),
  accountDialog: document.getElementById('account-dialog'),
  accountDialogTitle: document.getElementById('account-dialog-title'),
  accountForm: document.getElementById('account-form'),
  publicKey: document.getElementById('public-key'),
  publicKeyText: document.getElementById('public-key-text'),
  publicKeyNote: document.getElementById('public-key-note'),
  ownerDialog: document.getElementById('owner-dialog'),
  ownerDialogIntro: document.getElementById('owner-dialog-intro'),
  ownerForm: document.getElementById('owner-form'),
};

const state = {
  snapshot: null,
  selectedPath: null,
  editingAccountId: null,
  ownerRuleAccountId: null,
  pendingOperations: 0,
};

const handlers = {
  onEditAccount: (account) => openAccountDialog(account),

  async onRemoveAccount(account) {
    if (!window.confirm(`Remove the account "${account.label}" from the app?`)) return;
    await run(() => api.removeAccount(account.id));
  },

  async onSignIn(account) {
    const dismiss = showToast('Finish signing in to GitHub in the Git Credential Manager window.', { sticky: true });
    try {
      await run(() => api.signIn(account.id), { blocking: false });
    } finally {
      dismiss();
    }
  },

  // Rules are the one thing that writes to the global git config, so adding one asks first.
  async onAddFolder(account) {
    const picked = await api.pickFolder();
    if (!picked.ok || !picked.path) return;

    const question =
      `Use "${account.label}" for everything inside ${picked.displayPath}?\n\n` +
      'This adds one rule to your global git config. It loads the settings of this account for repositories in ' +
      'that folder, including ones you clone later. Your global name and email stay as they are, and a project ' +
      'with its own account keeps it.';
    if (!window.confirm(question)) return;

    await run(() => api.addFolderRule(account.id, picked.path));
  },

  async onRemoveFolder(folder) {
    const question =
      `Remove the rule for ${folder.displayPath}?\n\n` +
      'Repositories inside it go back to your global identity, unless another rule or their own account applies.';
    if (!window.confirm(question)) return;

    await run(() => api.removeFolderRule(folder.path));
  },

  onAddOwner: (account) => openOwnerDialog(account),

  async onRemoveOwner(owner) {
    const question =
      `Remove the rule for repositories owned by ${owner}?\n\n` +
      'They go back to your global identity, unless another rule or their own account applies.';
    if (!window.confirm(question)) return;

    await run(() => api.removeOwnerRule(owner));
  },

  onSelectProject(project) {
    state.selectedPath = project.path;
    render();
  },

  async onAssignProject(project, accountId) {
    state.selectedPath = project.path;
    const result = await run(() => api.assignProject(project.path, accountId));
    // A refused change leaves the dropdown showing a choice that was not applied.
    if (!result?.ok) render();
  },

  async onRemoveProject(project) {
    const result = await run(() => api.removeProject(project.path));
    if (result?.ok) showToast(`Removed ${project.name} from the list. Its git config was left as it is.`);
  },
};

/**
 * Runs an operation against the main process and applies its answer:
 * a new snapshot re-renders the page, notices and errors become toasts.
 * Field errors are returned to the caller, which knows where to show them.
 */
async function run(operation, { blocking = true } = {}) {
  if (blocking) setBusy(+1);
  try {
    const result = await operation();
    if (result.snapshot) {
      state.snapshot = result.snapshot;
      render();
    }
    for (const notice of result.notices ?? []) showToast(notice);
    if (!result.ok && result.error) showToast(result.error, { tone: 'error' });
    return result;
  } catch {
    showToast('Something went wrong. Try again.', { tone: 'error' });
    return null;
  } finally {
    if (blocking) setBusy(-1);
  }
}

function render() {
  const { snapshot } = state;
  if (!snapshot) return;

  const focusKey = document.activeElement?.dataset?.focusKey;

  if (!snapshot.projects.some((project) => project.path === state.selectedPath)) {
    state.selectedPath = snapshot.projects[0]?.path ?? null;
  }
  const selected = snapshot.projects.find((project) => project.path === state.selectedPath) ?? null;

  replace(elements.environment, environmentView(snapshot.environment));
  replace(elements.accounts, [
    accountsView(snapshot.accounts, handlers),
    strayRulesView(snapshot.strayFolderRules, snapshot.strayOwnerRules, handlers),
  ]);
  replace(elements.projects, projectsView(snapshot.projects, snapshot.accounts, state.selectedPath, handlers));
  replace(elements.detail, detailView(selected));

  // The detail panel can grow over the list, so keep the project it describes in view.
  elements.projects.querySelector('.project--selected')?.scrollIntoView({ block: 'nearest' });
  if (focusKey) restoreFocus(focusKey);
}

function replace(container, content) {
  container.replaceChildren(...[content].flat().filter(Boolean));
}

// Re-rendering replaces the nodes, so keyboard focus is handed to the new copy.
function restoreFocus(focusKey) {
  for (const candidate of document.querySelectorAll('[data-focus-key]')) {
    if (candidate.dataset.focusKey === focusKey) {
      candidate.focus();
      return;
    }
  }
}

function setBusy(change) {
  state.pendingOperations += change;
  document.body.classList.toggle('is-busy', state.pendingOperations > 0);
}

function showToast(message, { tone = 'info', sticky = false } = {}) {
  const toast = document.createElement('div');
  toast.className = tone === 'error' ? 'toast toast--error' : 'toast';
  toast.textContent = message;
  elements.toasts.append(toast);

  const dismiss = () => toast.remove();
  if (!sticky) setTimeout(dismiss, TOAST_DURATION_MS);
  return dismiss;
}

// A dialog covers the toasts, so problems with its input are shown next to the fields.
function showFieldErrors(form, errors) {
  for (const slot of form.querySelectorAll('[data-error-for]')) {
    slot.textContent = errors[slot.dataset.errorFor] ?? '';
  }
}

// An error stops being true as soon as the field it talks about is edited.
function clearErrorOnInput(form) {
  form.addEventListener('input', (event) => {
    for (const slot of form.querySelectorAll('[data-error-for]')) {
      if (slot.dataset.errorFor === event.target.name) slot.textContent = '';
    }
  });
}

// Account dialog

function openAccountDialog(account = null) {
  const form = elements.accountForm;
  state.editingAccountId = account?.id ?? null;
  elements.accountDialogTitle.textContent = account ? 'Edit account' : 'Add account';

  form.reset();
  showFieldErrors(form, {});
  showPublicKey(null);
  form.elements.label.value = account?.label ?? '';
  form.elements.gitName.value = account?.gitName ?? '';
  form.elements.gitEmail.value = account?.gitEmail ?? '';
  form.elements.githubUser.value = account?.githubUser ?? '';

  elements.accountDialog.showModal();
  showKeyPath(account?.sshKeyPath ?? '');
  form.elements.label.focus();
  if (account?.sshKeyPath) loadPublicKey(account.sshKeyPath);
}

// The end of a key path is the file name, so that is the part kept in view.
function showKeyPath(keyPath) {
  const input = elements.accountForm.elements.sshKeyPath;
  input.value = keyPath;
  input.scrollLeft = input.scrollWidth;
}

// The public half of the selected key, ready to paste into GitHub.
function showPublicKey(publicKey, note = '') {
  elements.publicKey.hidden = publicKey === null;
  elements.publicKeyText.value = publicKey ?? '';
  elements.publicKeyNote.textContent = note;
}

async function loadPublicKey(keyPath) {
  const result = await api.readPublicKey(keyPath);
  showPublicKey(result.ok ? result.publicKey : null);
}

async function submitAccount(event) {
  event.preventDefault();
  const form = elements.accountForm;
  const draft = {
    id: state.editingAccountId ?? undefined,
    label: form.elements.label.value,
    gitName: form.elements.gitName.value,
    gitEmail: form.elements.gitEmail.value,
    githubUser: form.elements.githubUser.value,
    sshKeyPath: form.elements.sshKeyPath.value,
  };

  const result = await run(() => api.saveAccount(draft));
  if (result?.ok) elements.accountDialog.close();
  else if (result?.errors) showFieldErrors(form, result.errors);
}

async function pickSshKey() {
  const result = await api.pickSshKey();
  if (!result.ok || !result.path) return;

  showKeyPath(result.path);
  showFieldErrors(elements.accountForm, {});
  await loadPublicKey(result.path);
}

async function generateSshKey() {
  const form = elements.accountForm;
  showFieldErrors(form, {});

  const result = await api.generateSshKey({ label: form.elements.label.value, gitEmail: form.elements.gitEmail.value });
  if (!result.ok) {
    showFieldErrors(form, result.errors ?? { sshKeyPath: result.error ?? 'Something went wrong. Try again.' });
    return;
  }

  showKeyPath(result.path);
  showPublicKey(result.publicKey, 'Key created without a passphrase. Save the account to start using it.');
}

async function copyPublicKey() {
  await api.copyText(elements.publicKeyText.value);
  elements.publicKeyNote.textContent = 'Copied.';
}

function clearSshKey() {
  showKeyPath('');
  showPublicKey(null);
}

// Owner rule dialog

function openOwnerDialog(account) {
  const form = elements.ownerForm;
  state.ownerRuleAccountId = account.id;
  elements.ownerDialogIntro.textContent =
    `Repositories whose remote belongs to this user or organization on github.com use "${account.label}", ` +
    'wherever they are on disk and from the moment you clone them.';

  form.reset();
  showFieldErrors(form, {});
  elements.ownerDialog.showModal();
  form.elements.owner.focus();
}

async function submitOwnerRule(event) {
  event.preventDefault();
  const form = elements.ownerForm;

  let result;
  try {
    result = await api.addOwnerRule(state.ownerRuleAccountId, form.elements.owner.value);
  } catch {
    result = { ok: false };
  }
  if (!result.ok) {
    showFieldErrors(form, result.errors ?? { owner: result.error ?? 'Something went wrong. Try again.' });
    return;
  }

  state.snapshot = result.snapshot;
  render();
  elements.ownerDialog.close();
}

document.getElementById('add-account').addEventListener('click', () => openAccountDialog());
document.getElementById('add-project').addEventListener('click', () => run(() => api.addProjects()));
document.getElementById('refresh').addEventListener('click', () => run(() => api.getState()));

document.getElementById('cancel-account').addEventListener('click', () => elements.accountDialog.close());
document.getElementById('pick-ssh-key').addEventListener('click', pickSshKey);
document.getElementById('generate-ssh-key').addEventListener('click', generateSshKey);
document.getElementById('clear-ssh-key').addEventListener('click', clearSshKey);
document.getElementById('copy-public-key').addEventListener('click', copyPublicKey);
elements.accountForm.addEventListener('submit', submitAccount);

document.getElementById('cancel-owner').addEventListener('click', () => elements.ownerDialog.close());
elements.ownerForm.addEventListener('submit', submitOwnerRule);

clearErrorOnInput(elements.accountForm);
clearErrorOnInput(elements.ownerForm);

run(() => api.getState());
