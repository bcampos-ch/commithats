import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { placeCard } from '../src/renderer/placement.js';

// The window at its default size, and the card of the guided tour.
const viewport = { width: 1080, height: 720 };
const card = { width: 304, height: 220 };

describe('placeCard', () => {
  it('centers the card when there is nothing to point at', () => {
    assert.deepEqual(placeCard(null, card, viewport), { top: 250, left: 388 });
  });

  it('sits under its target, lined up with its left edge', () => {
    const target = { top: 100, left: 200, width: 400, height: 60 };

    assert.deepEqual(placeCard(target, card, viewport), { top: 176, left: 200 });
  });

  it('goes above a target that leaves no room below', () => {
    const target = { top: 500, left: 200, width: 400, height: 150 };

    assert.deepEqual(placeCard(target, card, viewport), { top: 264, left: 200 });
  });

  it('never leaves the viewport sideways', () => {
    const nearTheRightEdge = { top: 20, left: 900, width: 160, height: 32 };

    assert.deepEqual(placeCard(nearTheRightEdge, card, viewport), { top: 68, left: 760 });
  });

  it('sits beside a target as tall as the window, on the side that has room', () => {
    const accountsPanel = { top: 78, left: 8, width: 336, height: 634 };
    const projectsPanel = { top: 78, left: 340, width: 732, height: 634 };

    assert.deepEqual(placeCard(accountsPanel, card, viewport), { top: 78, left: 360 });
    assert.deepEqual(placeCard(projectsPanel, card, viewport), { top: 78, left: 20 });
  });

  it('stays inside the window, over the target, when no side has room', () => {
    const everything = { top: 8, left: 8, width: 1064, height: 704 };

    assert.deepEqual(placeCard(everything, card, viewport), { top: 484, left: 16 });
  });
});
