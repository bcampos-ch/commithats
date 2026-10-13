import { confirm } from './confirm.js';
import { setLanguage, t } from './i18n.js';
import { makeReorderable } from './reorder.js';
import { createTour } from './tour.js';
import {
  accountsView,
  detailView,
  environmentView,
  infoView,
  projectsView,
  settingsView,
  strayRulesView,
  versionRows,
} from './views.js';

// Container: owns the state, talks to the main process, and re-renders the views.

const api = window.accountSwitcher;
const TOAST_DURATION_MS = 6000;
// What is said when something fails in a way nobody planned for.
const UNEXPECTED_FAILURE = { code: 'error.generic' };

const elements = {
  environment: document.getElementById('environment'),
  accounts: document.getElementById('accounts'),
  projects: document.getElementById('projects'),
  detail: document.getElementById('detail'),
  toasts: document.getElementById('toasts'),
  announcer: document.getElementById('announcer'),
  accountDialog: document.getElementById('account-dialog'),
  accountDialogTitle: document.getElementById('account-dialog-title'),
  accountForm: document.getElementById('account-form'),
  publicKey: document.getElementById('public-key'),
  publicKeyText: document.getElementById('public-key-text'),
  publicKeyNote: document.getElementById('public-key-note'),
  ownerDialog: document.getElementById('owner-dialog'),
  ownerDialogIntro: document.getElementById('owner-dialog-intro'),
  ownerForm: document.getElementById('owner-form'),
  settingsDialog: document.getElementById('settings-dialog'),
  settingsBody: document.getElementById('settings-body'),
  infoDialog: document.getElementById('info-dialog'),
  infoBody: document.getElementById('info-body'),
  infoNote: document.getElementById('info-note'),
};

const state = {
  snapshot: null,
  // What the main process knows about the running app. It does not change while the app runs.
  appInfo: null,
  selectedPath: null,
  editingAccountId: null,
  ownerRuleAccountId: null,
  pendingOperations: 0,
  pendingMoves: 0,
};

const tour = createTour({ onClose: rememberTourWasSeen });

const handlers = {
  onEditAccount: (account) => openAccountDialog(account),

  async onRemoveAccount(account) {
    const confirmed = await confirm({
      title: t('confirm.removeAccount.title'),
      question: t('confirm.removeAccount.question', { account: account.label }),
      detail: t('confirm.removeAccount.detail'),
      action: t('account.remove'),
    });
    if (confirmed) await run(() => api.removeAccount(account.id));
  },

  async onSignIn(account) {
    const dismiss = showToast(t('signIn.waiting'), { sticky: true });
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

    const confirmed = await confirm({
      title: t('confirm.addFolder.title'),
      question: t('confirm.addFolder.question', { account: account.label, folder: picked.displayPath }),
      detail: t('confirm.addFolder.detail'),
      action: t('rule.add'),
    });
    if (confirmed) await run(() => api.addFolderRule(account.id, picked.path));
  },

  async onRemoveFolder(folder) {
    const confirmed = await confirm({
      title: t('confirm.removeRule.title'),
      question: t('confirm.removeFolder.question', { folder: folder.displayPath }),
      detail: t('confirm.removeFolder.detail'),
      action: t('confirm.removeRule.title'),
    });
    if (confirmed) await run(() => api.removeFolderRule(folder.path));
  },

  onAddOwner: (account) => openOwnerDialog(account),

  async onRemoveOwner(owner) {
    const confirmed = await confirm({
      title: t('confirm.removeRule.title'),
      question: t('confirm.removeOwner.question', { owner }),
      detail: t('confirm.removeOwner.detail'),
      action: t('confirm.removeRule.title'),
    });
    if (confirmed) await run(() => api.removeOwnerRule(owner));
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
    if (result?.ok) showToast(t('project.removed', { name: project.name }));
  },

  async onChangeSettings(change) {
    const result = await run(() => api.saveSettings(change), { blocking: false });
    if (result?.ok) applySettings(result.settings);
  },
};

/**
 * Runs an operation against the main process and applies its answer:
 * a new snapshot re-renders the page, notices and errors become toasts.
 * Field errors are returned to the caller, which knows where to show them.
 *
 * `blocking` keeps the page from being clicked while the operation runs. `keepsSnapshot`
 * is asked when the answer arrives, and says whether its snapshot is still the latest word.
 */
async function run(operation, { blocking = true, keepsSnapshot = () => true } = {}) {
  if (blocking) setBusy(+1);
  try {
    const result = await operation();
    if (result.snapshot && keepsSnapshot()) applySnapshot(result.snapshot);
    for (const notice of result.notices ?? []) showToast(t(notice));
    if (!result.ok && result.error) showToast(t(result.error), { tone: 'error' });
    return result;
  } catch {
    showToast(t(UNEXPECTED_FAILURE), { tone: 'error' });
    return null;
  } finally {
    if (blocking) setBusy(-1);
  }
}

function applySnapshot(snapshot) {
  state.snapshot = snapshot;
  setLanguage(snapshot.settings.language);
  render();
}

// Settings change nothing in git, so they are swapped in without reading everything again.
function applySettings(settings) {
  if (state.snapshot) applySnapshot({ ...state.snapshot, settings });
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
  replace(elements.settingsBody, settingsView(snapshot.settings, handlers));
  if (state.appInfo) replace(elements.infoBody, infoView(state.appInfo, snapshot.environment));

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

function showToast(text, { tone = 'info', sticky = false } = {}) {
  const toast = document.createElement('div');
  toast.className = tone === 'error' ? 'toast toast--error' : 'toast';
  toast.textContent = text;
  elements.toasts.append(toast);

  const dismiss = () => toast.remove();
  if (!sticky) setTimeout(dismiss, TOAST_DURATION_MS);
  return dismiss;
}

// For changes that are seen but not heard: a screen reader reads what is written here.
function announce(text) {
  elements.announcer.textContent = text;
}

// A dialog covers the toasts, so problems with its input are shown next to the fields.
function showFieldErrors(form, errors) {
  for (const slot of form.querySelectorAll('[data-error-for]')) {
    const problem = errors[slot.dataset.errorFor];
    slot.textContent = problem ? t(problem) : '';
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

// Projects: their order

// The list follows the hand at once; reading git again to confirm it comes after.
async function moveProject(from, to) {
  const projects = [...state.snapshot.projects];
  const [project] = projects.splice(from, 1);
  projects.splice(to, 0, project);
  state.snapshot = { ...state.snapshot, projects };
  render();
  announce(t('project.moved', { name: project.name, position: to + 1, total: projects.length }));

  state.pendingMoves += 1;
  const result = await run(
    async () => {
      try {
        return await api.moveProject(project.path, to);
      } finally {
        state.pendingMoves -= 1;
      }
    },
    // While another move is on its way, this answer already shows an order that is gone.
    { blocking: false, keepsSnapshot: () => state.pendingMoves === 0 },
  );
  // A refused move leaves the list showing an order that was never saved.
  if (!result?.ok) await run(() => api.getState());
}

// Guided tour

function startTour() {
  // The tour is modal: whatever else is open closes.
  for (const dialog of document.querySelectorAll('dialog[open]:not(.tour)')) dialog.close();
  tour.start();
}

// The tour only starts on its own until it has been seen once, finished or not.
async function rememberTourWasSeen() {
  if (!state.snapshot || state.snapshot.settings.tourSeen) return;
  await handlers.onChangeSettings({ tourSeen: true });
}

// Settings and Info dialogs

function openInfoDialog() {
  elements.infoNote.textContent = '';
  elements.infoDialog.showModal();
}

async function copyVersions() {
  if (!state.appInfo) return;

  const lines = versionRows(state.appInfo, state.snapshot.environment).map(([name, version]) => `${name}: ${version}`);
  await api.copyText(lines.join('\n'));
  elements.infoNote.textContent = t('common.copied');
}

// Account dialog

function openAccountDialog(account = null) {
  const form = elements.accountForm;
  state.editingAccountId = account?.id ?? null;
  elements.accountDialogTitle.textContent = account ? t('accountDialog.edit') : t('accounts.add');

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
    showFieldErrors(form, result.errors ?? { sshKeyPath: result.error ?? UNEXPECTED_FAILURE });
    return;
  }

  showKeyPath(result.path);
  showPublicKey(result.publicKey, t('accountDialog.publicKey.created'));
}

async function copyPublicKey() {
  await api.copyText(elements.publicKeyText.value);
  elements.publicKeyNote.textContent = t('common.copied');
}

function clearSshKey() {
  showKeyPath('');
  showPublicKey(null);
}

// Owner rule dialog

function openOwnerDialog(account) {
  const form = elements.ownerForm;
  state.ownerRuleAccountId = account.id;
  elements.ownerDialogIntro.textContent = t('ownerDialog.intro', { account: account.label });

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
    showFieldErrors(form, result.errors ?? { owner: result.error ?? UNEXPECTED_FAILURE });
    return;
  }

  applySnapshot(result.snapshot);
  elements.ownerDialog.close();
}

document.getElementById('add-account').addEventListener('click', () => openAccountDialog());
document.getElementById('add-project').addEventListener('click', () => run(() => api.addProjects()));
document.getElementById('refresh').addEventListener('click', () => run(() => api.getState()));
document.getElementById('open-guide').addEventListener('click', startTour);
document.getElementById('open-info').addEventListener('click', openInfoDialog);
document.getElementById('open-settings').addEventListener('click', () => elements.settingsDialog.showModal());

document.getElementById('cancel-account').addEventListener('click', () => elements.accountDialog.close());
document.getElementById('pick-ssh-key').addEventListener('click', pickSshKey);
document.getElementById('generate-ssh-key').addEventListener('click', generateSshKey);
document.getElementById('clear-ssh-key').addEventListener('click', clearSshKey);
document.getElementById('copy-public-key').addEventListener('click', copyPublicKey);
elements.accountForm.addEventListener('submit', submitAccount);

document.getElementById('cancel-owner').addEventListener('click', () => elements.ownerDialog.close());
elements.ownerForm.addEventListener('submit', submitOwnerRule);

document.getElementById('close-settings').addEventListener('click', () => elements.settingsDialog.close());
document.getElementById('close-info').addEventListener('click', () => elements.infoDialog.close());
document.getElementById('copy-info').addEventListener('click', copyVersions);

clearErrorOnInput(elements.accountForm);
clearErrorOnInput(elements.ownerForm);
makeReorderable(elements.projects, { rowSelector: '.project', onMove: moveProject });

async function start() {
  const [info] = await Promise.all([api.getAppInfo().catch(() => ({ ok: false })), run(() => api.getState())]);
  if (info.ok) {
    state.appInfo = info.info;
    render();
  }
  // The first time the app opens, the tour introduces it.
  if (state.snapshot && !state.snapshot.settings.tourSeen) startTour();
}

start();
