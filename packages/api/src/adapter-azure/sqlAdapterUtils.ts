import type {CloudResource} from '../cloud-spi/types'

export function withApiVersion(path: string, apiVersion: string): string {
    const separator = path.includes('?') ? '&' : '?'
    return `${path}${separator}api-version=${apiVersion}`
}

export function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

export function tagList(tags?: Record<string, string>): Array<{key: string; value: string}> {
    return Object.entries(tags ?? {}).map(([key, value]) => ({key, value}))
}

export function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

export function rawStringValue(value: unknown): string {
    return typeof value === 'string' ? value : ''
}

export function recordValue(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

export function numberValue(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function isValidServerName(value: string): boolean {
    return value.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)
}
