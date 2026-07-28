/** Shared value formatters for tables, inspectors and the object browser. */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '-'
    if (bytes === 0) return '0 B'
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1)
    return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${BYTE_UNITS[index]}`
}

/** Locale date-time, or null when the value is not a usable timestamp. */
export function formatDateTime(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toLocaleString()
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000_000],
    ['month', 2_592_000_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
    ['second', 1_000],
]

/** "3 minutes ago", or null when the value is not a usable timestamp. */
export function formatRelativeTime(value: unknown, now: number = Date.now()): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null

    const deltaMs = date.getTime() - now
    const formatter = new Intl.RelativeTimeFormat(undefined, {numeric: 'auto'})
    for (const [unit, unitMs] of RELATIVE_UNITS) {
        if (Math.abs(deltaMs) >= unitMs) {
            return formatter.format(Math.round(deltaMs / unitMs), unit)
        }
    }
    return formatter.format(0, 'second')
}

/** Stable class-name fragment for a status value. */
export function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
}
