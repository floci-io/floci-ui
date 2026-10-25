/** `Promise.all(items.map(fn))` with at most `limit` calls in flight. */
export async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let next = 0
    const worker = async () => {
        while (next < items.length) {
            const index = next++
            results[index] = await fn(items[index])
        }
    }
    await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker))
    return results
}
