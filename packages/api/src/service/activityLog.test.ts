import {describe, expect, test} from 'bun:test'
import {ValidationError} from '../cloud-spi/errors'
import type {CloudProvider} from '../cloud-spi/types'
import {ACTIVITY_CAPACITY, ActivityLog, type ActivityDraft} from './activityLog'

let sequence = 0

function draft(overrides: Partial<ActivityDraft> = {}): ActivityDraft {
    return {
        cloud: 'aws' as CloudProvider,
        service: 'storage',
        operation: 'Create',
        resourceType: 'bucket',
        resourceName: `bucket-${sequence}`,
        status: 'success',
        source: 'Floci UI',
        httpMethod: 'POST',
        path: '/api/clouds/aws/services/storage/resources',
        statusCode: 201,
        detail: null,
        ...overrides,
    }
}

/** Timestamps in a fixed past second, spaced so ordering is unambiguous. */
function at(offsetSeconds: number): string {
    return new Date(Date.UTC(2026, 0, 1, 12, 0, offsetSeconds)).toISOString()
}

describe('activity log', () => {
    test('records newest first with its own id and timestamp', () => {
        const log = new ActivityLog()
        const first = log.record(draft({resourceName: 'first'}))
        const second = log.record(draft({resourceName: 'second'}))

        const page = log.query()
        expect(page.items.map((entry) => entry.resourceName)).toEqual(['second', 'first'])
        expect(first.id).not.toBe(second.id)
        expect(() => Date.parse(second.timestamp)).not.toThrow()
    })

    test('bounds retention to the capacity, dropping the oldest', () => {
        const log = new ActivityLog(3)
        for (let index = 0; index < 5; index++) log.record(draft({resourceName: `bucket-${index}`}))

        const page = log.query({limit: ACTIVITY_CAPACITY})
        expect(page.items.map((entry) => entry.resourceName)).toEqual(['bucket-4', 'bucket-3', 'bucket-2'])
        expect(page.nextCursor).toBeNull()
    })

    test('filters by cloud, service, operation, status and resource type', () => {
        const log = new ActivityLog()
        log.record(draft({cloud: 'aws', service: 'storage', operation: 'Create', resourceType: 'bucket'}))
        log.record(draft({cloud: 'azure', service: 'storage', operation: 'Delete', resourceType: 'bucket'}))
        log.record(draft({cloud: 'aws', service: 'compute', operation: 'Start', resourceType: 'instance', status: 'failed', detail: 'boom'}))

        expect(log.query({cloud: 'aws'}).items).toHaveLength(2)
        expect(log.query({service: 'compute'}).items.map((e) => e.operation)).toEqual(['Start'])
        expect(log.query({operation: 'Delete'}).items.map((e) => e.cloud)).toEqual(['azure'])
        expect(log.query({status: 'failed'}).items.map((e) => e.detail)).toEqual(['boom'])
        expect(log.query({resourceType: 'instance'}).items.map((e) => e.service)).toEqual(['compute'])
    })

    test('searches resource names, service names and paths', () => {
        const log = new ActivityLog()
        log.record(draft({resourceName: 'orders-bucket', path: '/api/clouds/aws/services/storage/resources/orders-bucket'}))
        log.record(draft({service: 'compute', resourceName: 'i-0abc', path: '/api/clouds/aws/services/compute/resources/i-0abc'}))

        expect(log.query({search: 'orders'}).items.map((e) => e.resourceName)).toEqual(['orders-bucket'])
        expect(log.query({search: 'I-0ABC'}).items.map((e) => e.resourceName)).toEqual(['i-0abc'])
        expect(log.query({search: 'compute'}).items).toHaveLength(1)
        expect(log.query({search: 'nothing-here'}).items).toHaveLength(0)
    })

    test('range-filters by timestamp, inclusive', () => {
        const log = new ActivityLog()
        log.record(draft({resourceName: 'old', timestamp: at(0)}))
        log.record(draft({resourceName: 'in-range', timestamp: at(60)}))
        log.record(draft({resourceName: 'new', timestamp: at(120)}))

        const from = Date.parse(at(30))
        const to = Date.parse(at(90))
        expect(log.query({from, to}).items.map((e) => e.resourceName)).toEqual(['in-range'])
        expect(log.query({from: Date.parse(at(0))}).items.map((e) => e.resourceName)).toEqual(['new', 'in-range', 'old'])
        expect(log.query({to: Date.parse(at(120))}).items).toHaveLength(3)
    })

    test('paginates newest-first without overlap and stops at the end', () => {
        const log = new ActivityLog()
        for (let index = 0; index < 5; index++) log.record(draft({resourceName: `bucket-${index}`}))
        const expected = ['bucket-4', 'bucket-3', 'bucket-2', 'bucket-1', 'bucket-0']

        const page1 = log.query({limit: 2})
        expect(page1.items.map((e) => e.resourceName)).toEqual(expected.slice(0, 2))
        expect(page1.nextCursor).not.toBeNull()

        const page2 = log.query({limit: 2, cursor: page1.nextCursor!})
        expect(page2.items.map((e) => e.resourceName)).toEqual(expected.slice(2, 4))

        const page3 = log.query({limit: 2, cursor: page2.nextCursor!})
        expect(page3.items.map((e) => e.resourceName)).toEqual(expected.slice(4))
        expect(page3.nextCursor).toBeNull()
    })

    test('resumes after the cursor entry even when newer entries arrive', () => {
        const log = new ActivityLog()
        log.record(draft({resourceName: 'first'}))
        log.record(draft({resourceName: 'second'}))
        const page1 = log.query({limit: 1})
        expect(page1.items.map((e) => e.resourceName)).toEqual(['second'])

        log.record(draft({resourceName: 'third'}))

        const page2 = log.query({limit: 10, cursor: page1.nextCursor!})
        expect(page2.items.map((e) => e.resourceName)).toEqual(['first'])
    })

    test('rejects a cursor that is not one of ours', () => {
        const log = new ActivityLog()
        log.record(draft())
        expect(() => log.query({cursor: 'not-a-cursor'})).toThrow(ValidationError)
    })

    test('offers facet values the other filters already admit', () => {
        const log = new ActivityLog()
        log.record(draft({cloud: 'aws', service: 'storage', operation: 'Create', resourceType: 'bucket'}))
        log.record(draft({cloud: 'aws', service: 'compute', operation: 'Start', resourceType: 'instance'}))
        log.record(draft({cloud: 'azure', service: 'compute', operation: 'Delete', resourceType: 'instance'}))

        const all = log.query()
        expect(all.facets.clouds).toEqual(['aws', 'azure'])
        expect(all.facets.services).toEqual(['compute', 'storage'])
        expect(all.facets.operations).toEqual(['Create', 'Delete', 'Start'])
        expect(all.facets.resourceTypes).toEqual(['bucket', 'instance'])
        expect(all.facets.statuses).toEqual(['success'])

        // A facet never offers a value that would contradict its own filter.
        const awsOnly = log.query({cloud: 'aws'})
        expect(awsOnly.facets.clouds).toEqual(['aws', 'azure'])
        expect(awsOnly.facets.services).toEqual(['compute', 'storage'])

        const computeOnly = log.query({service: 'compute'})
        expect(computeOnly.facets.operations).toEqual(['Delete', 'Start'])
        // Each facet excludes its own filter: the offer stays valid either way.
        expect(computeOnly.facets.services).toEqual(['compute', 'storage'])
    })
})
