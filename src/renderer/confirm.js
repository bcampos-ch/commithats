const CONFIRMED = 'confirmed';

const dialog = document.getElementById('confirm-dialog');
const elements = {
  title: document.getElementById('confirm-title'),
  question: document.getElementById('confirm-question'),
  detail: document.getElementById('confirm-detail'),
  accept: document.getElementById('confirm-accept'),
  cancel: document.getElementById('confirm-cancel'),
};

elements.accept.addEventListener('click', () => dialog.close(CONFIRMED));
elements.cancel.addEventListener('click', () => dialog.close());

/**
 * Asks before doing something that is not undone with a click, in the app's own dialog.
 * Resolves to true when the person goes ahead, and to false when they cancel, press
 * Escape or close the dialog any other way.
 *
 * `title` names the action, `question` asks it about the thing at hand, `detail` says
 * what will happen, and `action` is the label of the button that goes ahead.
 */
export function confirm({ title, question, detail, action }) {
  elements.title.textContent = title;
  elements.question.textContent = question;
  elements.detail.textContent = detail;
  elements.accept.textContent = action;

  return new Promise((resolve) => {
    // The answer of the previous question must not be read as the answer to this one.
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === CONFIRMED), { once: true });
    dialog.showModal();
    // The safe answer is the one a stray Enter gives.
    elements.cancel.focus();
  });
}
