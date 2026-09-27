/**
 * Reject if `promise` does not settle within `ms` (avoids infinite startup spinners).
 */
export function promiseWithTimeout(promise, ms, label = 'Operation') {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}
