// Runs `fn` over `items` with at most `limit` promises in flight at once,
// returning results in the original order. Used to stop the per-bug /
// per-test-case fan-outs from firing hundreds of concurrent requests at Azure
// DevOps (which throttles, making the whole build slower than a controlled
// stream).
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    const effectiveLimit = Math.max(1, Math.min(limit, items.length || 1));
    let cursor = 0;

    async function worker(): Promise<void> {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await fn(items[index], index);
        }
    }

    await Promise.all(
        Array.from({ length: effectiveLimit }, () => worker())
    );

    return results;
}
