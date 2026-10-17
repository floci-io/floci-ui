/**
 * Run `operation` with a signal that aborts when `parent` aborts or `ms` passes,
 * whichever comes first. The timer is cleared once the operation settles.
 */
export async function withDeadline<T>(
    ms: number,
    parent: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(new DOMException(`Operation exceeded ${ms} ms`, 'TimeoutError')), ms)
    try {
        return await operation(parent ? AbortSignal.any([parent, deadline.signal]) : deadline.signal)
    } finally {
        clearTimeout(timer)
    }
}
