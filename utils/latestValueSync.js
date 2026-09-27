/**
 * Keep a server value in step with rapid local edits (e.g. a +/− counter):
 * - only one save runs at a time, and saves happen in order;
 * - while a save runs, further edits just update `desired`; the latest one is sent next
 *   (intermediate values are skipped);
 * - on failure `desired` falls back to the last confirmed value and `onFailure` is called
 *   with it, so the UI never keeps showing an unsaved number.
 *
 * @param {{ confirmed: number, save: (value: number) => Promise<void>,
 *           onSaved?: (value: number) => void, onFailure?: (confirmed: number, error: Error) => void }} opts
 */
export function createLatestValueSync({ confirmed, save, onSaved, onFailure }) {
  const state = { confirmed, desired: confirmed, saving: false };

  const flush = async () => {
    if (state.saving) return;
    state.saving = true;
    try {
      while (state.desired !== state.confirmed) {
        const target = state.desired;
        await save(target);
        state.confirmed = target;
      }
      onSaved?.(state.confirmed);
    } catch (error) {
      state.desired = state.confirmed;
      onFailure?.(state.confirmed, error);
    } finally {
      state.saving = false;
    }
  };

  return {
    get desired() {
      return state.desired;
    },
    get confirmed() {
      return state.confirmed;
    },
    /** Record the user's latest value and start saving it. */
    set(value) {
      if (value === state.desired) return;
      state.desired = value;
      flush();
    },
  };
}
