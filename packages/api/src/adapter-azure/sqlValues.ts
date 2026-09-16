export function normalizeSqlRow(row: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeSqlValue(value)]))
}

function normalizeSqlValue(value: unknown): unknown {
    if (value === null || value === undefined) return null
    if (typeof value === 'bigint') return value.toString()
    if (value instanceof Date) return value.toISOString()
    if (Buffer.isBuffer(value)) return value.toString('base64')
    if (Array.isArray(value)) return value.map(normalizeSqlValue)
    if (typeof value === 'object') return normalizeSqlRow(value as Record<string, unknown>)
    return value
}
