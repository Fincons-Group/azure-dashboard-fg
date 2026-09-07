// De-duplicates concurrent identical async work. While a call for `key` is
// pending, every other caller with the same key gets the *same* promise
// instead of starting its own run; the entry is dropped once it settles.
//
// This is what stops the Excel Export page (3 scope presets on one project,
// fired in parallel) from triggering 3 full `getDefectData` builds - they all
// miss the 5-minute result cache because it's only populated once the first
// build finishes.
const pending = new Map<string, Promise<unknown>>();

export function dedupe<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = pending.get(key) as Promise<T> | undefined;
    if (existing) {
        return existing;
    }

    const run = (async () => factory())().finally(() => {
        pending.delete(key);
    });

    pending.set(key, run);
    return run;
}
