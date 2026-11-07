import {describe, expect, test} from 'bun:test'
import {
    BatchGetTracesCommand,
    GetSamplingRulesCommand,
    GetTraceGraphCommand,
    GetTraceSummariesCommand,
    type GetTraceSummariesCommandInput,
    type XRayClient,
} from '@aws-sdk/client-xray'
import {AwsXrayAdapter} from './AwsXrayAdapter'
import {NotSupportedError, ValidationError} from '../cloud-spi/errors'
import type {CreateResourceInput} from '../cloud-spi/types'

type SendHandler = (command: unknown) => Promise<unknown>

function createAdapter(handler: SendHandler = async () => ({})): AwsXrayAdapter {
    return new AwsXrayAdapter({send: handler} as unknown as XRayClient, 'us-east-1')
}

const SUMMARY = {
    Id: '1-5f3b8a0e-3c9d4d8e9b7a2c1d4e5f6a7b',
    Duration: 0.25,
    StartTime: new Date('2026-11-07T08:00:00Z'),
    HasError: true,
    HasFault: false,
    HasThrottle: false,
    Http: {HttpStatus: 500},
    EntryPoint: {Name: 'orders-api'},
    ServiceIds: [{Name: 'orders-api'}, {Name: 'payments'}],
}

describe('AwsXrayAdapter', () => {
    test('advertises traces as a read-only service of the observability group', () => {
        const schema = createAdapter().schema()

        expect(schema).toMatchObject({cloud: 'aws', service: 'xray', displayName: 'X-Ray'})
        expect(schema.actions).toEqual(['list', 'inspect'])
        expect(schema.filters.map((filter) => filter.name)).toEqual(['search'])
        expect(schema.notice).toContain('last hour')
        expect(createAdapter().descriptorOverride()).toEqual({displayName: 'X-Ray'})
    })

    test('lists the default window as the last hour', async () => {
        let sent: GetTraceSummariesCommand | null = null
        const adapter = createAdapter(async (command) => {
            sent = command as GetTraceSummariesCommand
            return {TraceSummaries: [SUMMARY]}
        })

        const resources = await adapter.list()

        expect(sent).toBeInstanceOf(GetTraceSummariesCommand)
        const input = (sent as unknown as GetTraceSummariesCommand).input
        expect((input.EndTime as Date).getTime() - (input.StartTime as Date).getTime()).toBe(3_600_000)
        expect(input.FilterExpression).toBeUndefined()
        expect(resources).toHaveLength(1)
        expect(resources[0]).toMatchObject({
            id: SUMMARY.Id,
            name: SUMMARY.Id,
            cloud: 'aws',
            service: 'xray',
            type: 'trace',
            status: 'error',
            region: 'us-east-1',
            createdAt: '2026-11-07T08:00:00.000Z',
        })
        expect(resources[0].metadata).toMatchObject({
            duration: '250 ms',
            services: ['orders-api', 'payments'],
            httpStatus: 500,
            entryPoint: 'orders-api',
        })
    })

    test('honours the window and the expression the caller typed', async () => {
        const inputs: GetTraceSummariesCommandInput[] = []
        const adapter = createAdapter(async (command) => {
            inputs.push((command as GetTraceSummariesCommand).input)
            return {TraceSummaries: []}
        })

        await adapter.list({filters: {window: '1h', expression: 'service("orders-api") AND hasError'}})

        expect((inputs[0].EndTime as Date).getTime() - (inputs[0].StartTime as Date).getTime()).toBe(3_600_000)
        expect(inputs[0].FilterExpression).toBe('service("orders-api") AND hasError')
    })

    test('filters by trace id and by service name', async () => {
        const adapter = createAdapter(async () => ({
            TraceSummaries: [SUMMARY, {...SUMMARY, Id: '1-11111111-222222222222222222222222', ServiceIds: [{Name: 'search'}]}],
        }))

        expect(await adapter.list({search: '1111'})).toHaveLength(1)
        expect(await adapter.list({search: 'payments'})).toHaveLength(1)
        expect(await adapter.list({search: 'nothing'})).toHaveLength(0)
    })

    test('refuses a window it does not serve', async () => {
        const adapter = createAdapter()

        await expect(adapter.list({filters: {window: '7d'}})).rejects.toBeInstanceOf(ValidationError)
    })

    test('follows the continuation token so later traces are not lost', async () => {
        const inputs: GetTraceSummariesCommandInput[] = []
        const adapter = createAdapter(async (command) => {
            const input = (command as GetTraceSummariesCommand).input
            inputs.push(input)
            if (!input.NextToken) {
                return {TraceSummaries: [SUMMARY], NextToken: 'page-2'}
            }
            return {TraceSummaries: [{...SUMMARY, Id: '1-11111111-222222222222222222222222'}]}
        })

        const resources = await adapter.list()

        expect(inputs).toHaveLength(2)
        expect(inputs[1].NextToken).toBe('page-2')
        expect(inputs[1].StartTime).toEqual(inputs[0].StartTime)
        expect(inputs[1].EndTime).toEqual(inputs[0].EndTime)
        expect(resources.map((resource) => resource.id)).toEqual([
            SUMMARY.Id,
            '1-11111111-222222222222222222222222',
        ])
    })

    test('searches the pages it collected, not just the first one', async () => {
        const adapter = createAdapter(async (command) => {
            const input = (command as GetTraceSummariesCommand).input
            if (!input.NextToken) {
                return {TraceSummaries: [SUMMARY], NextToken: 'page-2'}
            }
            return {TraceSummaries: [{...SUMMARY, Id: '1-11111111-222222222222222222222222', ServiceIds: [{Name: 'search'}]}]}
        })

        expect(await adapter.list({search: 'search'})).toHaveLength(1)
    })

    test('reads a trace with its segments and its service graph', async () => {
        const adapter = createAdapter(async (command) => {
            if (command instanceof BatchGetTracesCommand) {
                expect(command.input.TraceIds).toEqual(['1-5f3b8a0e-3c9d4d8e9b7a2c1d4e5f6a7b'])
                return {
                    Traces: [{
                        Id: '1-5f3b8a0e-3c9d4d8e9b7a2c1d4e5f6a7b',
                        Duration: 1.5,
                        Segments: [{
                            Id: '0f1e2d3c4b5a6978',
                            Document: JSON.stringify({trace_id: '1-5f3b8a0e-3c9d4d8e9b7a2c1d4e5f6a7b', id: '0f1e2d3c4b5a6978', name: 'orders-api', start_time: 1794038400, end_time: 1794038401.5}),
                        }],
                    }],
                }
            }
            expect(command).toBeInstanceOf(GetTraceGraphCommand)
            return {
                Services: [
                    {
                        ReferenceId: 42,
                        Name: 'orders-api',
                        Type: 'client',
                        State: 'ok',
                        SummaryStatistics: {TotalCount: 1, TotalResponseTime: 1.5},
                        Edges: [{ReferenceId: 7}],
                    },
                    {
                        ReferenceId: 7,
                        Name: 'payments',
                        State: 'ok',
                        SummaryStatistics: {TotalCount: 1, TotalResponseTime: 0.7},
                        Edges: [],
                    },
                ],
            }
        })

        const trace = await adapter.get('1-5f3b8a0e-3c9d4d8e9b7a2c1d4e5f6a7b')

        expect(trace).not.toBeNull()
        expect(trace?.metadata).toMatchObject({durationMs: 1500, segmentCount: 1})
        expect(trace?.createdAt).toBe(new Date(1794038400 * 1000).toISOString())
        const segments = trace?.metadata.segments as Array<Record<string, unknown>>
        expect(segments[0]).toMatchObject({name: 'orders-api', id: '0f1e2d3c4b5a6978'})
        type GraphService = {referenceId: number | null; name: string; count: number; averageMs: number | null; edges: number[]}
        const services = trace?.metadata.services as GraphService[]
        expect(services).toHaveLength(2)
        expect(services[0]).toMatchObject({referenceId: 42, name: 'orders-api', type: 'client', count: 1, averageMs: 1500, edges: [7]})
        expect(services[1]).toMatchObject({referenceId: 7, name: 'payments', count: 1, averageMs: 700})
        // An edge names a service by its reference, so that reference has to be on the service.
        const referenceIds = services.map((service) => service.referenceId)
        expect(referenceIds).toContain(services[0].edges[0])
    })

    test('starts a trace at its earliest segment, whatever order the batch arrives in', async () => {
        const adapter = createAdapter(async (command) => {
            if (command instanceof BatchGetTracesCommand) {
                return {
                    Traces: [{
                        Id: '1-5f3b8a0e-3c9d4d8e9b7a2c1d4e5f6a7b',
                        Duration: 1.5,
                        Segments: [
                            {Id: 'child', Document: JSON.stringify({id: 'child', start_time: 1794038400.4, end_time: 1794038400.9})},
                            {Id: 'root', Document: JSON.stringify({id: 'root', start_time: 1794038400, end_time: 1794038401.5})},
                        ],
                    }],
                }
            }
            return {Services: []}
        })

        const trace = await adapter.get('1-5f3b8a0e-3c9d4d8e9b7a2c1d4e5f6a7b')

        expect(trace?.createdAt).toBe(new Date(1794038400 * 1000).toISOString())
    })

    test('answers nothing for a trace the store does not have', async () => {
        const adapter = createAdapter(async () => ({Traces: []}))

        expect(await adapter.get('1-00000000-000000000000000000000000')).toBeNull()
    })

    test('refuses to create or delete a trace', async () => {
        const adapter = createAdapter()

        await expect(adapter.create({} as CreateResourceInput)).rejects.toBeInstanceOf(NotSupportedError)
        await expect(adapter.delete('1-5f3b8a0e-3c9d4d8e9b7a2c1d4e5f6a7b')).rejects.toBeInstanceOf(NotSupportedError)
    })

    test('probes the service with the sampling rules', async () => {
        let sent: unknown = null
        const adapter = createAdapter(async (command) => {
            sent = command
            return {SamplingRuleRecords: []}
        })

        await adapter.health()

        expect(sent).toBeInstanceOf(GetSamplingRulesCommand)
    })
})
