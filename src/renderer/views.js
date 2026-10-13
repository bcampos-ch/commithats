import { LANGUAGE_NAMES } from '../i18n/translator.js';
import { classes, h } from './dom.js';
import { dropdown } from './dropdown.js';
import { t } from './i18n.js';

// Presentational only: these functions turn a snapshot into DOM and report
// what the user did through `handlers`. They never talk to the main process.
//
// Every sentence is asked for by passing `t` its code as a literal, even where a
// lookup by name would be shorter: the dictionary tests find the codes by reading
// this file, so a code that is misspelled or no longer used does not go unnoticed.

// Where git read a value from: one of its own config scopes, or a rule of the app.
const SCOPE_NAMES = {
  local: () => t('source.local'),
  global: () => t('source.global'),
  system: () => t('source.system'),
  worktree: () => t('source.worktree'),
  command: () => t('source.command'),
};

const RULE_SOURCE_NAMES = {
  folder: () => t('source.folderRule'),
  owner: () => t('source.ownerRule'),
};

const LANGUAGE_OPTIONS = Object.entries(LANGUAGE_NAMES).map(([value, label]) => ({ value, label }));

/** What is missing from the tools the app relies on. Nothing is shown while they are all there. */
export function environmentView(environment) {
  if (environment.gitVersion === null) {
    return h('span', { class: 'chip chip--problem' }, t('environment.gitMissing'));
  }
  if (!environment.credentialManager.available) {
    return h('span', { class: 'chip chip--problem', title: t('environment.gcmMissing.hint') }, t('environment.gcmMissing'));
  }
  return null;
}

export function accountsView(accounts, handlers) {
  if (accounts.length === 0) return emptyState(t('accounts.empty.title'), t('accounts.empty.body'));
  return h('ul', {}, accounts.map((account) => accountItem(account, handlers)));
}

/** Rules that still apply in git but whose account is gone from the app. */
export function strayRulesView(folders, owners, handlers) {
  if (folders.length + owners.length === 0) return null;
  return h(
    'div',
    { class: 'stray' },
    h('p', { class: 'stray__title' }, t('stray.title')),
    h('p', { class: 'stray__body' }, t('stray.body')),
    h(
      'ul',
      {},
      folders.map((folder) => folderItem(folder, handlers)),
      owners.map((owner) => ownerItem(owner, handlers)),
    ),
  );
}

export function projectsView(projects, accounts, selectedPath, handlers) {
  if (projects.length === 0) return emptyState(t('projects.empty.title'), t('projects.empty.body'));

  // A list of one has no other order to be put in.
  const sortable = projects.length > 1;
  return h(
    'ul',
    {},
    projects.map((project) => projectItem(project, accounts, { selected: project.path === selectedPath, sortable }, handlers)),
  );
}

export function detailView(project) {
  if (!project) return h('p', { class: 'detail__hint' }, t('detail.empty'));
  if (!project.isRepo) return h('p', { class: 'detail__hint' }, t('detail.notRepository', { name: project.name }));

  return [
    h('h3', { class: 'detail__title' }, t('detail.title', { name: project.name })),
    h(
      'dl',
      { class: 'facts' },
      fact(t('detail.authorName'), resolvedValue(project.author.name, t('detail.notSet'))),
      fact(t('detail.authorEmail'), resolvedValue(project.author.email, t('detail.notSet'))),
      fact(t('detail.pushAccount'), resolvedValue(project.pushAccount, t('detail.pushAccount.notSet'))),
      fact('SSH', sshValue(project.sshCommand)),
      fact(t('detail.remotes'), remotesValue(project.remotes)),
    ),
    project.warnings.length > 0 &&
      h(
        'ul',
        { class: 'warnings' },
        project.warnings.map((warning) => h('li', { class: 'warning' }, t(warning))),
      ),
    h('p', { class: 'detail__footnote' }, t('detail.footnote')),
  ];
}

/** The two settings of the app. Each one is saved, and applied, as soon as it is changed. */
export function settingsView(settings, handlers) {
  return [
    settingField(
      t('settings.language'),
      dropdown({
        label: t('settings.language'),
        value: settings.language,
        options: LANGUAGE_OPTIONS,
        focusKey: 'setting:language',
        onChange: (language) => handlers.onChangeSettings({ language }),
      }),
    ),
    settingField(
      t('settings.theme'),
      dropdown({
        label: t('settings.theme'),
        value: settings.theme,
        options: [
          { value: 'system', label: t('settings.theme.system') },
          { value: 'light', label: t('settings.theme.light') },
          { value: 'dark', label: t('settings.theme.dark') },
        ],
        focusKey: 'setting:theme',
        onChange: (theme) => handlers.onChangeSettings({ theme }),
      }),
    ),
  ];
}

/**
 * The versions of everything the app runs on, as rows of `[name, version]`: the same
 * rows are shown in the Info dialog and copied as text for a bug report.
 * `info` comes from the main process and `environment` from the snapshot.
 */
export function versionRows(info, environment) {
  const { gitVersion, credentialManager } = environment;
  const credentialManagerVersion = credentialManager.available
    ? (credentialManager.version ?? t('info.installed'))
    : t('info.notFound');

  return [
    ['Commit Hats', info.version],
    ['Git', gitVersion ?? t('info.notFound')],
    ['Git Credential Manager', credentialManagerVersion],
    ['Electron', info.electron],
    ['Chromium', info.chrome],
    ['Node.js', info.node],
    [t('info.system'), info.system],
  ];
}

export function infoView(info, environment) {
  return [
    h(
      'dl',
      { class: 'facts' },
      versionRows(info, environment).map(([name, version]) => fact(name, h('span', { class: 'facts__value' }, version))),
      fact(t('info.dataFolder'), h('span', { class: 'facts__value facts__value--mono' }, info.dataDir)),
    ),
    h('p', { class: 'dialog__note' }, t('info.dataFolder.hint')),
  ];
}

function accountItem(account, handlers) {
  const author = `${account.gitName} <${account.gitEmail}>`;
  return h(
    'li',
    { class: 'account' },
    h('span', { class: 'account__avatar', dataset: { color: colorFor(account.id) }, 'aria-hidden': 'true' }, initials(account.label)),
    h(
      'div',
      { class: 'account__text' },
      h('span', { class: 'account__label' }, account.label),
      h('span', { class: 'account__user' }, `@${account.githubUser}`),
      h('span', { class: 'account__author', title: author }, author),
      h(
        'div',
        { class: 'account__footer' },
        signInStatus(account, handlers),
        account.sshKeyPath && h('span', { class: 'chip', title: account.sshKeyPath }, t('account.sshKey')),
      ),
      account.folders.length > 0 &&
        h(
          'div',
          { class: 'rules' },
          h('span', { class: 'rules__caption' }, t('account.folders.caption')),
          h('ul', {}, account.folders.map((folder) => folderItem(folder, handlers))),
        ),
      account.owners.length > 0 &&
        h(
          'div',
          { class: 'rules' },
          h('span', { class: 'rules__caption' }, t('account.owners.caption')),
          h('ul', {}, account.owners.map((owner) => ownerItem(owner, handlers))),
        ),
      h(
        'div',
        { class: 'rules' },
        account.folders.length + account.owners.length === 0 &&
          h('span', { class: 'rules__caption' }, t('account.rules.caption')),
        h(
          'div',
          { class: 'rules__actions', dataset: { tour: 'rules' } },
          ruleButton(t('account.addFolder'), t('account.addFolder.hint'), `add-folder:${account.id}`, () =>
            handlers.onAddFolder(account),
          ),
          ruleButton(t('account.addOwner'), t('account.addOwner.hint'), `add-owner:${account.id}`, () =>
            handlers.onAddOwner(account),
          ),
        ),
      ),
      h(
        'div',
        { class: 'account__actions' },
        accountAction(t('account.edit'), `edit:${account.id}`, () => handlers.onEditAccount(account)),
        accountAction(t('account.remove'), `remove:${account.id}`, () => handlers.onRemoveAccount(account)),
      ),
    ),
  );
}

// Rules are the main thing to do with an account, so they get real buttons.
function ruleButton(label, title, focusKey, onclick) {
  return h('button', { class: 'button button--small', type: 'button', title, dataset: { focusKey }, onclick }, label);
}

function accountAction(label, focusKey, onclick) {
  return h('button', { class: 'link-button', type: 'button', dataset: { focusKey }, onclick }, label);
}

function folderItem(folder, handlers) {
  return h(
    'li',
    { class: 'rule folder' },
    h('span', { class: 'rule__text rule__text--path', title: folder.path }, h('bdi', {}, folder.displayPath)),
    removeRuleButton(folder.displayPath, `remove-folder:${folder.path}`, () => handlers.onRemoveFolder(folder)),
  );
}

function ownerItem(owner, handlers) {
  return h(
    'li',
    { class: 'rule owner' },
    h('span', { class: 'rule__text', title: `github.com/${owner}` }, owner),
    removeRuleButton(owner, `remove-owner:${owner}`, () => handlers.onRemoveOwner(owner)),
  );
}

function removeRuleButton(subject, focusKey, onclick) {
  return h(
    'button',
    {
      class: 'icon-button icon-button--small',
      type: 'button',
      title: t('rule.remove'),
      'aria-label': t('rule.remove.label', { subject }),
      dataset: { focusKey },
      onclick,
    },
    '×',
  );
}

function signInStatus(account, handlers) {
  if (account.signedIn === null) return null;
  if (account.signedIn) return h('span', { class: 'chip chip--ok' }, t('account.signedIn'));
  return h(
    'button',
    {
      class: 'button button--small',
      type: 'button',
      dataset: { focusKey: `sign-in:${account.id}`, action: 'sign-in' },
      onclick: () => handlers.onSignIn(account),
    },
    t('account.signIn'),
  );
}

function projectItem(project, accounts, { selected, sortable }, handlers) {
  return h(
    'li',
    { class: classes('project', selected && 'project--selected'), dataset: { path: project.path } },
    reorderHandle(project, sortable),
    h(
      'button',
      {
        class: 'project__main',
        type: 'button',
        'aria-pressed': String(selected),
        dataset: { focusKey: `project:${project.path}` },
        onclick: () => handlers.onSelectProject(project),
      },
      h(
        'span',
        { class: 'project__name' },
        project.name,
        project.warnings.length > 0 && h('span', { class: 'project__flag', title: t('project.needsAttention') }, '!'),
        !project.isRepo && h('span', { class: 'chip chip--problem' }, t('project.status.notRepository')),
      ),
      h('span', { class: 'project__path', title: project.path }, h('bdi', {}, project.displayPath)),
    ),
    accountSelect(project, accounts, handlers),
    h(
      'button',
      {
        class: 'icon-button',
        type: 'button',
        title: t('project.remove'),
        'aria-label': t('project.remove.label', { name: project.name }),
        dataset: { focusKey: `remove-project:${project.path}` },
        onclick: () => handlers.onRemoveProject(project),
      },
      '×',
    ),
  );
}

// What a project is dragged by, and what takes the arrow keys. See reorder.js.
// Not a <button>: a drag cannot start from one in every browser engine.
function reorderHandle(project, sortable) {
  if (!sortable) return h('span', { class: 'project__grip project__grip--idle', 'aria-hidden': 'true' });
  return h('span', {
    class: 'project__grip',
    role: 'button',
    tabIndex: 0,
    title: t('project.reorder'),
    'aria-label': t('project.reorder.label', { name: project.name }),
    dataset: { reorderHandle: '', focusKey: `grip:${project.path}` },
  });
}

function accountSelect(project, accounts, handlers) {
  const { kind, accountId } = project.assignment;
  return dropdown({
    label: t('project.account.label', { name: project.name }),
    // A drifted project shows no account as chosen, so picking its account again is a change and reapplies it.
    value: kind === 'account' ? accountId : '',
    options: [
      { value: '', label: withoutAccountLabel(project, accounts) },
      ...accounts.map((account) => ({ value: account.id, label: account.label })),
    ],
    disabled: !project.isRepo || accounts.length === 0,
    focusKey: `select:${project.path}`,
    onChange: (value) => handlers.onAssignProject(project, value || null),
  });
}

// What the project uses when it has no account of its own.
function withoutAccountLabel(project, accounts) {
  const { kind, accountId } = project.assignment;
  const labelOf = (id) => accounts.find((account) => account.id === id)?.label ?? t('project.account.unknown');

  if (kind === 'custom') return t('project.account.custom');
  if (kind === 'drifted') return t('project.account.drifted', { account: labelOf(accountId) });
  if (project.inherited?.via === 'folder') return t('project.account.folderRule', { account: labelOf(project.inherited.accountId) });
  if (project.inherited?.via === 'owner') return t('project.account.ownerRule', { account: labelOf(project.inherited.accountId) });
  return t('project.account.unset');
}

function settingField(label, control) {
  return h('div', { class: 'field' }, h('span', { class: 'field__label' }, label), control);
}

function fact(term, description) {
  return [h('dt', {}, term), h('dd', {}, description)];
}

function resolvedValue(entry, fallback) {
  if (entry === null) return h('span', { class: 'facts__value facts__value--unset' }, fallback);
  return [h('span', { class: 'facts__value' }, entry.value), sourceChip(entry)];
}

// Plain `ssh` is what git runs by default, so it reads better as words than as a command.
function sshValue(entry) {
  if (entry === null) return h('span', { class: 'facts__value facts__value--unset' }, t('detail.ssh.default'));
  if (entry.value.trim() === 'ssh') return [h('span', { class: 'facts__value' }, t('detail.ssh.default')), sourceChip(entry)];
  return [h('span', { class: 'facts__value facts__value--mono' }, entry.value), sourceChip(entry)];
}

// Where git read the value from: a rule of the app, or one of git's own config scopes.
function sourceChip(entry) {
  const name = entry.viaRule ? RULE_SOURCE_NAMES[entry.viaRule] : SCOPE_NAMES[entry.scope];
  return h('span', { class: 'chip' }, name ? name() : entry.scope);
}

function remotesValue(remotes) {
  if (remotes.length === 0) return h('span', { class: 'facts__value facts__value--unset' }, t('detail.remotes.none'));
  return remotes.map((remote) =>
    h(
      'span',
      { class: 'remote' },
      h('span', { class: 'remote__name' }, remote.name),
      h('span', { class: 'facts__value facts__value--mono' }, remote.display),
    ),
  );
}

function emptyState(title, body) {
  return h('div', { class: 'empty' }, h('p', { class: 'empty__title' }, title), h('p', { class: 'empty__body' }, body));
}

function initials(label) {
  const words = label.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

// The colors an account tile can take. None of them is close to the salmon accent, or to
// the green that says an account is signed in: a tile is told apart by its color, not judged by it.
const AVATAR_COLORS = ['blue', 'cyan', 'yellow', 'magenta', 'violet'];

// A stable color per account, so the same account looks the same every time.
function colorFor(id) {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.codePointAt(0)) % 9973;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
