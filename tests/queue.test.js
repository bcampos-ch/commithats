import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createQueue } from '../src/core/queue.js';

const soon = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

describe('queue', () => {
  it('lets one call finish before the next one starts, in the order they were made', async () => {
    const inTurn = createQueue();
    const log = [];
    const slow = inTurn(async () => {
      log.push('slow starts');
      await soon(20);
      log.push('slow ends');
    });
    const quick = inTurn(async () => {
      log.push('quick runs');
    });

    await Promise.all([slow(), quick()]);

    assert.deepEqual(log, ['slow starts', 'slow ends', 'quick runs']);
  });

  it('makes different functions wrapped by the same queue take turns with each other', async () => {
    const inTurn = createQueue();
    let running = 0;
    let overlapped = false;
    const task = async () => {
      running += 1;
      overlapped ||= running > 1;
      await soon(5);
      running -= 1;
    };
    const first = inTurn(task);
    const second = inTurn(task);

    await Promise.all([first(), second(), first(), second()]);

    assert.equal(overlapped, false);
  });

  it('hands each caller its own result or failure, and carries on after a failure', async () => {
    const inTurn = createQueue();
    const double = inTurn(async (value) => {
      if (value < 0) throw new RangeError('negative');
      return value * 2;
    });

    const [first, failed, last] = await Promise.allSettled([double(2), double(-1), double(5)]);

    assert.equal(first.value, 4);
    assert.ok(failed.reason instanceof RangeError);
    assert.equal(last.value, 10);
  });
});
