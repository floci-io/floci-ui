import {describe, expect, test} from 'bun:test'
import {createCloudAdapterRegistry} from './cloudProxy'
import {isServiceType} from './cloud-spi/serviceCatalog'
import type {CloudProvider, CloudServiceAdapter, CloudServiceType, ResourceActionName} from './cloud-spi/types'

/**
 * Guards the schema-to-implementation contract for every registered adapter.
 *
 * A schema is a promise to the frontend: it decides which controls render and
 * which are greyed out. Three separate bugs came from breaking that promise —
 * networking advertised create/delete as available while the adapter threw,
 * serverless shipped an invoke panel against an adapter with no invoke, and the
 * Azure serverless adapter was advertised as available against a runtime that
 * answers 501. These tests make the contract mechanical instead of a convention.
 */

const CLOUDS: CloudProvider[] = ['aws', 'azure', 'gcp']

/** Adapter method that must exist for a capability to claim `available`. */
const METHOD_FOR_ACTION: Record<ResourceActionName, keyof CloudServiceAdapter> = {
    list: 'list',
    create: 'create',
    delete: 'delete',
    inspect: 'get',
    invoke: 'invoke',
    start: 'start',
    stop: 'stop',
    reboot: 'reboot',
    updateTags: 'updateTags',
}

const registry = createCloudAdapterRegistry()

function registeredAdapters(): Array<{cloud: CloudProvider; adapter: CloudServiceAdapter}> {
    return CLOUDS.flatMap((cloud) =>
        registry.servicesFor(cloud).map((service) => ({cloud, adapter: adapterFor(cloud, service)})),
    )
}

function adapterFor(cloud: CloudProvider, service: CloudServiceType): CloudServiceAdapter {
    const adapter = registry.get(cloud, service)
    if (!adapter) throw new Error(`expected an adapter for ${cloud}/${service}`)
    return adapter
}

describe('registered adapters honour their schema', () => {
    const adapters = registeredAdapters()

    test('at least one adapter is registered for every cloud', () => {
        for (const cloud of CLOUDS) {
            expect(adapters.filter((entry) => entry.cloud === cloud).length).toBeGreaterThan(0)
        }
    })

    for (const {cloud, adapter} of adapters) {
        const label = `${cloud}/${adapter.service}`

        test(`${label} schema identifies itself consistently`, () => {
            const schema = adapter.schema()
            expect(schema.cloud).toBe(adapter.cloud)
            expect(schema.service).toBe(adapter.service)
            expect(isServiceType(schema.service)).toBe(true)
            expect(schema.displayName.length).toBeGreaterThan(0)
        })

        test(`${label} implements every action it advertises`, () => {
            for (const action of adapter.schema().actions) {
                const method = METHOD_FOR_ACTION[action]
                expect(typeof adapter[method]).toBe('function')
            }
        })

        test(`${label} implements every capability it marks available`, () => {
            const capabilities = adapter.schema().capabilities?.resourceActions ?? []
            const claimed = capabilities.filter((capability) => capability.status === 'available')

            for (const capability of claimed) {
                const method = METHOD_FOR_ACTION[capability.name]
                expect(
                    typeof adapter[method],
                    `${label} advertises ${capability.name} as available but has no ${String(method)}()`,
                ).toBe('function')
            }
        })

        test(`${label} explains every capability it does not fully support`, () => {
            const capabilities = [
                ...(adapter.schema().capabilities?.resourceActions ?? []),
                ...(adapter.schema().capabilities?.objectActions ?? []),
            ]

            for (const capability of capabilities) {
                if (capability.status === 'available') continue
                expect(
                    capability.reason?.length ?? 0,
                    `${label} capability ${capability.name} is ${capability.status} with no reason`,
                ).toBeGreaterThan(0)
            }
        })

        test(`${label} declares object capabilities only when it can serve them`, () => {
            const objectActions = adapter.schema().capabilities?.objectActions ?? []
            if (objectActions.length === 0) return

            // An object-action block means the resource is a container of objects.
            expect(typeof adapter.listObjects).toBe('function')
        })

        test(`${label} columns resolve to a path`, () => {
            for (const column of adapter.schema().columns) {
                expect((column.path ?? column.name).length).toBeGreaterThan(0)
            }
        })
    }
})

describe('adapter capability advertisements match the runtime reality', () => {
    test('AWS serverless advertises invoke and implements it', () => {
        const adapter = adapterFor('aws', 'serverless')
        const invoke = adapter.schema().capabilities?.resourceActions?.find((c) => c.name === 'invoke')

        expect(invoke?.status).toBe('available')
        expect(typeof adapter.invoke).toBe('function')
    })

    test('AWS networking does not advertise create or delete as available', () => {
        const adapter = adapterFor('aws', 'networking')
        const actions = adapter.schema().capabilities?.resourceActions ?? []

        for (const name of ['create', 'delete'] as const) {
            const capability = actions.find((c) => c.name === name)
            expect(capability?.status).not.toBe('available')
            expect(capability?.reason).toBeTruthy()
        }
    })

    test('Azure serverless reports its runtime gap through descriptorOverride', () => {
        const override = adapterFor('azure', 'serverless').descriptorOverride?.()

        expect(override?.availability).toBe('coming_soon')
        expect(override?.reason).toContain('501')
    })
})
