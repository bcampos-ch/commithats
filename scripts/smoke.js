// End-to-end smoke run: `npm run smoke`.
//
// Boots the real app (window, preload, IPC, service) against throwaway repositories,
// drives the page the way a person would, checks the result with git itself, and
// saves screenshots. Nothing here reads or writes your git config, credentials, SSH
// keys or clipboard: git gets a private "global" config, keys go to a throwaway folder,
// and the credential manager and the clipboard are stand-ins.
//
// The app is launched twice on the same data. The first launch goes through everything
// from the first run on. The second one only checks that what was chosen is still there
// when the app opens again: the language, the theme, the order of the projects.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, nativeTheme } from 'electron';
import { createGitCli } from '../src/adapters/git-cli.js';
import { startApp } from '../src/main/app.js';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), '..');
const outputDir = path.resolve(projectRoot, process.env.SMOKE_OUTPUT_DIR ?? '.smoke');
const sandbox = path.join(outputDir, 'sandbox');
const userDataDir = path.join(sandbox, 'user-data');
const IS_SECOND_LAUNCH = process.env.SMOKE_LAUNCH === 'second';
const WATCHDOG_MS = 150_000;
// Room around a target inside the spotlight of the tour. See tour.js.
const SPOTLIGHT_PAD = 8;
const VIRTUAL_KEYS = { Enter: 13, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };

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

/** Starts the real app on the sandbox and answers with what a run needs to drive it and check it. */
async function launch() {
  const git = createGitCli({
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: path.join(sandbox, 'global.gitconfig'),
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

  const signedIn = ['ada-lovelace'];
  // A run can take the credential manager away, to see what the app says without it.
  const credentialManager = { installed: true };
  const gcm = {
    getStatus: async () =>
      credentialManager.installed
        ? { available: true, accounts: [...signedIn], version: '2.6.1' }
        : { available: false, accounts: [], version: null },
    signIn: async (username) => {
      signedIn.push(username);
      return { ok: true };
    },
  };
  const copied = [];
  const clipboard = { writeText: (text) => copied.push(text) };
  const sshDir = path.join(sandbox, 'ssh');

  const { window, service } = await startApp({
    userDataDir,
    git,
    gcm,
    sshDir,
    clipboard,
    defaultLanguage: 'en',
    show: false,
  });
  // A hidden window only paints when asked, so anything that eases in would be caught halfway.
  await window.webContents.insertCSS('* { animation: none !important; transition: none !important; }');

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
  // Case is ignored: titles are shown in capitals, and innerText reports what is shown.
  const waitForText = (text) =>
    waitFor(`"${text}" on the page`, () => page(`document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`));
  const settle = () => waitFor('the page to finish working', () => page(`!document.body.classList.contains('is-busy')`));
  const click = (selector) => page(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const boxOf = (expression) =>
    page(`(() => {
      const box = ${expression}.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    })()`);

  // The debugger sends input the way the keyboard and the mouse do. An event built inside
  // the page is not the same thing: the browser does not close a dialog on it, or start a drag.
  const cdp = window.webContents.debugger;
  cdp.attach('1.3');
  // A hidden window never has the focus, and without it key presses go nowhere.
  await cdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  const pressKey = async (key) => {
    const event = { key, code: key, windowsVirtualKeyCode: VIRTUAL_KEYS[key], nativeVirtualKeyCode: VIRTUAL_KEYS[key] };
    await cdp.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...event });
    await cdp.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
  };
  const mouse = (type, point, options = {}) =>
    cdp.sendCommand('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, ...options });
  const nextDebuggerEvent = (name, timeoutMs = 5000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cdp.off('message', listener);
        reject(new Error(`Timed out waiting for the browser to report ${name}`));
      }, timeoutMs);
      function listener(_event, method, params) {
        if (method !== name) return;
        clearTimeout(timer);
        cdp.off('message', listener);
        resolve(params);
      }
      cdp.on('message', listener);
    });

  // The compositor now and then refuses a capture. Asking again is enough.
  const capture = async (attempt = 1) => {
    try {
      return await window.webContents.capturePage();
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
      return capture(attempt + 1);
    }
  };
  const screenshot = async (name) => {
    // Toasts are transient; leaving them out keeps the pictures comparable between runs.
    await page(`document.getElementById('toasts').replaceChildren()`);
    // A hidden window only paints while it is being captured, so a capture can show a frame
    // from before the last changes. This first one is thrown away: it is what makes the page
    // paint them. Then the page is given two frames to do it, and the real capture follows.
    await capture();
    await page(`new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
      setTimeout(resolve, 1000);
    })`);
    let image = await capture();
    if (image.isEmpty()) {
      // Some platforms do not paint a hidden window.
      window.showInactive();
      await new Promise((resolve) => setTimeout(resolve, 300));
      image = await capture();
    }
    assert.equal(image.isEmpty(), false, `screenshot "${name}" is empty`);
    const file = path.join(outputDir, `${name}.png`);
    await writeFile(file, image.toPNG());
    console.log(`screenshot: ${file}`);
  };

  return {
    runGit,
    localValue,
    signedIn,
    credentialManager,
    copied,
    sshDir,
    window,
    service,
    problems,
    page,
    waitFor,
    waitForText,
    settle,
    click,
    boxOf,
    cdp,
    pressKey,
    mouse,
    nextDebuggerEvent,
    screenshot,
  };
}

const row = (repo) => `[...document.querySelectorAll('.project')].find((item) => item.dataset.path === ${JSON.stringify(repo)})`;
const near = (actual, expected) => Math.abs(actual - expected) < 1;

async function firstLaunch() {
  // Wiped at the start, not the end: the running app keeps files in it open,
  // and leaving it behind lets you inspect what a run produced.
  await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await mkdir(sandbox, { recursive: true });
  await writeFile(path.join(sandbox, 'global.gitconfig'), '');

  const {
    runGit,
    localValue,
    signedIn,
    credentialManager,
    copied,
    sshDir,
    service,
    problems,
    page,
    waitFor,
    waitForText,
    settle,
    click,
    boxOf,
    cdp,
    pressKey,
    mouse,
    nextDebuggerEvent,
    screenshot,
  } = await launch();
  // The pictures are taken in the light theme, whatever this computer uses. It is saved as the
  // setting too, because the app applies the saved theme again every time a setting changes.
  assert.equal((await service.saveSettings({ theme: 'light' })).ok, true);
  nativeTheme.themeSource = 'light';

  const createRepo = async (folder, remote) => {
    await mkdir(folder, { recursive: true });
    await runGit('-C', folder, 'init', '--quiet');
    await runGit('-C', folder, 'remote', 'add', 'origin', remote);
    return folder;
  };
  await runGit('config', '--global', 'user.name', 'Ada Lovelace');
  await runGit('config', '--global', 'user.email', 'ada@example.com');
  const repos = {
    website: await createRepo(path.join(sandbox, 'projects', 'website'), 'https://github.com/ada-lovelace/website.git'),
    billingApi: await createRepo(path.join(sandbox, 'projects', 'billing-api'), 'https://github.com/acme/billing-api.git'),
    infrastructure: await createRepo(path.join(sandbox, 'projects', 'infrastructure'), 'git@github.com:acme/infrastructure.git'),
  };

  const refresh = async () => {
    await click('#refresh');
    await settle();
  };
  const selectProject = (repo) => page(`${row(repo)}.querySelector('.project__main').click()`);
  const selectedLabel = (repo) => page(`${row(repo)}.querySelector('.dropdown__value').textContent`);
  const listIsOpen = (repo) => page(`${row(repo)}.querySelector('.dropdown__list').matches(':popover-open')`);
  const detailText = () => page(`document.getElementById('detail').innerText`);
  const listedProjects = () => page(`[...document.querySelectorAll('.project')].map((item) => item.dataset.path)`);
  const savedProjects = async () => (await service.getSnapshot()).projects.map((project) => project.path);
  // Picks an account the way a person does with the mouse: open the list, click the option.
  const chooseAccount = async (repo, label) => {
    await page(`${row(repo)}.querySelector('.dropdown__trigger').click()`);
    assert.equal(await listIsOpen(repo), true, 'the list opens on click');
    await page(`[...${row(repo)}.querySelectorAll('.dropdown__label')].find((item) => item.textContent === ${JSON.stringify(label)}).click()`);
    await settle();
  };
  // A key press on the dropdown of a project, as the dropdown itself would get it.
  const pressOnDropdown = (repo, key) =>
    page(`${row(repo)}.querySelector('.dropdown__trigger').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`);

  // 1. The first time the app opens, the guided tour introduces it.
  const tourIsOpen = () => page(`document.querySelector('.tour').open`);
  const tourTitle = () => page(`document.getElementById('tour-title').textContent`);
  const tourForward = () => click('.tour .button--primary');
  await waitFor('the tour to open on its own', tourIsOpen);
  assert.equal(await tourTitle(), 'One hat per project');
  assert.equal(await page(`document.querySelector('.tour__spotlight').dataset.hole`), 'false', 'the welcome points at nothing');
  assert.equal(await page(`document.activeElement.textContent`), 'Next', 'the way forward has the focus');
  await screenshot('01-tour-welcome');

  await tourForward();
  assert.equal(await tourTitle(), 'Your accounts');
  const spotlight = await boxOf(`document.querySelector('.tour__spotlight')`);
  const accountsPanel = await boxOf(`document.querySelector('[data-tour="accounts"]')`);
  const card = await boxOf(`document.querySelector('.tour__card')`);
  assert.ok(near(spotlight.left, accountsPanel.left - SPOTLIGHT_PAD), 'the spotlight starts left of the accounts panel');
  assert.ok(near(spotlight.top, accountsPanel.top - SPOTLIGHT_PAD), 'the spotlight starts above the accounts panel');
  assert.ok(near(spotlight.width, accountsPanel.width + 2 * SPOTLIGHT_PAD), 'the spotlight is as wide as the accounts panel');
  assert.ok(near(spotlight.height, accountsPanel.height + 2 * SPOTLIGHT_PAD), 'the spotlight is as tall as the accounts panel');
  assert.ok(card.left >= spotlight.right, 'the card sits beside the panel it talks about, not over it');
  await screenshot('02-tour-accounts');

  // The arrow keys walk the tour too.
  await pressKey('ArrowRight');
  assert.equal(await tourTitle(), 'Rules do it for you');
  await pressKey('ArrowLeft');
  assert.equal(await tourTitle(), 'Your accounts');
  for (const title of ['Rules do it for you', 'Your projects', 'What git will do', 'Help and settings']) {
    await tourForward();
    assert.equal(await tourTitle(), title);
  }
  const toolbar = await boxOf(`document.querySelector('[data-tour="toolbar"]')`);
  const lastCard = await boxOf(`document.querySelector('.tour__card')`);
  assert.ok(lastCard.top >= toolbar.bottom, 'the last card sits under the buttons it names');
  assert.ok(lastCard.right <= (await page(`window.innerWidth`)), 'and stays inside the window');
  assert.equal(await page(`document.querySelector('.tour .button--primary').textContent`), 'Done');
  await tourForward();
  assert.equal(await tourIsOpen(), false, 'the last step closes the tour');
  await waitFor('the tour to be remembered as seen', async () => (await service.getSettings()).tourSeen);

  // The Guide button brings it back, and Escape leaves it.
  await click('#open-guide');
  assert.equal(await tourIsOpen(), true);
  assert.equal(await tourTitle(), 'One hat per project', 'it starts over from the first step');
  await pressKey('Escape');
  await waitFor('Escape to leave the tour', async () => !(await tourIsOpen()));

  // 2. Behind the tour: nothing configured yet.
  await waitForText('Add your first account');
  await waitForText('Add a project');
  assert.equal(await page(`document.getElementById('environment').childElementCount`), 0, 'nothing is missing, so the top bar reports nothing');
  await screenshot('03-first-run');

  // 3. Accounts and projects appear after a refresh.
  for (const draft of [personalDraft, workDraft]) assert.equal((await service.saveAccount(draft)).ok, true);
  assert.equal((await service.addProjects(Object.values(repos))).ok, true);
  const work = (await service.getSnapshot()).accounts.find((account) => account.label === 'Work');
  await refresh();
  await waitFor('three projects in the list', () => page(`document.querySelectorAll('.project').length === 3`));
  assert.equal(await page(`document.querySelectorAll('.account').length`), 2);

  // 4. Choosing an account in the page changes the project's own git config.
  await chooseAccount(repos.billingApi, 'Work');
  await waitFor('billing-api to use the work email', async () => (await localValue(repos.billingApi, 'user.email')) === workDraft.gitEmail);
  assert.equal(await localValue(repos.billingApi, 'credential.https://github.com.username'), 'ada-acme');
  assert.equal(await localValue(repos.website, 'user.email'), null, 'other projects must stay untouched');
  assert.equal(await runGit('config', '--global', 'user.email'), 'ada@example.com', 'the global identity must stay untouched');
  await waitForText(`You're not signed in as "ada-acme" yet.`);
  await screenshot('04-assigned-needs-sign-in');

  // 5. Signing in clears the warning, and the account says so in green.
  await click('[data-action="sign-in"]');
  await waitFor('the sign-in warning to disappear', async () => !(await page(`document.body.innerText.includes('not signed in as')`)));
  assert.deepEqual(signedIn, ['ada-lovelace', 'ada-acme']);
  assert.equal(await page(`document.querySelectorAll('.account .chip--ok').length`), 2, 'both accounts are signed in');
  const signedInMark = await page(`(() => {
    const chip = document.querySelector('.account .chip--ok');
    return { text: chip.textContent, color: getComputedStyle(chip).color, dot: getComputedStyle(chip, '::before').backgroundColor };
  })()`);
  assert.deepEqual(signedInMark, { text: 'Signed in', color: 'rgb(19, 104, 67)', dot: 'rgb(19, 104, 67)' }, 'signed in is said in green');

  // 5b. The dropdown is the app's own, so it also has to work from the keyboard.
  await page(`${row(repos.website)}.querySelector('.dropdown__trigger').focus()`);
  await pressOnDropdown(repos.website, 'ArrowDown');
  assert.equal(await listIsOpen(repos.website), true, 'the down arrow opens the list');
  await screenshot('05-dropdown-open');
  nativeTheme.themeSource = 'dark';
  await screenshot('05-dropdown-open-dark');
  nativeTheme.themeSource = 'light';
  await pressOnDropdown(repos.website, 'Escape');
  assert.equal(await listIsOpen(repos.website), false, 'Escape closes the list');
  assert.equal(await selectedLabel(repos.website), 'Not set (uses global)', 'Escape changes nothing');

  await pressOnDropdown(repos.website, 'ArrowDown');
  await pressOnDropdown(repos.website, 'ArrowDown');
  await pressOnDropdown(repos.website, 'Enter');
  await settle();
  assert.equal(await selectedLabel(repos.website), 'Personal', 'arrows and Enter pick the next account');
  assert.equal(await localValue(repos.website, 'credential.https://github.com.username'), 'ada-lovelace');

  await pressOnDropdown(repos.website, ' ');
  await pressOnDropdown(repos.website, 'n');
  await pressOnDropdown(repos.website, 'Enter');
  await settle();
  assert.equal(await selectedLabel(repos.website), 'Not set (uses global)', 'typing jumps to the option that starts with it');
  assert.equal(await localValue(repos.website, 'user.email'), null);

  // 6. An SSH remote without a key gets a warning instead of a silent wrong push.
  await chooseAccount(repos.infrastructure, 'Work');
  await waitForText('uses SSH and this account has no SSH key');
  await screenshot('06-ssh-warning');

  // 7. Going back to "Not set" removes what the app wrote.
  await chooseAccount(repos.billingApi, 'Not set (uses global)');
  await waitFor('billing-api to drop its own email', async () => (await localValue(repos.billingApi, 'user.email')) === null);
  assert.equal(await localValue(repos.billingApi, 'accountswitcher.account'), null);

  // 8. A config edited behind the app's back is flagged and can be reapplied.
  await runGit('-C', repos.infrastructure, 'config', '--local', 'user.email', 'someone-else@example.com');
  await refresh();
  await selectProject(repos.infrastructure);
  await waitForText('no longer matches the account');
  assert.equal(await selectedLabel(repos.infrastructure), 'Edited by hand (was Work)');
  await chooseAccount(repos.infrastructure, 'Work');
  assert.equal(await localValue(repos.infrastructure, 'user.email'), workDraft.gitEmail);
  assert.equal(await page(`document.body.innerText.includes('no longer matches the account')`), false);

  // 9. A folder rule covers a repository the app has never seen, such as a fresh clone.
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
  await screenshot('07-folder-rule');

  // 10. An owner rule follows the remote, wherever the repository is. It is added from the page.
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
  await screenshot('08-owner-dialog');
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
  await screenshot('09-owner-rule');

  // 11. Generating a key from the form creates the pair and shows the half that goes to GitHub.
  const keyPath = path.join(sshDir, 'id_ed25519_work');
  await click(`[data-focus-key="edit:${work.id}"]`);
  assert.equal(await page(`document.getElementById('account-dialog-title').textContent`), 'Edit account');
  await click('#generate-ssh-key');
  await waitFor('the public key to show', () => page(`document.getElementById('public-key-text').value.startsWith('ssh-ed25519 ')`));
  assert.equal(await page(`document.querySelector('[name="sshKeyPath"]').value`), keyPath);
  await access(keyPath);
  await access(`${keyPath}.pub`);
  await click('#copy-public-key');
  await waitFor('the public key to be copied', async () => copied.length === 1);
  assert.equal(copied[0], (await readFile(`${keyPath}.pub`, 'utf8')).trim());
  await screenshot('10-generated-key');

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

  // 12. The picture for the README: projects with their own account, and projects that follow a rule.
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
  // No focus ring in the pictures that go in the README.
  await page(`document.activeElement.blur()`);
  await screenshot('11-overview');

  nativeTheme.themeSource = 'dark';
  await screenshot('12-overview-dark');
  nativeTheme.themeSource = 'light';

  // With accounts and projects in place, every step of the tour points at the real thing.
  await click('#open-guide');
  await tourForward();
  await tourForward();
  assert.equal(await tourTitle(), 'Rules do it for you');
  const ruleButtons = await boxOf(`document.querySelector('[data-tour="rules"]')`);
  const rulesSpotlight = await boxOf(`document.querySelector('.tour__spotlight')`);
  assert.ok(
    near(rulesSpotlight.top, ruleButtons.top - SPOTLIGHT_PAD) && near(rulesSpotlight.height, ruleButtons.height + 2 * SPOTLIGHT_PAD),
    'once there is an account, the step about rules points at its rule buttons',
  );
  await screenshot('12b-tour-rules');
  for (const step of ['12c-tour-projects', '12d-tour-detail', '12e-tour-toolbar']) {
    await tourForward();
    await screenshot(step);
  }
  await tourForward();
  assert.equal(await tourIsOpen(), false);

  // 13. The account form reports what is wrong with the input.
  await click('#add-account');
  assert.equal(await page(`document.getElementById('account-dialog-title').textContent`), 'Add account');
  await page(`document.querySelector('#account-form [type="submit"]').click()`);
  await waitForText('Enter the GitHub username you push with.');
  await screenshot('13-account-form-errors');
  await click('#cancel-account');

  // 14. Info names the versions of everything the app runs on, and copies them without any path.
  const { version: appVersion } = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const gitVersion = /git version (\S+)/.exec(await runGit('--version'))[1];
  await click('#open-info');
  await waitForText('About Commit Hats');
  const infoText = await page(`document.getElementById('info-body').innerText`);
  for (const expected of [appVersion, gitVersion, '2.6.1', process.versions.electron, process.versions.chrome, userDataDir]) {
    assert.ok(infoText.includes(expected), `Info shows ${expected}`);
  }
  await click('#copy-info');
  await waitFor('the versions to be copied', async () => copied.length === 2);
  assert.ok(copied[1].startsWith(`Commit Hats: ${appVersion}\nGit: ${gitVersion}\nGit Credential Manager: 2.6.1\n`));
  assert.equal(copied[1].includes(sandbox), false, 'what is copied for a bug report carries no path of this computer');
  await waitForText('Copied.');
  await screenshot('14-info');
  await click('#close-info');

  // The top bar only speaks up when something is missing, and Info says what.
  credentialManager.installed = false;
  await refresh();
  assert.equal(await page(`document.getElementById('environment').innerText`), 'Credential manager not found');
  assert.equal(await page(`document.querySelectorAll('.account .chip--ok, [data-action="sign-in"]').length`), 0, 'no sign-in state is guessed');
  await click('#open-info');
  assert.match(await page(`document.getElementById('info-body').innerText`), /git credential manager\s+Not found/i);
  await screenshot('14b-credential-manager-missing');
  await click('#close-info');
  credentialManager.installed = true;
  await refresh();
  assert.equal(await page(`document.getElementById('environment').childElementCount`), 0);
  assert.equal(await page(`document.querySelectorAll('.account .chip--ok').length`), 2);

  // 15. Projects are put in another order with the arrow keys on a handle...
  const handle = (repo) => `${row(repo)}.querySelector('[data-reorder-handle]')`;
  assert.deepEqual(await listedProjects(), [repos.website, repos.billingApi, repos.infrastructure, freshClone, sdk]);
  await page(`${handle(repos.website)}.focus()`);
  await pressKey('ArrowDown');
  await waitFor('website to move down one place', async () => (await listedProjects())[1] === repos.website);
  await waitFor('the new order to be saved', async () => (await savedProjects())[1] === repos.website);
  assert.equal(await page(`document.activeElement === ${handle(repos.website)}`), true, 'the handle keeps the focus, so it can be moved again');
  await pressKey('ArrowUp');
  await waitFor('website to move back up', async () => (await savedProjects())[0] === repos.website);

  // ...and by dragging them by that handle with the mouse: sdk, the last one, goes above infrastructure.
  // The list is longer than its panel, so it is scrolled to where both rows are in view.
  await page(`document.getElementById('projects').scrollTop = document.getElementById('projects').scrollHeight`);
  const list = await boxOf(`document.getElementById('projects')`);
  const grip = await boxOf(handle(sdk));
  const landing = await boxOf(row(repos.infrastructure));
  assert.ok(landing.top >= list.top && grip.bottom <= list.bottom, 'the row to drag and the place to drop it are both in view');
  const from = { x: grip.left + grip.width / 2, y: grip.top + grip.height / 2 };
  const to = { x: from.x, y: landing.top + 4 };

  await cdp.sendCommand('Input.setInterceptDrags', { enabled: true });
  const dragStarted = nextDebuggerEvent('Input.dragIntercepted');
  await mouse('mouseMoved', from);
  await mouse('mousePressed', from, { button: 'left', buttons: 1, clickCount: 1 });
  await mouse('mouseMoved', { x: from.x, y: from.y - 10 }, { button: 'left', buttons: 1 });
  await mouse('mouseMoved', to, { button: 'left', buttons: 1 });
  const { data } = await dragStarted;
  await cdp.sendCommand('Input.dispatchDragEvent', { type: 'dragEnter', ...to, data });
  await cdp.sendCommand('Input.dispatchDragEvent', { type: 'dragOver', ...to, data });
  assert.equal(await page(`${row(sdk)}.classList.contains('is-dragged')`), true, 'the dragged project fades');
  assert.equal(await page(`${row(repos.infrastructure)}.classList.contains('is-drop-before')`), true, 'a line shows where it would land');
  await screenshot('15-reorder-dragging');
  await cdp.sendCommand('Input.dispatchDragEvent', { type: 'drop', ...to, data });
  await mouse('mouseReleased', to, { button: 'left', clickCount: 1 });
  await cdp.sendCommand('Input.setInterceptDrags', { enabled: false });
  const dropped = [repos.website, repos.billingApi, sdk, repos.infrastructure, freshClone];
  await waitFor('sdk to land above infrastructure', async () => (await listedProjects())[2] === sdk);
  await waitFor('the dropped order to be saved', async () => (await savedProjects())[2] === sdk);
  assert.deepEqual(await listedProjects(), dropped);
  assert.deepEqual(await savedProjects(), dropped);
  assert.equal(await page(`document.querySelectorAll('.is-dragged, .is-drop-before, .is-drop-after').length`), 0, 'no trace of the drag is left');
  assert.equal(await localValue(repos.website, 'user.email'), personalDraft.gitEmail, 'reordering leaves every git config alone');

  // A press anywhere else on a row does not arm a drag: it is the click that selects the project.
  const name = await boxOf(`${row(repos.billingApi)}.querySelector('.project__main')`);
  const onName = { x: name.left + 30, y: name.top + name.height / 2 };
  await mouse('mousePressed', onName, { button: 'left', buttons: 1, clickCount: 1 });
  assert.equal(await page(`${row(repos.billingApi)}.draggable`), false, 'only the handle makes a row draggable');
  await mouse('mouseReleased', onName, { button: 'left', clickCount: 1 });
  await waitFor('the click to select the project', () => page(`${row(repos.billingApi)}.classList.contains('project--selected')`));

  // 16. Removing a rule asks first, in the app's own dialog.
  const confirmIsOpen = () => page(`document.getElementById('confirm-dialog').open`);
  await click('.folder .icon-button');
  await waitFor('the question to show', confirmIsOpen);
  assert.equal(await page(`document.getElementById('confirm-title').textContent`), 'Remove rule');
  assert.equal(await page(`document.activeElement.id`), 'confirm-cancel', 'the safe answer has the focus');
  await screenshot('16-confirm');
  await pressKey('Escape');
  await waitFor('Escape to cancel the question', async () => !(await confirmIsOpen()));
  assert.equal(await page(`document.querySelectorAll('.folder').length`), 1, 'cancelling removes nothing');
  assert.equal(await runGit('-C', freshClone, 'config', 'user.email'), workDraft.gitEmail);

  await click('.folder .icon-button');
  await waitFor('the question to show again', confirmIsOpen);
  await click('#confirm-accept');
  await waitFor('the folder rule to be gone', () => page(`document.querySelectorAll('.folder').length === 0`));
  assert.equal(await runGit('-C', freshClone, 'config', 'user.email'), 'ada@example.com', 'the folder is back to the global identity');

  // 17. Settings: the language and the theme change at once.
  const setting = (name) => `document.querySelector('[data-focus-key="setting:${name}"]')`;
  const settingsIsOpen = () => page(`document.getElementById('settings-dialog').open`);
  const chooseSetting = async (name, label) => {
    await page(`${setting(name)}.click()`);
    await page(`[...${setting(name)}.parentElement.querySelectorAll('.dropdown__label')].find((item) => item.textContent === ${JSON.stringify(label)}).click()`);
  };
  await selectProject(repos.website);
  await click('#open-settings');
  assert.equal(await settingsIsOpen(), true);

  // Escape closes the list that is open, not the dialog under it.
  await page(`${setting('language')}.focus()`);
  await pressKey('ArrowDown');
  assert.equal(await page(`${setting('language')}.getAttribute('aria-expanded')`), 'true', 'the down arrow opens the list of languages');
  await screenshot('17-settings');
  await pressKey('Escape');
  assert.equal(await page(`${setting('language')}.getAttribute('aria-expanded')`), 'false');
  assert.equal(await settingsIsOpen(), true, 'Escape closed the list and left the dialog open');

  await chooseSetting('language', 'Español');
  await waitFor('the page to switch to Spanish', () => page(`document.documentElement.lang === 'es'`));
  assert.equal(await page(`document.getElementById('accounts-heading').textContent`), 'Cuentas');
  assert.equal(await page(`document.getElementById('add-project').textContent`), 'Agregar proyecto');
  assert.equal(await page(`document.getElementById('refresh').title`), 'Volver a leer git');
  assert.equal(await page(`document.querySelector('#settings-dialog h2').textContent`), 'Configuración');
  assert.equal(await page(`document.querySelector('.account .chip--ok').textContent`), 'Sesión iniciada');
  assert.equal(await selectedLabel(sdk), 'Regla de propietario (Work)');
  assert.equal(await selectedLabel(freshClone), 'Sin asignar (usa la global)');
  assert.match(await detailText(), /Clave SSH predeterminada\s+este proyecto/);
  assert.equal(await page(`document.activeElement === ${setting('language')}`), true, 'the focus stays on the control that was used');
  assert.equal((await service.getSettings()).language, 'es');
  await screenshot('18-settings-spanish');

  await chooseSetting('theme', 'Oscuro');
  await waitFor('the dark theme to reach the page', () => page(`matchMedia('(prefers-color-scheme: dark)').matches`));
  assert.equal(nativeTheme.themeSource, 'dark');
  await click('#close-settings');
  assert.equal(await settingsIsOpen(), false);

  // A warning written before the switch is said in Spanish now: the page was told what happened, not how to say it.
  await selectProject(repos.infrastructure);
  await runGit('-C', repos.infrastructure, 'config', '--local', 'user.email', 'someone-else@example.com');
  await refresh();
  await waitForText('ya no coincide con la cuenta');
  assert.equal(await selectedLabel(repos.infrastructure), 'Editada a mano (era Work)');
  await screenshot('19-spanish-dark');

  const saved = JSON.parse(await readFile(path.join(userDataDir, 'state.json'), 'utf8'));
  assert.deepEqual(saved.settings, { tourSeen: true, language: 'es', theme: 'dark' });

  assert.deepEqual(problems, [], 'the page logged errors');

  // 18. The app opens again on the same data, in another process.
  app.releaseSingleInstanceLock();
  const exitCode = await new Promise((resolve, reject) => {
    const second = spawn(process.execPath, [scriptPath], { env: { ...process.env, SMOKE_LAUNCH: 'second' }, stdio: 'inherit' });
    second.on('error', reject);
    second.on('exit', resolve);
  });
  assert.equal(exitCode, 0, 'the second launch failed');

  console.log('smoke: ok');
}

/** What must still be there when the app opens again, checked before anything is clicked. */
async function secondLaunch() {
  // The first launch is still running and holds the browser's own files (its cache) open,
  // so this one keeps those apart. The data of the app itself is shared: that is the point.
  app.setPath('sessionData', path.join(sandbox, 'second-launch-session'));
  const { window, service, problems, page, waitFor, waitForText, screenshot } = await launch();

  assert.equal(nativeTheme.themeSource, 'dark', 'the theme is set before the window exists');
  assert.equal(new URL(window.webContents.getURL()).searchParams.get('lang'), 'es', 'the page is told its language as it loads');
  assert.equal(await page(`document.documentElement.lang`), 'es');
  assert.equal(await page(`matchMedia('(prefers-color-scheme: dark)').matches`), true);

  await waitFor('the projects to show', () => page(`document.querySelectorAll('.project').length === 5`));
  await waitForText('Cuentas');
  assert.equal(await page(`document.getElementById('add-account').textContent`), 'Agregar cuenta');
  // The order the first launch left the projects in, after dragging sdk above infrastructure.
  const listed = await page(`[...document.querySelectorAll('.project')].map((item) => item.dataset.path.split(/[\\\\/]/).pop())`);
  assert.deepEqual(listed, ['website', 'billing-api', 'sdk', 'infrastructure', 'mobile-app'], 'the order of the projects is kept');
  assert.equal(await page(`document.querySelector('.tour').open`), false, 'the tour does not greet twice');
  assert.deepEqual(await service.getSettings(), { language: 'es', theme: 'dark', tourSeen: true });
  await screenshot('20-second-launch');

  assert.deepEqual(problems, [], 'the page logged errors');
  console.log('smoke: second launch ok');
}

const watchdog = setTimeout(() => {
  console.error('smoke: timed out');
  app.exit(1);
}, WATCHDOG_MS);

(IS_SECOND_LAUNCH ? secondLaunch() : firstLaunch())
  .then(() => app.exit(0))
  .catch((error) => {
    console.error('smoke: FAILED');
    console.error(error);
    app.exit(1);
  })
  .finally(() => clearTimeout(watchdog));
