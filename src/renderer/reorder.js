const HANDLE = '[data-reorder-handle]';
const DRAGGED = 'is-dragged';
const DROP_BEFORE = 'is-drop-before';
const DROP_AFTER = 'is-drop-after';

/**
 * Lets the rows inside `container` be put in another order, by dragging a row by its
 * handle or with the up and down arrows while the handle has focus.
 *
 * A row is any element matching `rowSelector`, and its handle is the element inside it
 * marked `data-reorder-handle`. `onMove(from, to)` gets the place the row left and the
 * place it takes, both counted from zero. The rows themselves are not touched: whoever
 * owns the list draws it again in the new order.
 *
 * The listeners sit on the container, so the rows can be replaced at any time.
 */
export function makeReorderable(container, { rowSelector, onMove }) {
  let dragged = null;
  let insertion = null;

  const rows = () => [...container.querySelectorAll(rowSelector)];
  const rowOf = (element) => element.closest?.(rowSelector) ?? null;

  function mark(index) {
    const all = rows();
    for (const row of all) row.classList.remove(DROP_BEFORE, DROP_AFTER);
    insertion = index;
    if (index === null || all.length === 0) return;

    // A line where the row would land: over the row that follows it, or under the last one.
    if (index < all.length) all[index].classList.add(DROP_BEFORE);
    else all.at(-1).classList.add(DROP_AFTER);
  }

  function finish() {
    mark(null);
    for (const row of rows()) {
      row.classList.remove(DRAGGED);
      row.draggable = false;
    }
    dragged = null;
  }

  // A row can only be dragged by its handle, so its text and its controls behave as usual.
  container.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest?.(HANDLE);
    const row = handle && rowOf(handle);
    if (row) row.draggable = true;
  });
  container.addEventListener('pointerup', () => {
    if (dragged === null) finish();
  });

  container.addEventListener('dragstart', (event) => {
    const row = rowOf(event.target);
    if (!row?.draggable) return;

    dragged = row;
    row.classList.add(DRAGGED);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragover', (event) => {
    if (dragged === null) return;

    // Without this the browser treats the spot as one where nothing can be dropped.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    // The row lands before the first row whose middle is below the pointer.
    const all = rows();
    const following = all.findIndex((row) => {
      const box = row.getBoundingClientRect();
      return event.clientY < box.top + box.height / 2;
    });
    mark(following === -1 ? all.length : following);
  });

  container.addEventListener('dragleave', (event) => {
    if (!container.contains(event.relatedTarget)) mark(null);
  });

  container.addEventListener('drop', (event) => {
    if (dragged === null || insertion === null) return;
    event.preventDefault();

    const from = rows().indexOf(dragged);
    // Taking the row out of the list first shifts every place after it by one.
    const to = from < insertion ? insertion - 1 : insertion;
    finish();
    if (from !== -1 && to !== from) onMove(from, to);
  });

  container.addEventListener('dragend', finish);

  container.addEventListener('keydown', (event) => {
    const handle = event.target.closest?.(HANDLE);
    if (!handle) return;

    // On a handle, the keys that scroll a list would move it from under the focus.
    if (event.key === ' ') event.preventDefault();
    const step = { ArrowUp: -1, ArrowDown: 1 }[event.key];
    if (step === undefined) return;

    // The arrows move the row, not the scroll position.
    event.preventDefault();
    const all = rows();
    const from = all.indexOf(rowOf(handle));
    const to = from + step;
    if (from !== -1 && to >= 0 && to < all.length) onMove(from, to);
  });
}
