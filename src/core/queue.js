/**
 * Makes functions take turns. `createQueue()` answers with a wrapper: every function
 * wrapped by the same queue waits for the calls made before it to finish, whether they
 * succeeded or failed, so their steps never interleave. Each caller still gets its own
 * result, or its own failure.
 */
export function createQueue() {
  let tail = Promise.resolve();
  return (task) =>
    (...args) => {
      const run = tail.then(() => task(...args));
      tail = run.catch(() => {});
      return run;
    };
}
