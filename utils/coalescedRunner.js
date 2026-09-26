/**
 * Wrap an async task so overlapping calls are merged instead of dropped:
 * - idle → start the task;
 * - running → remember that another run is wanted and return the current promise;
 * - when the task ends and another run was wanted → run exactly once more.
 * Every caller's promise settles after the run that reflects their request.
 */
export function createCoalescedRunner(task) {
  let inFlight = null;
  let rerun = false;

  return function run() {
    if (inFlight) {
      rerun = true;
      return inFlight;
    }
    inFlight = (async () => {
      try {
        do {
          rerun = false;
          await task();
        } while (rerun);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
}
