import { h } from './dom.js';
import { t } from './i18n.js';
import { placeCard } from './placement.js';

// Room around the target inside the spotlight, and the spotlight's distance from the edges.
const PAD = 8;

/**
 * The steps of the guided tour. Each one points at what it talks about through the
 * `data-tour` keys of its `targets`, by preference: the first one on screen wins.
 * With none, or none on screen, the card shows centered.
 */
const STEPS = [
  { targets: [], title: () => t('tour.welcome.title'), body: () => t('tour.welcome.body') },
  { targets: ['accounts'], title: () => t('tour.accounts.title'), body: () => t('tour.accounts.body') },
  // The rule buttons only exist once there is an account.
  { targets: ['rules', 'accounts'], title: () => t('tour.rules.title'), body: () => t('tour.rules.body') },
  { targets: ['projects'], title: () => t('tour.projects.title'), body: () => t('tour.projects.body') },
  { targets: ['detail'], title: () => t('tour.detail.title'), body: () => t('tour.detail.body') },
  { targets: ['toolbar'], title: () => t('tour.toolbar.title'), body: () => t('tour.toolbar.body') },
];

/**
 * The guided tour, ported from Tramo: the page dims except for a spotlight on what
 * the step talks about, and a card next to it explains it. It is a native modal
 * <dialog>, so focus stays in the card, the page cannot be clicked by accident, and
 * Escape leaves the tour.
 *
 * The spotlight and the card are placed again on every frame while the tour is open,
 * so they follow scrolling, resizing and a page that is still filling in.
 *
 * `onClose` is called when the tour ends, whether it was finished or left halfway.
 */
export function createTour({ onClose }) {
  let index = null;
  let frame = 0;
  let scrolledTo = null;

  const spotlight = h('div', { class: 'tour__spotlight', 'aria-hidden': 'true' });
  const content = h('div', { class: 'tour__content' });
  const skipButton = h('button', { class: 'button button--quiet', type: 'button', onclick: close });
  const backButton = h('button', { class: 'button', type: 'button', onclick: () => show(index - 1) });
  // `autofocus` makes the dialog open with focus on the way forward, not on the first button it finds.
  const nextButton = h('button', { class: 'button button--primary', type: 'button', autofocus: true, onclick: next });
  const card = h(
    'div',
    { class: 'tour__card' },
    content,
    h('div', { class: 'tour__actions' }, skipButton, h('span', { class: 'tour__spacer' }), backButton, nextButton),
  );
  const announcer = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const dialog = h(
    'dialog',
    {
      class: 'tour',
      'aria-labelledby': 'tour-title',
      'aria-describedby': 'tour-body',
      // Escape leaves the tour through `close`, so whoever opened it hears about it.
      oncancel: (event) => {
        event.preventDefault();
        close();
      },
      onkeydown: (event) => {
        if (event.key === 'ArrowRight') next();
        if (event.key === 'ArrowLeft' && index > 0) show(index - 1);
      },
    },
    spotlight,
    card,
    announcer,
  );
  document.body.append(dialog);

  function show(step) {
    index = step;
    scrolledTo = null;

    const { title, body } = STEPS[index];
    const progress = t('tour.progress', { current: index + 1, total: STEPS.length });
    // A new node for every step, so each one gently pops in.
    content.replaceChildren(
      h(
        'div',
        { class: 'tour__step' },
        h('p', { class: 'tour__progress' }, progress),
        h('h2', { id: 'tour-title', class: 'tour__title' }, title()),
        h('p', { id: 'tour-body', class: 'tour__body' }, body()),
      ),
    );
    skipButton.textContent = t('tour.skip');
    backButton.textContent = t('tour.back');
    backButton.hidden = index === 0;
    nextButton.textContent = index === STEPS.length - 1 ? t('common.done') : t('tour.next');
    announcer.textContent = `${progress}: ${title()}`;

    place();
  }

  function next() {
    if (index === STEPS.length - 1) close();
    else show(index + 1);
  }

  function place() {
    const target = findTarget(STEPS[index].targets);
    if (target && scrolledTo !== target) {
      target.scrollIntoView({ block: 'nearest' });
      scrolledTo = target;
    }

    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const box = target ? spotlightBox(target.getBoundingClientRect(), viewport) : null;
    // No target: a spotlight of no size in the middle, so its shadow dims everything.
    const hole = box ?? { top: viewport.height / 2, left: viewport.width / 2, width: 0, height: 0 };
    spotlight.dataset.hole = String(box !== null);
    for (const side of ['top', 'left', 'width', 'height']) spotlight.style.setProperty(side, `${hole[side]}px`);

    const { top, left } = placeCard(box, card.getBoundingClientRect(), viewport);
    card.style.setProperty('top', `${Math.round(top)}px`);
    card.style.setProperty('left', `${Math.round(left)}px`);
    // Focus lives in the card, on the way forward unless the person moved it.
    if (!card.contains(document.activeElement)) nextButton.focus({ preventScroll: true });
  }

  function follow() {
    place();
    frame = requestAnimationFrame(follow);
  }

  function close() {
    if (index === null) return;

    cancelAnimationFrame(frame);
    index = null;
    dialog.close();
    onClose();
  }

  return {
    /** Opens the tour on its first step. It does nothing while the tour is already open. */
    start() {
      if (index !== null) return;

      dialog.showModal();
      show(0);
      frame = requestAnimationFrame(follow);
    },
  };
}

// The first element on screen marked with one of the keys, by preference.
function findTarget(keys) {
  for (const key of keys) {
    for (const element of document.querySelectorAll(`[data-tour~="${key}"]`)) {
      if (element.getClientRects().length > 0) return element;
    }
  }
  return null;
}

// The target's box plus some room, kept inside the window so a target as tall as
// the window (a whole panel) still shows its whole outline.
function spotlightBox(rect, viewport) {
  const top = Math.max(PAD, rect.top - PAD);
  const left = Math.max(PAD, rect.left - PAD);
  const bottom = Math.min(viewport.height - PAD, rect.bottom + PAD);
  const right = Math.min(viewport.width - PAD, rect.right + PAD);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
