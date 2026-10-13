/**
 * Where the card of the guided tour goes, in viewport coordinates. `target` is the
 * box it talks about (`{ top, left, width, height }`), or null when there is nothing
 * to point at; `card` and `viewport` are sizes (`{ width, height }`).
 *
 * Centered without a target. Otherwise under the target, or above it when it does
 * not fit below, lined up with its left edge. A target as tall as the window (a whole
 * panel) gets the card beside it, on the side that has room. It never leaves the
 * window: with no room on any side it is pinned inside, over the target.
 */
export function placeCard(target, card, viewport, margin = 16) {
  if (!target) {
    return { top: (viewport.height - card.height) / 2, left: (viewport.width - card.width) / 2 };
  }

  const lowest = viewport.height - card.height - margin;
  const alignedLeft = clamp(target.left, margin, viewport.width - card.width - margin);

  const below = target.top + target.height + margin;
  if (below <= lowest) return { top: below, left: alignedLeft };

  const above = target.top - card.height - margin;
  if (above >= margin) return { top: above, left: alignedLeft };

  const alignedTop = clamp(target.top, margin, lowest);
  const right = target.left + target.width + margin;
  if (right + card.width <= viewport.width - margin) return { top: alignedTop, left: right };

  const left = target.left - card.width - margin;
  if (left >= margin) return { top: alignedTop, left };

  return { top: Math.max(margin, lowest), left: alignedLeft };
}

// The lower bound wins when the range is empty (a window smaller than the card).
function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}
