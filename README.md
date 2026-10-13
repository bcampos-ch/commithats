# Git Account Switcher

Pick which GitHub account your local projects commit and push as: one project at a time, a whole folder at once, or by who owns the remote. Your global name, email, and credentials never change, and nothing has to keep running in the background.

![The app with two accounts, their rules, and five projects](docs/screenshot.png)

## Quick start

```bash
npm install
npm start
```

Then, in the window:

1. **Add account**: the name and email for your commits, and the GitHub username you push with.
2. Give the account a way to authenticate:
   - Over HTTPS, **Sign in** next to the account. Git Credential Manager opens its own window; the app never sees your password or token.
   - Over SSH, **Choose file** to use a key you already have, or **Generate** a new one, **Copy** its public key, and add it on github.com under Settings, SSH and GPG keys.
3. Tell git where the account applies:
   - **Add folder**, to use it for every repository inside a folder.
   - **Add owner**, to use it for every repository whose remote belongs to a GitHub user or organization.
   - **Add project** and choose the account in its dropdown, to set a single repository.

From then on, every `git commit`, `git push`, and `git clone` in those places uses that account, from any terminal or editor. You can close the app.

### Requirements

| Tool | Version | Needed for |
|------|---------|------------|
| Node.js | 20 or newer | Installing and running the app |
| Git | 2.36 or newer | Reading and writing config. Owner rules need 2.36. |
| Git Credential Manager | Tested with 2.2.1 | Signing in to several accounts over HTTPS. It ships with Git for Windows. |
| OpenSSH client (`ssh-keygen`) | Any | Generating keys from the app. It ships with Windows 10 and 11. |

Developed and tested on Windows 11. macOS and Linux are untested.

## Rule or project?

| | Folder rule | Owner rule | Project assignment |
|---|-------------|------------|--------------------|
| Covers | Every repository inside the folder | Every repository whose remote is `github.com/<owner>/...`, wherever it is | One repository |
| Applies to later clones | Yes | Yes, from the clone itself | No |
| Written to | Your global git config | Your global git config | The project's own `.git/config` |

When more than one applies, the most specific wins:

1. A project assignment.
2. An owner rule.
3. The folder rule of the deepest folder.

Rules are the only thing that makes the app write to your global git config, and it asks first. What a rule adds is a pointer to a file with the account's settings:

```ini
[includeIf "gitdir/i:C:/Users/ada/clients/acme/"]
    path = C:/Users/ada/AppData/Roaming/git-account-switcher/accounts/<account id>.gitconfig
[includeIf "hasconfig:remote.*.url:git@github.com:[aA][cC][mM][eE]/**"]
    path = C:/Users/ada/AppData/Roaming/git-account-switcher/accounts/<account id>.gitconfig
```

An owner rule writes one entry per URL form (`git@github.com:`, `ssh://git@github.com/`, and `https://github.com/`). The bracketed letters make it match however the owner is capitalized in the remote. Removing a rule in the app removes its entries again.

## What an account sets

Whether it comes from a rule or a project assignment, an account sets the same things.

| Setting | Value | Effect |
|---------|-------|--------|
| `user.name`, `user.email` | From the account | The commit author |
| `credential.https://github.com.username` | The GitHub username | Which stored sign-in git asks the credential manager for |
| `core.sshCommand` | `ssh -i '<key>' -o IdentitiesOnly=yes`, or your usual SSH command when the account has no key | Which SSH key is used |

The SSH command is always set, even without a key. Git settings only add up, so leaving it out would let the key of another account leak in from a broader rule.

A project assignment also keeps `accountswitcher.*` entries in the project: which account is assigned, and the values the project had before. Choosing the first option of the dropdown removes all of it and puts those values back.

## SSH keys

**Generate** creates an ed25519 key pair in `~/.ssh`, named after the account label (`id_ed25519_work` for "Work"), and shows the public key so you can copy it. It never replaces an existing file.

The key is created without a passphrase, so the app never handles a secret. To add one afterwards:

```bash
ssh-keygen -p -f ~/.ssh/id_ed25519_work
```

## What it never touches

- Your global `user.name`, `user.email`, and credential settings.
- Includes and other entries you wrote in the global config yourself.
- Passwords and tokens. They stay in your credential manager.
- Remotes, branches, and commits.

The app keeps its own data in `%APPDATA%\git-account-switcher` on Windows: `state.json` (account labels, names, emails, usernames, SSH key paths, and the list of project folders) and `accounts/` (the settings files that rules include).

## When git would ignore the account

The app flags these in the project's detail panel.

| Situation | What git does | Fix |
|-----------|---------------|-----|
| You're not signed in as the account | Asks you to sign in on the next push | **Sign in** next to the account |
| The remote URL pins a user (`https://someone@github.com/...`) | Uses that user | Remove the user from the URL with `git remote set-url` |
| The remote URL embeds a token | Uses that token | Remove it from the URL |
| The remote uses SSH and the account has no key | Uses your default SSH key | Add a key to the account, or switch the remote to HTTPS |
| The remote is not on github.com | Only the commit author changes | Nothing; other hosts are out of scope |
| The project config no longer matches its account | Uses what the config says | Choose the account again |

## Check that it works

Run these inside a repository that should use the account.

- [ ] `git config --show-origin --get user.email` prints the account's email. The file it names is `.git/config` for a project assignment, or a file in the app's `accounts` folder for a rule.
- [ ] `git config --global --get user.email` prints the same value it did before you used the app.
- [ ] Over HTTPS: `git credential-manager github list` includes the account.
- [ ] Over SSH: `ssh -T -i ~/.ssh/id_ed25519_work -o IdentitiesOnly=yes git@github.com` greets you with the account's username.
- [ ] A push to a repository that only this account can write to goes through.

## Limits

- The push account is only switched for github.com.
- Switching over HTTPS relies on a credential helper that can hold several accounts, such as Git Credential Manager.
- An owner rule needs the repository to have a remote, and only covers the three URL forms listed above.
- A rule only takes effect below your default identity in the global config. The app appends rules at the end; if you later add a `[user]` section after them, remove the rule and add it again.
- A folder whose path contains `*`, `?`, or brackets can't have a rule, because git reads those characters as a pattern.
- Because an account always sets `core.sshCommand`, it takes precedence over the `GIT_SSH` environment variable. If you rely on that variable, set `core.sshCommand` in your global config instead and the app will use it.
- Removing a project from the list leaves its git config as it is. Choose the first option of its dropdown before removing it if you want it cleared.

## Development

| Command | What it does |
|---------|--------------|
| `npm test` | Unit and integration tests. They run the real git and ssh-keygen in a sandbox with its own "global" config. |
| `npm run smoke` | Boots the app against throwaway repositories, drives the page, checks the result with git, and saves screenshots to `.smoke/`. |
| `npm start` | Runs the app. Set `GIT_ACCOUNT_SWITCHER_DATA_DIR` to try it with a separate data folder. |

```text
src/
  core/        The rules, with no Electron: accounts, assignments, rules, use cases
  adapters/    Git, ssh-keygen, the file system, and JSON storage
  main/        Electron main process: window, IPC, preload
  renderer/    The page: views (presentational) and app (container)
tests/         Tests for core and adapters
scripts/       The end-to-end smoke run
```
