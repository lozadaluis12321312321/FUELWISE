import { validateState } from './core.js';

export const STATE_KEY = 'fuelwise.v1';
export const BACKUP_KEY = 'fuelwise.last-good.v1';
export const RECOVERY_KEY = 'fuelwise.recovery.v1';

export function createStore(adapter, fallbackRead) {
  let previous = null;
  let raw = null;
  let queue = Promise.resolve();
  const enqueue = task => {
    const operation = queue.then(task);
    queue = operation.catch(() => {});
    return operation;
  };
  return {
    async load() {
      raw = await adapter.get(STATE_KEY);
      if (raw == null && fallbackRead) raw = await fallbackRead();
      if (raw == null) return undefined;
      const state = validateState(JSON.parse(raw));
      previous = JSON.stringify(state);
      return state;
    },
    getRaw: () => raw,
    async getBackup() {
      const saved = await adapter.get(BACKUP_KEY);
      return saved == null ? undefined : validateState(JSON.parse(saved));
    },
    save(input) {
      const next = validateState(input);
      const snapshot = JSON.stringify(next);
      return enqueue(async () => {
        if (previous && previous !== snapshot) await adapter.set(BACKUP_KEY, previous);
        await adapter.set(STATE_KEY, snapshot);
        previous = snapshot;
        raw = snapshot;
        return next;
      });
    },
    restore(input) {
      const next = validateState(input);
      const snapshot = JSON.stringify(next);
      return enqueue(async () => {
        const original = await adapter.get(STATE_KEY);
        if (original != null) await adapter.set(RECOVERY_KEY, original);
        await adapter.set(STATE_KEY, snapshot);
        previous = snapshot;
        raw = snapshot;
        return next;
      });
    },
  };
}
