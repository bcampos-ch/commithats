// End-to-end smoke run: `npm run smoke`.
//
// Boots the real app (window, preload, IPC, service) against throwaway repositories,
// drives the page the way a person would, checks the result with git itself, and
// saves screenshots. Nothing here reads or writes your git config, credentials or
// SSH keys: git gets a private "global" config, keys go to a throwaway folder, and
// the credential manager is a stand-in.

import assert from 'node:assert/strict';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, nativeTheme } from 'electron';
import { createGitCli } from '../src/adapters/git-cli.js';
import { startApp } from '../src/main/app.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.resolve(projectRoot, process.env.SMOKE_OUTPUT_DIR ?? '.smoke');
const WATCHDOG_MS = 90_000;

const personalDraft = {
  label: 'Personal',
  gitName: 'Ada Lovelace',
  gitEmail: 'ada@example.com',
  githubUser: 'ada-lovelace',
};
const workDraft = {
  label: 'Work',
  gitName: 'Ada Lovelace',
  gitEmail: 'ada.lovelace@acme.example',
  githubUser: 'ada-acme',
};

async function main() {
  // Wiped at the start, not the end: the running app keeps files in it open,
  // and leaving it behind lets you inspect what a run produced.
  const sandbox = path.join(outputDir, 'sandbox');
  await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await mkdir(sandbox, { recursive: true });
  const globalConfig = path.join(sandbox, 'global.gitconfig');
  await writeFile(globalConfig, '');

  const git = createGitCli({
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_CEILING_DIRECTORIES: sandbox,
    },
  });
  const runGit = async (...args) => {
    const result = await git(args);
    assert.equal(result.code, 0, `git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const localValue = async (repo, key) => {
    const result = await git(['-C', repo, 'config', '--local', '--get', key]);
    return result.code === 0 ? result.stdout.trim() : null;
  };
  const createRepo = async (folder, remote) => {
    await mkdir(folder, { recursive: true });
    await runGit('-C', folder, 'init', '--quiet');
    await runGit('-C', folder, 'remote', 'add', 'origin', remote);
    return folder;
  };

  const signedIn = ['ada-lovelace'];
  const gcm = {
    getStatus: async () => ({ available: true, accounts: [...signedIn] }),
    signIn: async (username) => {
      signedIn.push(username);
      return { ok: true };
    },
  };

  await runGit('config', '--global', 'user.name', 'Ada Lovelace');
  await runGit('config', '--global', 'user.email', 'ada@example.com');
  const repos = {
    website: await createRepo(path.join(sandbox, 'projects', 'website'), 'https://github.com/ada-lovelace/website.git'),
    billingApi: await createRepo(path.join(sandbox, 'projects', 'billing-api'), 'https://github.com/acme/billing-api.git'),
    infrastructure: await createRepo(path.join(sandbox, 'projects', 'infrastructure'), 'git@github.com:acme/infrastructure.git'),
  };
  const sshDir = path.join(sandbox, 'ssh');

  const { window, service } = await startApp({
    userDataDir: path.join(sandbox, 'user-data'),
    git,
    gcm,
    sshDir,
    show: false,
  });
  nativeTheme.themeSource = 'light';

  const problems = [];
  window.webContents.on('console-message', (event, level, message) => {
    const severity = event.level ?? level;
    if (severity === 'error' || severity === 3) problems.push(event.message ?? message);
  });
  window.webContents.on('render-process-gone', (_event, details) => problems.push(`renderer gone: ${details.reason}`));

  const page = (script) => window.webContents.executeJavaScript(script, true);
  const waitFor = async (description, check) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for: ${description}`);
  };
  const waitForText = (text) => waitFor(`"${text}" on the page`, () => page(`document.body.innerText.includes(${JSON.stringify(text)})`));
  const settle = () => waitFor('the page to finish working', () => page(`!document.body.classList.contains('is-busy')`));
  const click = (selector) => page(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const refresh = async () => {
    await click('#refresh');
    await settle();
  };
  const row = (repo) => `[...document.querySelectorAll('.project')].find((item) => item.dataset.path === ${JSON.stringify(repo)})`;
  const selectProject = (repo) => page(`${row(repo)}.querySelector('.project__main').click()`);
  const selectedLabel = (repo) => page(`${row(repo)}.querySelector('select').selectedOptions[0].textContent`);
  const detailText = () => page(`document.getElementById('detail').innerText`);
  const chooseAccount = async (repo, label) => {
    await page(`(() => {
      const select = ${row(repo)}.querySelector('select');
      select.value = [...select.options].find((option) => option.textContent === ${JSON.stringify(label)}).value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await settle();
  };
  const screenshot = async (name) => {
    // Toasts are transient; leaving them out keeps the pictures comparable between runs.
    await page(`document.getElementById('toasts').replaceChildren()`);
    // Wait for the page to paint what was just changed, or the capture shows the previous frame.
    await page(`new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
      setTimeout(resolve, 1000);
    })`);
    let image = await window.webContents.capturePage();
    if (image.isEmpty()) {
      // Some platforms do not paint a hidden window.
      window.showInactive();
      await new Promise((resolve) => setTimeout(resolve, 300));
      image = await window.webContents.capturePage();
    }
    assert.equal(image.isEmpty(), false, `screenshot "${name}" is empty`);
    const file = path.join(outputDir, `${name}.png`);
    await writeFile(file, image.toPNG());
    console.log(`screenshot: ${file}`);
  };

  // 1. First run: nothing configured yet.
  await waitForText('Add your first account');
  await waitForText('Add a project');
  await screenshot('01-first-run');

  // 2. Accounts and projects appear after a refresh.
  for (const draft of [personalDraft, workDraft]) assert.equal((await service.saveAccount(draft)).ok, true);
  assert.equal((await service.addProjects(Object.values(repos))).ok, true);
  const work = (await service.getSnapshot()).accounts.find((account) => account.label === 'Work');
  await refresh();
  await waitFor('three projects in the list', () => page(`document.querySelectorAll('.project').length === 3`));
  assert.equal(await page(`document.querySelectorAll('.account').length`), 2);

  // 3. Choosing an account in the page changes the project's own git config.
  await chooseAccount(repos.billingApi, 'Work');
  await waitFor('billing-api to use the work email', async () => (await localValue(repos.billingApi, 'user.email')) === workDraft.gitEmail);
  assert.equal(await localValue(repos.billingApi, 'credential.https://github.com.username'), 'ada-acme');
  assert.equal(await localValue(repos.website, 'user.email'), null, 'other projects must stay untouched');
  assert.equal(await runGit('config', '--global', 'user.email'), 'ada@example.com', 'the global identity must stay untouched');
  await waitForText(`You're not signed in as "ada-acme" yet.`);
  await screenshot('02-assigned-needs-sign-in');

  // 4. Signing in clears the warning.
  await click('[data-action="sign-in"]');
  await waitFor('the sign-in warning to disappear', async () => !(await page(`document.body.innerText.includes('not signed in as')`)));
  assert.deepEqual(signedIn, ['ada-lovelace', 'ada-acme']);

  // 5. An SSH remote without a key gets a warning instead of a silent wrong push.
  await chooseAccount(repos.infrastructure, 'Work');
  await waitForText('uses SSH and this account has no SSH key');
  await screenshot('03-ssh-warning');

  // 6. Going back to "Not set" removes what the app wrote.
  await chooseAccount(repos.billingApi, 'Not set (uses global)');
  await waitFor('billing-api to drop its own email', async () => (await localValue(repos.billingApi, 'user.email')) === null);
  assert.equal(await localValue(repos.billingApi, 'accountswitcher.account'), null);

  // 7. A config edited behind the app's back is flagged and can be reapplied.
  await runGit('-C', repos.infrastructure, 'config', '--local', 'user.email', 'someone-else@example.com');
  await refresh();
  await selectProject(repos.infrastructure);
  await waitForText('no longer matches the account');
  assert.equal(await selectedLabel(repos.infrastructure), 'Edited by hand (was Work)');
  await chooseAccount(repos.infrastructure, 'Work');
  assert.equal(await localValue(repos.infrastructure, 'user.email'), workDraft.gitEmail);
  assert.equal(await page(`document.body.innerText.includes('no longer matches the account')`), false);

  // 8. A folder rule covers a repository the app has never seen, such as a fresh clone.
  const clientFolder = path.join(sandbox, 'clients', 'acme');
  const freshClone = await createRepo(path.join(clientFolder, 'mobile-app'), 'https://github.com/acme-mobile/mobile-app.git');
  assert.equal(await runGit('-C', freshClone, 'config', 'user.email'), 'ada@example.com');
  assert.equal((await service.addFolderRule(work.id, clientFolder)).ok, true);
  assert.equal(await runGit('-C', freshClone, 'config', 'user.email'), workDraft.gitEmail);
  assert.equal(await runGit('-C', freshClone, 'config', 'credential.https://github.com.username'), 'ada-acme');
  assert.equal(await runGit('-C', repos.website, 'config', 'user.email'), 'ada@example.com', 'folders outside the rule keep the global identity');
  assert.equal(await runGit('config', '--global', 'user.email'), 'ada@example.com', 'the global identity must stay untouched');

  assert.equal((await service.addProjects([freshClone])).ok, true);
  await refresh();
  await selectProject(freshClone);
  await waitForText('What git resolves in mobile-app');
  assert.equal(await page(`document.querySelectorAll('.folder').length`), 1);
  assert.equal(await selectedLabel(freshClone), 'Folder rule (Work)');
  assert.match(await detailText(), /ada\.lovelace@acme\.example\s+folder rule/);
  assert.equal(await localValue(freshClone, 'user.email'), null, 'a folder rule must not write to the project');
  await screenshot('04-folder-rule');

  // 9. An owner rule follows the remote, wherever the repository is. It is added from the page.
  const sdk = await createRepo(path.join(sandbox, 'elsewhere', 'sdk'), 'git@github.com:Acme/sdk.git');
  assert.equal(await runGit('-C', sdk, 'config', 'user.email'), 'ada@example.com');
  const typeOwner = (value) =>
    page(`(() => {
      const input = document.querySelector('#owner-form [name="owner"]');
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  const submitOwner = () => page(`document.querySelector('#owner-form [type="submit"]').click()`);
  await click(`[data-focus-key="add-owner:${work.id}"]`);
  await typeOwner('not a name');
  await submitOwner();
  await waitForText('Enter a GitHub user or organization');
  await typeOwner('https://github.com/acme/sdk');
  assert.equal(await page(`document.body.innerText.includes('Enter a GitHub user or organization')`), false, 'editing the field clears its error');
  await screenshot('05-owner-dialog');
  await submitOwner();
  await waitFor('the owner rule to show in the account', () => page(`document.querySelectorAll('.owner').length === 1`));
  assert.equal(await page(`document.getElementById('owner-dialog').open`), false);
  assert.equal(await runGit('-C', sdk, 'config', 'user.email'), workDraft.gitEmail, 'the rule ignores the case of the owner');
  assert.equal(await runGit('-C', freshClone, 'config', 'user.email'), workDraft.gitEmail, 'the folder rule is still there');

  assert.equal((await service.addProjects([sdk])).ok, true);
  await refresh();
  await selectProject(sdk);
  await waitForText('What git resolves in sdk');
  assert.equal(await selectedLabel(sdk), 'Owner rule (Work)');
  assert.match(await detailText(), /ada\.lovelace@acme\.example\s+owner rule/);
  await screenshot('06-owner-rule');

  // 10. Generating a key from the form creates the pair and shows the half that goes to GitHub.
  const keyPath = path.join(sshDir, 'id_ed25519_work');
  await click(`[data-focus-key="edit:${work.id}"]`);
  await click('#generate-ssh-key');
  await waitFor('the public key to show', () => page(`document.getElementById('public-key-text').value.startsWith('ssh-ed25519 ')`));
  assert.equal(await page(`document.querySelector('[name="sshKeyPath"]').value`), keyPath);
  await access(keyPath);
  await access(`${keyPath}.pub`);
  await screenshot('07-generated-key');

  // Saving the account hands the new key to everything that uses it: rules and assigned projects.
  await page(`document.querySelector('#account-form [type="submit"]').click()`);
  await settle();
  await waitFor('the dialog to close', () => page(`!document.getElementById('account-dialog').open`));
  assert.match(await runGit('-C', freshClone, 'config', 'core.sshCommand'), /id_ed25519_work' -o IdentitiesOnly=yes$/);
  assert.match(await runGit('-C', sdk, 'config', 'core.sshCommand'), /id_ed25519_work' -o IdentitiesOnly=yes$/);
  assert.match(await localValue(repos.infrastructure, 'core.sshCommand'), /id_ed25519_work' -o IdentitiesOnly=yes$/);

  // A second key with the same name is refused instead of replacing the first.
  await click(`[data-focus-key="edit:${work.id}"]`);
  await click('#generate-ssh-key');
  await waitForText('A key named id_ed25519_work already exists.');
  await click('#cancel-account');

  // A repository of another owner inside the Work folder follows its owner and gets none of the Work key.
  const personal = (await service.getSnapshot()).accounts.find((account) => account.label === 'Personal');
  const dotfiles = await createRepo(path.join(clientFolder, 'dotfiles'), 'git@github.com:ada-lovelace/dotfiles.git');
  assert.match(await runGit('-C', dotfiles, 'config', 'core.sshCommand'), /id_ed25519_work/);
  assert.equal((await service.addOwnerRule(personal.id, 'ada-lovelace')).ok, true);
  assert.equal(await runGit('-C', dotfiles, 'config', 'credential.https://github.com.username'), 'ada-lovelace');
  assert.equal(await runGit('-C', dotfiles, 'config', 'core.sshCommand'), 'ssh');

  // 11. The picture for the README: projects with their own account, and projects that follow a rule.
  await chooseAccount(repos.billingApi, 'Work');
  await chooseAccount(repos.website, 'Personal');
  await waitFor('website to use the personal account', async () => (await localValue(repos.website, 'credential.https://github.com.username')) === 'ada-lovelace');
  assert.equal(await localValue(repos.website, 'core.sshCommand'), 'ssh', 'an account without a key pins plain ssh');
  await selectProject(repos.website);
  await waitForText('What git resolves in website');
  assert.equal(await selectedLabel(repos.website), 'Personal');
  assert.equal(await selectedLabel(repos.billingApi), 'Work');
  assert.equal(await selectedLabel(freshClone), 'Folder rule (Work)');
  assert.equal(await selectedLabel(sdk), 'Owner rule (Work)');
  assert.match(await detailText(), /ada@example\.com\s+this project/);
  assert.match(await detailText(), /ada-lovelace\s+this project/);
  assert.match(await detailText(), /Default SSH key\s+this project/);
  await screenshot('08-overview');

  nativeTheme.themeSource = 'dark';
  await screenshot('09-overview-dark');
  nativeTheme.themeSource = 'light';

  // 11. The account form reports what is wrong with the input.
  await click('#add-account');
  await page(`document.querySelector('#account-form [type="submit"]').click()`);
  await waitForText('Enter the GitHub username you push with.');
  await screenshot('10-account-form-errors');

  assert.deepEqual(problems, [], 'the page logged errors');
  console.log('smoke: ok');
}

const watchdog = setTimeout(() => {
  console.error('smoke: timed out');
  app.exit(1);
}, WATCHDOG_MS);

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error('smoke: FAILED');
    console.error(error);
    app.exit(1);
  })
  .finally(() => clearTimeout(watchdog));
