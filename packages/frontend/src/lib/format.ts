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

/** Kinds that render inside the preview modal. */
export type ObjectPreviewKind = 'image' | 'video' | 'audio' | 'text'

/**
 * Kinds recognized for a distinct row icon. A superset of ObjectPreviewKind —
 * these get an icon but no in-browser preview:
 * - 'pdf': native PDF-in-iframe support is unreliable across browsers (some
 *   ship without a built-in PDF viewer, and browsers/ad-blockers can flag an
 *   iframe navigation that falls back to a download as an automatic-download
 *   attack pattern and block it outright). Download still works normally.
 * - 'document' (Word) / 'spreadsheet' (Excel): rendering needs a client-side
 *   parser (mammoth, xlsx) that this project doesn't depend on yet.
 */
export type ObjectIconKind = ObjectPreviewKind | 'pdf' | 'document' | 'spreadsheet'

const PREVIEW_EXTENSIONS: Record<ObjectPreviewKind, Set<string>> = {
    image: new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']),
    video: new Set(['mp4', 'webm', 'ogv', 'mov']),
    audio: new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac']),
    text: new Set(['txt', 'json', 'log', 'md', 'yaml', 'yml', 'csv', 'xml', 'html', 'css', 'js', 'ts']),
}

const ICON_ONLY_EXTENSIONS: Record<Exclude<ObjectIconKind, ObjectPreviewKind>, Set<string>> = {
    pdf: new Set(['pdf']),
    document: new Set(['doc', 'docx', 'rtf', 'odt']),
    spreadsheet: new Set(['xls', 'xlsx', 'xlsm', 'ods']),
}

/**
 * Best-effort preview/icon-kind detection from an object key/name. Storage
 * list APIs (S3 ListObjectsV2, Azure list blobs) do not return content-type
 * per item — only a HEAD/GET on the object would — so this is an extension
 * heuristic. A wrong guess just fails to render the thumbnail/preview, it
 * never blocks any other action.
 */
export function objectIconKind(name: string): ObjectIconKind | null {
    const ext = name.split('.').pop()?.toLowerCase()
    if (!ext) return null
    for (const kind of Object.keys(PREVIEW_EXTENSIONS) as ObjectPreviewKind[]) {
        if (PREVIEW_EXTENSIONS[kind].has(ext)) return kind
    }
    for (const kind of Object.keys(ICON_ONLY_EXTENSIONS) as Array<'pdf' | 'document' | 'spreadsheet'>) {
        if (ICON_ONLY_EXTENSIONS[kind].has(ext)) return kind
    }
    return null
}

const ICON_ONLY_KINDS = new Set(Object.keys(ICON_ONLY_EXTENSIONS))

/** Narrower than {@link objectIconKind}: only kinds the preview modal can render. */
export function objectPreviewKind(name: string): ObjectPreviewKind | null {
    const kind = objectIconKind(name)
    return kind && !ICON_ONLY_KINDS.has(kind) ? kind as ObjectPreviewKind : null
}

/** Stable class-name fragment for a status value. */
export function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
}
