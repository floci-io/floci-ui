/** Formatting helpers for the workflow execution history viewer. */

/** A running execution has no duration yet; that is a real state, not missing data. */
export function formatDuration(ms?: number): string {
    if (ms === undefined || !Number.isFinite(ms) || ms < 0) return 'in progress'
    if (ms < 1000) return `${ms} ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
    const minutes = Math.floor(ms / 60_000)
    const seconds = Math.round((ms % 60_000) / 1000)
    return `${minutes}m ${seconds}s`
}

/**
 * The one-line column: the state name, the task resource, or the error. The
 * full details object is a click away, so this only has to orient the reader.
 */
export function summarizeDetails(details: Record<string, unknown>): string {
    const parts: string[] = []
    if (typeof details.name === 'string') parts.push(details.name)
    if (typeof details.resourceType === 'string') {
        parts.push(
            typeof details.resource === 'string' ? `${details.resourceType}:${details.resource}` : details.resourceType,
        )
    }
    if (typeof details.error === 'string') {
        parts.push(typeof details.cause === 'string' && details.cause ? `${details.error}: ${details.cause}` : details.error)
    }
    return parts.length > 0 ? parts.join(' · ') : '-'
}

/**
 * Step Functions returns `input` and `output` as JSON-encoded strings. Showing
 * them as nested objects reads far better than an escaped one-liner, and a
 * value that is not JSON is left as the string it was.
 */
export function expandJsonStrings(details: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(details).map(([key, value]) => {
            if (typeof value !== 'string') return [key, value]
            const trimmed = value.trim()
            if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return [key, value]
            try {
                return [key, JSON.parse(trimmed)]
            } catch {
                return [key, value]
            }
        }),
    )
}
