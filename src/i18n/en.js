// Everything the app says, in English. This is the reference: es.js has the same codes.
//
// A code maps to a sentence. `{name}` is a value filled in when the sentence is said, and
// a sentence that depends on a `count` is written as `{ one, other }`. The codes that the
// core and the main process report (errors, warnings, notices) live here too, next to the
// texts of the page. tests/i18n.test.js keeps the languages and the code in step.

export default {
  // Shared words
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.copy': 'Copy',
  'common.copied': 'Copied.',
  'common.done': 'Done',

  // Top bar
  'toolbar.label': 'Help and settings',
  'toolbar.guide': 'Guide',
  'toolbar.guide.hint': 'Take the guided tour',
  'toolbar.info': 'Info',
  'toolbar.info.hint': 'Versions and where your data is kept',
  'toolbar.settings': 'Settings',
  'toolbar.settings.hint': 'Language and theme',
  'toolbar.refresh': 'Refresh',
  'toolbar.refresh.hint': 'Read git again',
  'environment.gitMissing': 'Git not found',
  'environment.gcmMissing': 'Credential manager not found',
  'environment.gcmMissing.hint': 'Sign-in from the app needs Git Credential Manager.',

  // Accounts
  'accounts.title': 'Accounts',
  'accounts.add': 'Add account',
  'accounts.empty.title': 'Add your first account',
  'accounts.empty.body': 'An account is the commit author and the GitHub user you push as.',
  'account.signedIn': 'Signed in',
  'account.signIn': 'Sign in',
  'account.sshKey': 'SSH key',
  'account.folders.caption': 'Used for everything inside',
  'account.owners.caption': 'Used for repositories owned by',
  'account.rules.caption': 'Use it automatically for',
  'account.addFolder': 'Add folder',
  'account.addFolder.hint': 'Use this account for every repository inside a folder',
  'account.addOwner': 'Add owner',
  'account.addOwner.hint': 'Use this account for every repository of a GitHub user or organization',
  'account.edit': 'Edit',
  'account.remove': 'Remove',
  'rule.add': 'Add rule',
  'rule.remove': 'Remove this rule',
  'rule.remove.label': 'Remove the rule for {subject}',
  'stray.title': 'Rules without an account',
  'stray.body': 'Git still applies these rules, but their account is no longer in the app.',
  'signIn.waiting': 'Finish signing in to GitHub in the Git Credential Manager window.',
  'signIn.done': 'Signed in as {user}.',
  'signIn.otherAccount':
    'The sign-in finished, but "{user}" isn\'t signed in. Check which GitHub account your browser used.',
  'signIn.failed': "The sign-in didn't finish.",
  'signIn.failedBecause': "The sign-in didn't finish. {detail}",
  'account.missing': 'That account no longer exists.',
  'account.inUse': {
    one: 'This account is assigned to 1 project. Move it to another account first.',
    other: 'This account is assigned to {count} projects. Move them to another account first.',
  },
  'account.hasRules': {
    one: 'This account still has 1 rule. Remove it first.',
    other: 'This account still has {count} rules. Remove them first.',
  },

  // Account form
  'accountDialog.edit': 'Edit account',
  'accountDialog.intro':
    'An account is who git commits and pushes as. Passwords and tokens stay in your credential manager.',
  'accountDialog.label': 'Label',
  'accountDialog.label.placeholder': 'Work',
  'accountDialog.githubUser': 'GitHub username',
  'accountDialog.githubUser.hint': 'The user you push as on github.com.',
  'accountDialog.gitName': 'Name on commits',
  'accountDialog.gitEmail': 'Email on commits',
  'accountDialog.sshKey': 'SSH private key (optional)',
  'accountDialog.sshKey.placeholder': 'No key selected',
  'accountDialog.sshKey.choose': 'Choose file',
  'accountDialog.sshKey.generate': 'Generate',
  'accountDialog.sshKey.clear': 'Clear',
  'accountDialog.sshKey.hint': 'Only needed for projects whose remote uses SSH.',
  'accountDialog.publicKey': 'Public key',
  'accountDialog.publicKey.hint': 'Add it to this account on github.com, under Settings, SSH and GPG keys, New SSH key.',
  'accountDialog.publicKey.created': 'Key created without a passphrase. Save the account to start using it.',
  'accountDialog.save': 'Save account',
  'field.controlCharacters': "This can't contain line breaks or other control characters.",
  'label.required': 'Enter a label, such as Work or Personal.',
  'label.tooLong': 'Use {max} characters or fewer.',
  'label.taken': 'Another account already uses this label.',
  'gitName.required': 'Enter the name that goes on your commits.',
  'gitName.tooLong': 'Use {max} characters or fewer.',
  'gitEmail.required': 'Enter the email that goes on your commits.',
  'gitEmail.invalid': 'Enter a complete email address, like ada@example.com.',
  'githubUser.required': 'Enter the GitHub username you push with.',
  'githubUser.invalid': 'Enter the username alone: letters, numbers, hyphens and underscores, up to 39 characters.',
  'sshKeyPath.publicKey': 'That is the public key. Choose the private key: the file without .pub.',
  'sshKeyPath.missing': "That file doesn't exist. Choose the private key again.",
  'sshKey.labelRequired': 'Enter a label first. The key file is named after it.',
  'sshKey.exists': 'A key named {name} already exists. Select it with "Choose file".',
  'sshKey.keygenMissing': 'ssh-keygen was not found. Install the OpenSSH client, or create the key yourself and choose it.',
  'sshKey.failed': "The key couldn't be created. Check that you can write to the .ssh folder.",

  // Rules
  'ownerDialog.title': 'Add owner rule',
  'ownerDialog.intro':
    'Repositories whose remote belongs to this user or organization on github.com use "{account}", wherever they are on disk and from the moment you clone them.',
  'ownerDialog.owner': 'GitHub user or organization',
  'ownerDialog.owner.hint': 'You can also paste the URL of one of its repositories.',
  'ownerDialog.note':
    'This adds a rule to your global git config. Your global name and email stay as they are, and a project with its own account keeps it.',
  'owner.invalid': 'Enter a GitHub user or organization, like "acme", or paste a repository URL.',
  'owner.taken': '"{owner}" already uses {account}. Remove that rule first.',
  'owner.takenByStray': '"{owner}" already has a rule whose account is no longer in the app. Remove that rule first.',
  'folder.required': 'Choose a folder first.',
  'folder.missing': '"{folder}" doesn\'t exist anymore.',
  'folder.pattern':
    'Git can\'t target "{folder}" exactly because its path contains *, ?, or brackets. Choose another folder.',
  'folder.taken': '"{folder}" already uses {account}. Remove that rule first.',
  'folder.takenByStray': '"{folder}" already has a rule whose account is no longer in the app. Remove that rule first.',
  'confirm.addFolder.title': 'Add folder rule',
  'confirm.addFolder.question': 'Use "{account}" for everything inside {folder}?',
  'confirm.addFolder.detail':
    'This adds one rule to your global git config. It loads the settings of this account for repositories in that folder, including ones you clone later. Your global name and email stay as they are, and a project with its own account keeps it.',
  'confirm.removeRule.title': 'Remove rule',
  'confirm.removeFolder.question': 'Remove the rule for {folder}?',
  'confirm.removeFolder.detail':
    'Repositories inside it go back to your global identity, unless another rule or their own account applies.',
  'confirm.removeOwner.question': 'Remove the rule for repositories owned by {owner}?',
  'confirm.removeOwner.detail':
    'They go back to your global identity, unless another rule or their own account applies.',
  'confirm.removeAccount.title': 'Remove account',
  'confirm.removeAccount.question': 'Remove the account "{account}" from the app?',
  'confirm.removeAccount.detail':
    'Its sign-in stays in your credential manager and its SSH key stays on disk. Only the app forgets the account.',

  // Projects
  'projects.title': 'Projects',
  'projects.add': 'Add project',
  'projects.empty.title': 'Add a project',
  'projects.empty.body':
    'Pick a repository to choose its account. For a folder you are going to clone into, use "Add folder" on an account.',
  'project.needsAttention': 'Needs attention',
  'project.status.notRepository': 'Not a git repository',
  'project.remove': 'Remove from the list',
  'project.remove.label': 'Remove {name} from the list',
  'project.removed': 'Removed {name} from the list. Its git config was left as it is.',
  'project.reorder': 'Drag to reorder, or use the up and down arrow keys',
  'project.reorder.label': 'Reorder {name}',
  'project.moved': '{name} moved to position {position} of {total}.',
  'project.account.label': 'Account for {name}',
  'project.account.unset': 'Not set (uses global)',
  'project.account.custom': 'Custom (set by hand)',
  'project.account.drifted': 'Edited by hand (was {account})',
  'project.account.folderRule': 'Folder rule ({account})',
  'project.account.ownerRule': 'Owner rule ({account})',
  'project.account.unknown': 'an account',
  'project.notRepository':
    '"{name}" isn\'t a git repository, so it can\'t be a project. To use an account for everything you clone into it, choose "Add folder" on that account.',
  'project.alreadyListed': '"{name}" is already in the list.',
  'project.untracked': "That project isn't in the list anymore.",
  'project.noLongerRepository': "This folder isn't a git repository anymore.",

  // What git resolves in a project
  'detail.empty': 'Select a project to see who git commits and pushes as there.',
  'detail.notRepository': '"{name}" isn\'t a git repository anymore. Restore the folder or remove it from the list.',
  'detail.title': 'What git resolves in {name}',
  'detail.authorName': 'Author name',
  'detail.authorEmail': 'Author email',
  'detail.pushAccount': 'Push account',
  'detail.pushAccount.notSet': 'Not set. Your credential manager picks the account.',
  'detail.remotes': 'Remotes',
  'detail.remotes.none': 'No remotes yet',
  'detail.notSet': 'Not set',
  'detail.ssh.default': 'Default SSH key',
  'detail.footnote': 'Choosing an account here writes to .git/config inside this project only.',
  'source.local': 'this project',
  'source.global': 'global config',
  'source.system': 'system config',
  'source.worktree': 'this worktree',
  'source.command': 'command line',
  'source.folderRule': 'folder rule',
  'source.ownerRule': 'owner rule',
  'warning.drifted': "This project's git config no longer matches the account. Choose the account again to reapply it.",
  'warning.notSignedIn':
    'You\'re not signed in as "{user}" yet. Use "Sign in" on the account, or git will ask the first time you push.',
  'warning.sshNoKey':
    'The remote "{remote}" uses SSH and this account has no SSH key, so git pushes with your default key, which may belong to another account. Add a key to the account, or switch the remote to HTTPS.',
  'warning.pinnedUser':
    'The URL of the remote "{remote}" is pinned to the user "{user}", so git pushes as that user. Remove the user from the URL.',
  'warning.embeddedCredential':
    'The URL of the remote "{remote}" has a credential written in it, and git uses it instead of this account. Remove it from the URL.',
  'warning.notGithub': 'The remote "{remote}" is not on github.com, so this account does not apply to it.',

  // Settings
  'settings.intro': 'Changes apply right away.',
  'settings.language': 'Language',
  'settings.theme': 'Theme',
  'settings.theme.system': 'Same as the system',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',

  // Info
  'info.title': 'About Commit Hats',
  'info.system': 'System',
  'info.dataFolder': 'Data folder',
  'info.dataFolder.hint':
    'Your accounts, your list of projects and your settings are kept in the data folder. Sign-ins stay in your credential manager, never here.',
  'info.installed': 'Installed',
  'info.notFound': 'Not found',
  'info.copy': 'Copy versions',

  // Guided tour
  'tour.progress': 'Step {current} of {total}',
  'tour.skip': 'Skip',
  'tour.back': 'Back',
  'tour.next': 'Next',
  'tour.welcome.title': 'One hat per project',
  'tour.welcome.body':
    'Commit Hats makes each project commit and push with the account you choose. Your global git config stays as it is.',
  'tour.accounts.title': 'Your accounts',
  'tour.accounts.body':
    'An account is the commit author and the GitHub user you push as. Add one for each identity you work with. The green mark means that account is signed in.',
  'tour.rules.title': 'Rules do it for you',
  'tour.rules.body':
    'On an account, "Add folder" uses it for every repository inside a folder, and "Add owner" for every repository of a GitHub user or organization. That includes the ones you clone later.',
  'tour.projects.title': 'Your projects',
  'tour.projects.body':
    'Add the repositories you work on and choose an account for each one. Drag a project by the dots on its left to reorder the list.',
  'tour.detail.title': 'What git will do',
  'tour.detail.body':
    'For the selected project: who commits, who pushes and with which SSH key, and where each value comes from. Anything that needs attention shows up here.',
  'tour.toolbar.title': 'Help and settings',
  'tour.toolbar.body':
    'Guide opens this tour again. Info shows the versions in use. Settings changes the language and the theme. Refresh reads git again.',

  // Native dialogs
  'dialog.pickSshKey.title': 'Choose the SSH private key',
  'dialog.pickFolder.title': 'Choose the folder this account is used in',
  'dialog.pickFolder.button': 'Choose',
  'dialog.addProjects.title': 'Add project folders',
  'dialog.addProjects.button': 'Add',

  // Failures nobody chose
  'git.failed': "Git couldn't finish that: {detail}",
  'error.gitNotFound': 'Git was not found. Install Git, then restart the app.',
  'error.gitTimeout': 'Git took too long to answer. Try again.',
  'error.generic': 'Something went wrong. Try again.',
  'error.untrustedSender': 'This request did not come from the app window.',
};
