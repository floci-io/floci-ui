/** Formatting helpers for the workflow execution history viewer. */

/** A running execution has no duration yet; that is a real state, not missing data. */
export function formatDuration(ms?: number): string {
    if (ms === undefined || !Number.isFinite(ms) || ms < 0) return 'in progress'
    if (ms < 1000) return `${ms} ms`
    // Round the total first so the seconds remainder carries into the minutes:
    // 119500 ms is "2m 0s", never "1m 60s". The same rounding decides when a
    // value stops being shown with a decimal, so 59.99 s does not print as "60.0 s".
    const totalSeconds = Math.round(ms / 1000)
    if (totalSeconds < 60) return `${(ms / 1000).toFixed(1)} s`
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}m ${seconds}s`
}

/**
 * Step Functions does not record history for Express workflows, whose execution
 * ARNs carry `:express:` where Standard ones carry `:execution:`. The panel uses
 * this to explain the gap instead of issuing a request the runtime will refuse.
 */
export function isExpressExecution(executionArn: string): boolean {
    return executionArn.split(':')[5] === 'express'
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
