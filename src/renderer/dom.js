/**
 * Creates an element. Text always goes in as text nodes, never as markup,
 * so values read from git config or typed by the user cannot inject HTML.
 *
 * Props: `class`, `dataset` (object), `style` (object of CSS custom properties),
 * `on*` (event listeners), and anything else as a property or attribute.
 *
 * Children can be nodes, text, or lists of them nested to any depth; null, undefined
 * and false are skipped, so a child can be written as `condition && h(...)`.
 */
export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);

  for (const [name, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;

    if (name === 'class') element.className = value;
    else if (name === 'dataset') Object.assign(element.dataset, value);
    else if (name === 'style') setCustomProperties(element, value);
    else if (name.startsWith('on')) element.addEventListener(name.slice(2), value);
    else if (name.includes('-')) element.setAttribute(name, String(value));
    else element[name] = value;
  }

  element.append(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false));
  return element;
}

export function classes(...names) {
  return names.filter(Boolean).join(' ');
}

function setCustomProperties(element, properties) {
  for (const [name, value] of Object.entries(properties)) element.style.setProperty(name, String(value));
}
