import { h } from './dom.js';

const OPEN_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter', ' ']);
const GAP = 4;
const VIEWPORT_MARGIN = 8;
const TYPEAHEAD_RESET_MS = 500;

let dropdownCount = 0;

/**
 * The app's select, ported from Tramo: a hand-built listbox following the WAI-ARIA
 * "select-only combobox" pattern, instead of a native <select> whose list the
 * operating system draws and no style can reach.
 *
 * Focus stays on the trigger while the list is open, and `aria-activedescendant`
 * points at the active option. Arrows move, Home and End jump, Enter and Space pick,
 * Escape and Tab close, and typing jumps to the option that starts with it.
 *
 * The list opens in the top layer (the Popover API), so a scrolling panel cannot clip it.
 *
 * `options` is a list of `{ value, label }`. `onChange` gets the value of the option
 * the person picked, and only when it differs from `value`.
 */
export function dropdown({ label, value, options, disabled = false, focusKey, onChange }) {
  dropdownCount += 1;
  const id = `dropdown-${dropdownCount}`;
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const typeahead = { buffer: '', time: 0 };
  let active = -1;

  const optionElements = options.map((option, index) =>
    h(
      'li',
      {
        class: 'dropdown__option',
        id: `${id}-option-${index}`,
        role: 'option',
        'aria-selected': String(index === selectedIndex),
        onmousemove: () => setActive(index),
        // Keeps focus on the trigger while an option is clicked.
        onmousedown: (event) => event.preventDefault(),
        onclick: () => select(index),
      },
      h('span', { class: 'dropdown__label' }, option.label),
      h('span', { class: 'dropdown__check', 'aria-hidden': 'true' }),
    ),
  );

  const list = h(
    'ul',
    { class: 'dropdown__list', id: `${id}-list`, role: 'listbox', 'aria-label': label, popover: 'manual' },
    optionElements,
  );

  const trigger = h(
    'button',
    {
      class: 'dropdown__trigger',
      type: 'button',
      role: 'combobox',
      disabled,
      'aria-label': label,
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
      dataset: { focusKey },
      onclick: () => (isOpen() ? close({ focusBack: true }) : open()),
      onkeydown: onKeyDown,
    },
    h('span', { class: 'dropdown__value' }, options[selectedIndex].label),
    h('span', { class: 'dropdown__chevron', 'aria-hidden': 'true' }),
  );

  const root = h('span', { class: 'dropdown' }, trigger, list);

  function isOpen() {
    return list.isConnected && list.matches(':popover-open');
  }

  function open() {
    list.showPopover();
    place();
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-controls', list.id);
    setActive(selectedIndex);

    document.addEventListener('pointerdown', onPointerDownOutside, true);
    document.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);
  }

  function close({ focusBack }) {
    document.removeEventListener('pointerdown', onPointerDownOutside, true);
    document.removeEventListener('scroll', onViewportChange, true);
    window.removeEventListener('resize', onViewportChange);

    if (isOpen()) list.hidePopover();
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-controls');
    trigger.removeAttribute('aria-activedescendant');
    setActive(-1);
    if (focusBack) trigger.focus();
  }

  // Under the trigger and as wide as it, or above it when there is no room below.
  function place() {
    const anchor = trigger.getBoundingClientRect();
    list.style.setProperty('min-width', `${anchor.width}px`);

    const { offsetWidth: width, offsetHeight: height } = list;
    const below = anchor.bottom + GAP;
    const fitsBelow = below + height <= window.innerHeight - VIEWPORT_MARGIN;
    const top = fitsBelow ? below : Math.max(VIEWPORT_MARGIN, anchor.top - GAP - height);
    const left = Math.max(VIEWPORT_MARGIN, Math.min(anchor.left, window.innerWidth - VIEWPORT_MARGIN - width));

    list.style.setProperty('top', `${top}px`);
    list.style.setProperty('left', `${left}px`);
  }

  function setActive(index) {
    active = index;
    optionElements.forEach((element, position) => {
      element.classList.toggle('dropdown__option--active', position === index);
    });
    if (index < 0) return;

    trigger.setAttribute('aria-activedescendant', optionElements[index].id);
    // Arrows scroll the list, not the page.
    optionElements[index].scrollIntoView({ block: 'nearest' });
  }

  function select(index) {
    const option = options[index];
    if (!option) return;

    close({ focusBack: true });
    if (option.value !== value) onChange(option.value);
  }

  function typeaheadTo(character) {
    const now = Date.now();
    typeahead.buffer = now - typeahead.time < TYPEAHEAD_RESET_MS ? typeahead.buffer + character : character;
    typeahead.time = now;

    const wanted = typeahead.buffer.toLowerCase();
    const index = options.findIndex((option) => option.label.toLowerCase().startsWith(wanted));
    if (index !== -1) setActive(index);
  }

  function onKeyDown(event) {
    if (!isOpen()) {
      if (OPEN_KEYS.has(event.key)) {
        event.preventDefault();
        open();
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive(Math.min(options.length - 1, active + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive(Math.max(0, active - 1));
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        // Without this, the click a button gets from Enter and Space would reopen the list.
        event.preventDefault();
        if (active >= 0) select(active);
        break;
      case 'Escape':
        event.preventDefault();
        close({ focusBack: true });
        break;
      case 'Tab':
        close({ focusBack: false });
        break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) typeaheadTo(event.key);
    }
  }

  // A click outside closes without moving focus: the click takes it.
  function onPointerDownOutside(event) {
    if (!root.contains(event.target)) close({ focusBack: false });
  }

  // The list is placed once, so it closes instead of drifting away from its trigger.
  function onViewportChange(event) {
    if (event.type === 'scroll' && list.contains(event.target)) return;
    close({ focusBack: false });
  }

  return root;
}
