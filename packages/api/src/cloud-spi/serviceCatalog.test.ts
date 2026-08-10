import {describe, expect, test} from 'bun:test'
import {
    SERVICE_CATALOG,
    SERVICE_CATALOG_ENTRIES,
    SERVICE_GROUP_ORDER,
    SERVICE_TYPES,
    catalogEntry,
    displayNameFor,
    isServiceType,
    routeFor,
} from './serviceCatalog'

describe('SERVICE_CATALOG', () => {
    test('every entry carries the metadata the nav needs', () => {
        for (const entry of SERVICE_CATALOG_ENTRIES) {
            expect(entry.displayName.length).toBeGreaterThan(0)
            expect(entry.iconKey.length).toBeGreaterThan(0)
            expect(SERVICE_GROUP_ORDER).toContain(entry.group)
            expect(Number.isFinite(entry.order)).toBe(true)
            expect(routeFor(entry).length).toBeGreaterThan(0)
        }
    })

    test('exposes one entry per catalog key', () => {
        expect(SERVICE_CATALOG_ENTRIES).toHaveLength(Object.keys(SERVICE_CATALOG).length)
        expect(new Set(SERVICE_TYPES).size).toBe(SERVICE_TYPES.length)
    })

    test('registers the iac category under the Provisioning group', () => {
        expect(SERVICE_GROUP_ORDER).toContain('Provisioning')
        const iac = catalogEntry('iac')!
        expect(iac.group).toBe('Provisioning')
        expect(isServiceType('iac')).toBe(true)
        expect(displayNameFor(iac, 'aws')).toBe('CloudFormation')
    })

    test('orders entries by group then in-group order', () => {
        const positions = SERVICE_CATALOG_ENTRIES.map((entry) => [
            SERVICE_GROUP_ORDER.indexOf(entry.group),
            entry.order,
        ])

        for (let i = 1; i < positions.length; i += 1) {
            const [prevGroup, prevOrder] = positions[i - 1]!
            const [group, order] = positions[i]!
            expect(prevGroup < group || (prevGroup === group && prevOrder <= order)).toBe(true)
        }
    })

    test('routes default to the slug and stay absolute for legacy pages', () => {
        expect(routeFor(catalogEntry('storage')!)).toBe('storage')
        // Secrets Manager still lives outside Cloud Explorer.
        expect(routeFor(catalogEntry('secrets')!)).toBe('/secretsmanager')
    })

    test('resolves per-cloud routes so one category can span a legacy page and the explorer', () => {
        const secrets = catalogEntry('secrets')!
        expect(routeFor(secrets, 'aws')).toBe('/secretsmanager')
        expect(routeFor(secrets, 'azure')).toBe('secrets')
        // A category with no per-cloud override is unaffected by the cloud argument.
        expect(routeFor(catalogEntry('storage')!, 'azure')).toBe('storage')
    })

    test('resolves per-cloud display names', () => {
        const k8s = catalogEntry('k8s')!
        expect(displayNameFor(k8s, 'aws')).toBe('EKS')
        expect(displayNameFor(k8s, 'azure')).toBe('AKS')
        expect(displayNameFor(k8s, 'gcp')).toBe('GKE')
        // No override -> the shared display name.
        expect(displayNameFor(catalogEntry('storage')!, 'gcp')).toBe('Storage')
    })
})

describe('isServiceType', () => {
    test('accepts every catalog key', () => {
        for (const service of SERVICE_TYPES) {
            expect(isServiceType(service)).toBe(true)
        }
    })

    test('rejects unknown slugs so routes 404 instead of failing later', () => {
        for (const slug of ['queue', 'stroage', '', 'constructor', '__proto__', 'toString']) {
            expect(isServiceType(slug)).toBe(false)
        }
    })

    test('catalogEntry returns undefined for an unknown slug', () => {
        expect(catalogEntry('queue')).toBeUndefined()
    })
})
