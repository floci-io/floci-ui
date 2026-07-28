/**
 * Read a dotted path out of a resource.
 *
 * Table columns default to a top-level lookup, but most provider detail lives
 * under `metadata`, so a column like `metadata.runtime` needs to walk. Returns
 * undefined on any non-object hop rather than throwing, because schemas are
 * server-supplied and may name a field a given runtime does not populate.
 */
export function getPath(source: unknown, path: string): unknown {
    if (!path) return undefined

    let current = source
    for (const segment of path.split('.')) {
        if (current === null || current === undefined) return undefined
        if (typeof current !== 'object') return undefined

        if (Array.isArray(current)) {
            const index = Number(segment)
            if (!Number.isInteger(index)) return undefined
            current = current[index]
            continue
        }

        current = (current as Record<string, unknown>)[segment]
    }

    return current
}
