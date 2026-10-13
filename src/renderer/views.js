import { classes, h } from './dom.js';

// Presentational only: these functions turn a snapshot into DOM and report
// what the user did through `handlers`. They never talk to the main process.

const SCOPE_LABELS = {
  local: 'this project',
  global: 'global config',
  system: 'system config',
  worktree: 'this worktree',
  command: 'command line',
};

const RULE_NAMES = {
  folder: 'Folder rule',
  owner: 'Owner rule',
};

export function environmentView(environment) {
  if (environment.gitVersion === null) {
    return [h('span', { class: 'chip chip--problem' }, 'Git not found')];
  }

  const credentialManager = environment.credentialManager.available
    ? h('span', { class: 'chip chip--ok' }, 'Credential manager')
    : h(
        'span',
        { class: 'chip chip--problem', title: 'Sign-in from the app needs Git Credential Manager.' },
        'Credential manager not found',
      );
  return [h('span', { class: 'chip' }, `Git ${environment.gitVersion}`), credentialManager];
}

export function accountsView(accounts, handlers) {
  if (accounts.length === 0) {
    return emptyState('Add your first account', 'An account is the commit author and the GitHub user you push as.');
  }
  return h('ul', {}, accounts.map((account) => accountItem(account, handlers)));
}

/** Rules that still apply in git but whose account is gone from the app. */
export function strayRulesView(folders, owners, handlers) {
  if (folders.length + owners.length === 0) return null;
  return h(
    'div',
    { class: 'stray' },
    h('p', { class: 'stray__title' }, 'Rules without an account'),
    h('p', { class: 'stray__body' }, 'Git still applies these rules, but their account is no longer in the app.'),
    h(
      'ul',
      {},
      folders.map((folder) => folderItem(folder, handlers)),
      owners.map((owner) => ownerItem(owner, handlers)),
    ),
  );
}

export function projectsView(projects, accounts, selectedPath, handlers) {
  if (projects.length === 0) {
    return emptyState(
      'Add a project',
      'Pick a repository to choose its account. For a folder you are going to clone into, use "Add folder" on an account.',
    );
  }
  return h(
    'ul',
    {},
    projects.map((project) => projectItem(project, accounts, project.path === selectedPath, handlers)),
  );
}

export function detailView(project) {
  if (!project) {
    return h('p', { class: 'detail__hint' }, 'Select a project to see who git commits and pushes as there.');
  }
  if (!project.isRepo) {
    return h(
      'p',
      { class: 'detail__hint' },
      `"${project.name}" isn't a git repository anymore. Restore the folder or remove it from the list.`,
    );
  }

  return [
    h('h3', { class: 'detail__title' }, `What git resolves in ${project.name}`),
    h(
      'dl',
      { class: 'facts' },
      fact('Author name', resolvedValue(project.author.name, 'Not set')),
      fact('Author email', resolvedValue(project.author.email, 'Not set')),
      fact('Push account', resolvedValue(project.pushAccount, 'Not set. Your credential manager picks the account.')),
      fact('SSH', sshValue(project.sshCommand)),
      fact('Remotes', remotesValue(project.remotes)),
    ),
    project.warnings.length > 0 &&
      h(
        'ul',
        { class: 'warnings' },
        project.warnings.map((warning) => h('li', { class: 'warning' }, warning)),
      ),
    h('p', { class: 'detail__footnote' }, 'Choosing an account here writes to .git/config inside this project only.'),
  ];
}

function accountItem(account, handlers) {
  const author = `${account.gitName} <${account.gitEmail}>`;
  return h(
    'li',
    { class: 'account' },
    h('span', { class: 'account__avatar', style: { '--avatar-hue': hueFor(account.id) }, 'aria-hidden': 'true' }, initials(account.label)),
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
        account.sshKeyPath && h('span', { class: 'chip', title: account.sshKeyPath }, 'SSH key'),
      ),
      account.folders.length > 0 &&
        h(
          'div',
          { class: 'rules' },
          h('span', { class: 'rules__caption' }, 'Used for everything inside'),
          h('ul', {}, account.folders.map((folder) => folderItem(folder, handlers))),
        ),
      account.owners.length > 0 &&
        h(
          'div',
          { class: 'rules' },
          h('span', { class: 'rules__caption' }, 'Used for repositories owned by'),
          h('ul', {}, account.owners.map((owner) => ownerItem(owner, handlers))),
        ),
      h(
        'div',
        { class: 'rules' },
        account.folders.length + account.owners.length === 0 &&
          h('span', { class: 'rules__caption' }, 'Use it automatically for'),
        h(
          'div',
          { class: 'rules__actions' },
          ruleButton(
            'Add folder',
            'Use this account for every repository inside a folder',
            `add-folder:${account.id}`,
            () => handlers.onAddFolder(account),
          ),
          ruleButton(
            'Add owner',
            'Use this account for every repository of a GitHub user or organization',
            `add-owner:${account.id}`,
            () => handlers.onAddOwner(account),
          ),
        ),
      ),
      h(
        'div',
        { class: 'account__actions' },
        accountAction('Edit', `edit:${account.id}`, () => handlers.onEditAccount(account)),
        accountAction('Remove', `remove:${account.id}`, () => handlers.onRemoveAccount(account)),
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
      title: 'Remove this rule',
      'aria-label': `Remove the rule for ${subject}`,
      dataset: { focusKey },
      onclick,
    },
    '×',
  );
}

function signInStatus(account, handlers) {
  if (account.signedIn === null) return null;
  if (account.signedIn) return h('span', { class: 'chip chip--ok' }, 'Signed in');
  return h(
    'button',
    {
      class: 'button button--small',
      type: 'button',
      dataset: { focusKey: `sign-in:${account.id}`, action: 'sign-in' },
      onclick: () => handlers.onSignIn(account),
    },
    'Sign in',
  );
}

function projectItem(project, accounts, selected, handlers) {
  return h(
    'li',
    { class: classes('project', selected && 'project--selected'), dataset: { path: project.path } },
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
        project.warnings.length > 0 && h('span', { class: 'project__flag', title: 'Needs attention' }, '!'),
        !project.isRepo && h('span', { class: 'chip chip--problem' }, 'Not a git repository'),
      ),
      h('span', { class: 'project__path', title: project.path }, h('bdi', {}, project.displayPath)),
    ),
    accountSelect(project, accounts, handlers),
    h(
      'button',
      {
        class: 'icon-button',
        type: 'button',
        title: 'Remove from the list',
        'aria-label': `Remove ${project.name} from the list`,
        dataset: { focusKey: `remove-project:${project.path}` },
        onclick: () => handlers.onRemoveProject(project),
      },
      '×',
    ),
  );
}

function accountSelect(project, accounts, handlers) {
  const { kind, accountId } = project.assignment;
  const select = h(
    'select',
    {
      class: 'select',
      disabled: !project.isRepo || accounts.length === 0,
      'aria-label': `Account for ${project.name}`,
      dataset: { focusKey: `select:${project.path}` },
      onchange: (event) => handlers.onAssignProject(project, event.target.value || null),
    },
    h('option', { value: '' }, withoutAccountLabel(project, accounts)),
    accounts.map((account) => h('option', { value: account.id }, account.label)),
  );
  // A drifted project shows no account as chosen, so picking its account again is a change and reapplies it.
  select.value = kind === 'account' ? accountId : '';
  return select;
}

// What the project uses when it has no account of its own.
function withoutAccountLabel(project, accounts) {
  const { kind, accountId } = project.assignment;
  const labelOf = (id) => accounts.find((account) => account.id === id)?.label ?? 'an account';

  if (kind === 'custom') return 'Custom (set by hand)';
  if (kind === 'drifted') return `Edited by hand (was ${labelOf(accountId)})`;
  if (project.inherited) return `${RULE_NAMES[project.inherited.via]} (${labelOf(project.inherited.accountId)})`;
  return 'Not set (uses global)';
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
  if (entry === null) return h('span', { class: 'facts__value facts__value--unset' }, 'Default SSH key');
  if (entry.value.trim() === 'ssh') return [h('span', { class: 'facts__value' }, 'Default SSH key'), sourceChip(entry)];
  return [h('span', { class: 'facts__value facts__value--mono' }, entry.value), sourceChip(entry)];
}

// Where git read the value from: a rule of the app, or one of git's own config scopes.
function sourceChip(entry) {
  const source = entry.viaRule ? RULE_NAMES[entry.viaRule].toLowerCase() : (SCOPE_LABELS[entry.scope] ?? entry.scope);
  return h('span', { class: 'chip' }, source);
}

function remotesValue(remotes) {
  if (remotes.length === 0) return h('span', { class: 'facts__value facts__value--unset' }, 'No remotes yet');
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

// A stable color per account, so the same account looks the same every time.
function hueFor(id) {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.codePointAt(0)) % 360;
  return hash;
}
