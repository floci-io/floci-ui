import {afterEach, describe, expect, test} from 'bun:test'
import {GcpMonitoringAdapter} from './GcpMonitoringAdapter'
import {GcpRestRuntimeClient} from '../gcp'
import {NotFoundError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4588'
const DESCRIPTORS_PATH = '/v3/projects/floci-local/metricDescriptors'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): GcpMonitoringAdapter {
    return new GcpMonitoringAdapter(new GcpRestRuntimeClient(ENDPOINT, 'floci-local', 'us-central1'))
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status})
}

function descriptor(type: string, overrides: Record<string, unknown> = {}) {
    return {
        name: `projects/floci-local/metricDescriptors/${type}`,
        type,
        metricKind: 'GAUGE',
        valueType: 'DOUBLE',
        unit: '1',
        displayName: 'Demo',
        description: 'demo metric',
        labels: [{key: 'env'}],
        ...overrides,
    }
}

interface Sent {
    method: string
    url: string
    body?: Record<string, unknown>
}

function record(respond: (sent: Sent) => Response): Sent[] {
    const calls: Sent[] = []
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
        const sent = {
            method: init?.method ?? 'GET',
            url: String(input).replace(ENDPOINT, ''),
            body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
        }
        calls.push(sent)
        return respond(sent)
    }) as unknown as typeof fetch
    return calls
}

const NOW = '2026-11-12T15:04:59Z'

function series(value: Record<string, unknown>, endTime = NOW, labels: Record<string, string> = {env: 'dev'}) {
    return {
        metric: {type: 'custom.googleapis.com/demo', labels},
        resource: {type: 'global'},
        points: [{interval: {startTime: endTime, endTime}, value}],
    }
}

describe('GcpMonitoringAdapter list and get', () => {
    test('an empty project answers {} and lists nothing', async () => {
        record(() => json({}))
        expect(await adapter().list()).toEqual([])
    })

    test('maps the kind, value type, unit and labels of a descriptor', async () => {
        record(() => json({metricDescriptors: [descriptor('custom.googleapis.com/demo')]}))
        const [resource] = await adapter().list()

        expect(resource.id).toBe('custom.googleapis.com/demo')
        expect(resource.type).toBe('metric-descriptor')
        expect(resource.metadata.metricKind).toBe('GAUGE')
        expect(resource.metadata.valueType).toBe('DOUBLE')
        expect(resource.metadata.unit).toBe('1')
        expect(resource.metadata.labels).toEqual([{key: 'env'}])
    })

    test('follows nextPageToken across pages', async () => {
        const calls = record((sent) =>
            sent.url.includes('pageToken=p2')
                ? json({metricDescriptors: [descriptor('custom.googleapis.com/b')]})
                : json({metricDescriptors: [descriptor('custom.googleapis.com/a')], nextPageToken: 'p2'}),
        )
        const resources = await adapter().list()

        expect(resources.map((resource) => resource.id)).toEqual(['custom.googleapis.com/a', 'custom.googleapis.com/b'])
        expect(calls[1].url).toBe(`${DESCRIPTORS_PATH}?pageToken=p2`)
    })

    test('refuses a partial list when the runtime never stops paging', async () => {
        record(() => json({metricDescriptors: [descriptor('custom.googleapis.com/a')], nextPageToken: 'again'}))
        await expect(adapter().list()).rejects.toThrow('refusing a partial list')
    })

    test('filters by metric type', async () => {
        record(() => json({metricDescriptors: [descriptor('custom.googleapis.com/alpha'), descriptor('custom.googleapis.com/beta')]}))
        expect((await adapter().list({search: 'BET'})).map((resource) => resource.id)).toEqual(['custom.googleapis.com/beta'])
    })

    test('inspect keeps the slash of the type and carries the latest points, newest first', async () => {
        const calls = record((sent) =>
            sent.url.startsWith(`${DESCRIPTORS_PATH}/`)
                ? json(descriptor('custom.googleapis.com/orders/processed'))
                : json({
                      timeSeries: [
                          series({doubleValue: 1.5}, '2026-11-12T15:00:00Z'),
                          series({int64Value: '7'}, '2026-11-12T15:04:00Z', {env: 'prod'}),
                      ],
                  }),
        )
        const resource = await adapter().get('custom.googleapis.com/orders/processed')

        expect(calls[0].url).toBe(`${DESCRIPTORS_PATH}/custom.googleapis.com/orders/processed`)
        expect(resource?.metadata.latestPoints).toEqual([
            {time: '2026-11-12T15:04:00Z', value: 7, labels: {env: 'prod'}, resourceType: 'global'},
            {time: '2026-11-12T15:00:00Z', value: 1.5, labels: {env: 'dev'}, resourceType: 'global'},
        ])
    })

    test('follows nextPageToken across time series pages before choosing the newest points', async () => {
        const calls = record((sent) => {
            if (!sent.url.includes('timeSeries')) return json(descriptor('custom.googleapis.com/demo'))
            return sent.url.includes('pageToken=p2')
                ? json({timeSeries: [series({int64Value: '9'}, '2026-11-12T15:09:00Z')]})
                : json({timeSeries: [series({int64Value: '1'}, '2026-11-12T15:01:00Z')], nextPageToken: 'p2'})
        })
        const resource = await adapter().get('custom.googleapis.com/demo')

        expect((resource?.metadata.latestPoints as {value: unknown}[]).map((point) => point.value)).toEqual([9, 1])
        expect(calls).toHaveLength(3)
    })

    test('refuses a partial point read when the runtime never stops paging', async () => {
        record((sent) =>
            sent.url.includes('timeSeries')
                ? json({timeSeries: [series({int64Value: '1'}, '2026-11-12T15:01:00Z')], nextPageToken: 'again'})
                : json(descriptor('custom.googleapis.com/demo')),
        )
        await expect(adapter().get('custom.googleapis.com/demo')).rejects.toThrow('refusing a partial read')
    })

    test('keeps an int64 beyond the safe integer range as the string the runtime sent', async () => {
        record((sent) =>
            sent.url.includes('timeSeries')
                ? json({timeSeries: [series({int64Value: '9007199254740993'}, '2026-11-12T15:01:00Z')]})
                : json(descriptor('custom.googleapis.com/demo')),
        )
        const resource = await adapter().get('custom.googleapis.com/demo')
        expect((resource?.metadata.latestPoints as {value: unknown}[])[0].value).toBe('9007199254740993')
    })

    test('the point read names one metric and both ends of the interval', async () => {
        const calls = record((sent) => (sent.url.includes('timeSeries') ? json({}) : json(descriptor('custom.googleapis.com/demo'))))
        const resource = await adapter().get('custom.googleapis.com/demo')
        const query = new URL(`${ENDPOINT}${calls[1].url}`).searchParams

        expect(resource?.metadata.latestPoints).toEqual([])
        expect(query.get('filter')).toBe('metric.type="custom.googleapis.com/demo"')
        expect(query.get('interval.startTime')).toBeTruthy()
        expect(query.get('interval.endTime')).toBeTruthy()
        expect(query.get('view')).toBe('FULL')
    })

    test('reads bool, string and distribution values as they come', async () => {
        record((sent) =>
            sent.url.includes('timeSeries')
                ? json({timeSeries: [series({boolValue: true}, '2026-11-12T15:03:00Z'), series({stringValue: 'up'}, '2026-11-12T15:02:00Z'), series({distributionValue: {count: '2'}}, '2026-11-12T15:01:00Z')]})
                : json(descriptor('custom.googleapis.com/demo')),
        )
        const resource = await adapter().get('custom.googleapis.com/demo')
        expect((resource?.metadata.latestPoints as {value: unknown}[]).map((point) => point.value)).toEqual([true, 'up', {count: '2'}])
    })

    test('a missing descriptor is null and its points are never read', async () => {
        const calls = record(() => json({error: {code: 404, message: 'not found', status: 'NOT_FOUND'}}, 404))
        expect(await adapter().get('custom.googleapis.com/ghost')).toBeNull()
        expect(calls).toHaveLength(1)
    })

    test('an id that is not a metric type never reaches the runtime', async () => {
        const calls = record(() => json({}))
        await expect(adapter().get('../operations')).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().get('custom.googleapis.com/../x')).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().get('nodomain')).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toHaveLength(0)
    })
})

describe('GcpMonitoringAdapter create and delete', () => {
    test('creates a custom descriptor from the form values', async () => {
        const calls = record(() => json(descriptor('custom.googleapis.com/demo')))
        const created = await adapter().create({
            values: {
                name: ' custom.googleapis.com/demo ',
                metricKind: 'GAUGE',
                valueType: 'DOUBLE',
                unit: '1',
                displayName: 'Demo',
                description: '',
            },
        })

        expect(calls).toHaveLength(1)
        expect(calls[0].method).toBe('POST')
        expect(calls[0].url).toBe(DESCRIPTORS_PATH)
        expect(calls[0].body).toEqual({
            type: 'custom.googleapis.com/demo',
            metricKind: 'GAUGE',
            valueType: 'DOUBLE',
            unit: '1',
            displayName: 'Demo',
        })
        expect(created.id).toBe('custom.googleapis.com/demo')
    })

    test('rejects a bad type, kind, value type and kind and value combination, and sends nothing', async () => {
        const calls = record(() => json({}))
        const base = {name: 'custom.googleapis.com/demo', metricKind: 'GAUGE', valueType: 'DOUBLE'}
        const rejects = (values: Record<string, unknown>) =>
            expect(adapter().create({values: {...base, ...values}})).rejects.toBeInstanceOf(ValidationError)

        await rejects({name: ''})
        await rejects({name: 'demo'})
        await rejects({name: 'compute.googleapis.com/instance/cpu'})
        await rejects({name: 'custom.googleapis.com/'})
        await rejects({name: 'custom.googleapis.com/../x'})
        await rejects({metricKind: 'RATE'})
        await rejects({valueType: 'MONEY'})
        await rejects({metricKind: 'DELTA', valueType: 'STRING'})
        await rejects({metricKind: 'CUMULATIVE', valueType: 'BOOL'})
        expect(calls).toHaveLength(0)
    })

    test('a runtime refusal reaches the caller as a validation error', async () => {
        record(() => json({error: {code: 400, message: 'Metric type must be of the form', status: 'INVALID_ARGUMENT'}}, 400))
        await expect(
            adapter().create({values: {name: 'custom.googleapis.com/demo', metricKind: 'GAUGE', valueType: 'DOUBLE'}}),
        ).rejects.toBeInstanceOf(ValidationError)
    })

    test('deletes by metric type, keeping the slash', async () => {
        const calls = record(() => json({}))
        await adapter().delete('custom.googleapis.com/orders/processed')

        expect(calls[0].method).toBe('DELETE')
        expect(calls[0].url).toBe(`${DESCRIPTORS_PATH}/custom.googleapis.com/orders/processed`)
    })

    test('deleting a missing descriptor is not found', async () => {
        record(() => json({error: {code: 404, message: 'not found', status: 'NOT_FOUND'}}, 404))
        await expect(adapter().delete('custom.googleapis.com/ghost')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('deleting a built in metric surfaces the runtime refusal', async () => {
        record(() => json({error: {code: 400, message: 'Only user-created custom metrics can be deleted', status: 'INVALID_ARGUMENT'}}, 400))
        await expect(adapter().delete('compute.googleapis.com/instance/cpu')).rejects.toThrow('Only user-created custom metrics')
    })
})
