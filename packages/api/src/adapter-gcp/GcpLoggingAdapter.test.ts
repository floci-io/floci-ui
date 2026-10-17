import {afterEach, describe, expect, test} from 'bun:test'
import {GcpRestRuntimeClient} from '../gcp'
import {GcpLoggingAdapter} from './GcpLoggingAdapter'

const originalFetch = globalThis.fetch
const endpoint = 'http://localhost:4588'
const logName = 'projects/floci-local/logs/app%2Fworker'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): GcpLoggingAdapter {
    return new GcpLoggingAdapter(new GcpRestRuntimeClient(endpoint, 'floci-local', 'us-central1'))
}

describe('GcpLoggingAdapter', () => {
    test('lists project logs and decodes their display names', async () => {
        const paths: string[] = []
        globalThis.fetch = (async (url: RequestInfo | URL) => {
            paths.push(String(url))
            return new Response(JSON.stringify({logNames: [logName]}))
        }) as unknown as typeof fetch

        expect((await adapter().list()).map(({id, name}) => ({id, name}))).toEqual([
            {id: logName, name: 'app/worker'},
        ])
        expect(paths).toEqual([`${endpoint}/v2/projects/floci-local/logs`])
        expect(await adapter().list({search: 'worker'})).toHaveLength(1)
        expect(await adapter().list({search: 'other'})).toEqual([])
    })

    test('returns an empty state for a project without logs', async () => {
        globalThis.fetch = (async () => new Response('{}')) as unknown as typeof fetch
        await expect(adapter().list()).resolves.toEqual([])
        await expect(adapter().get(logName)).resolves.toBeNull()
    })

    test('finds and searches logs returned on later pages', async () => {
        const laterLog = 'projects/floci-local/logs/audit'
        const paths: string[] = []
        globalThis.fetch = (async (url: RequestInfo | URL) => {
            paths.push(String(url))
            const page = new URL(String(url)).searchParams.get('pageToken')
            return new Response(JSON.stringify(page === 'page-2'
                ? {logNames: [laterLog]}
                : {logNames: [logName], nextPageToken: 'page-2'}))
        }) as unknown as typeof fetch

        expect((await adapter().list({search: 'audit'})).map((log) => log.id)).toEqual([laterLog])
        expect((await adapter().get(laterLog))?.name).toBe('audit')
        expect(paths).toEqual([
            `${endpoint}/v2/projects/floci-local/logs`,
            `${endpoint}/v2/projects/floci-local/logs?pageToken=page-2`,
            `${endpoint}/v2/projects/floci-local/logs`,
            `${endpoint}/v2/projects/floci-local/logs?pageToken=page-2`,
        ])
    })

    test('reads entries with the project and exact log filter, preserving pagination', async () => {
        const calls: Array<{url: string; body: Record<string, unknown>}> = []
        globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
            calls.push({url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown>})
            return new Response(JSON.stringify({
                entries: [{insertId: 'event-1', timestamp: '2026-10-17T01:02:03Z', severity: 'ERROR', textPayload: 'failed'}],
                nextPageToken: 'next-page',
            }))
        }) as unknown as typeof fetch

        const page = await adapter().items.listItems(logName, {limit: 20, cursor: 'first-page'})
        expect(calls).toEqual([{url: `${endpoint}/v2/entries:list`, body: {
            resourceNames: ['projects/floci-local'],
            filter: `logName="${logName}"`,
            orderBy: 'timestamp desc',
            pageSize: 20,
            pageToken: 'first-page',
        }}])
        expect(page.nextCursor).toBe('next-page')
        expect(page.items[0]).toMatchObject({
            id: 'event-1',
            timestamp: '2026-10-17T01:02:03Z',
            body: {message: 'failed', severity: 'ERROR'},
        })
    })

    test('filters by severity and time, and maps structured payloads', async () => {
        let body: Record<string, unknown> = {}
        globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
            body = JSON.parse(String(init?.body)) as Record<string, unknown>
            return new Response(JSON.stringify({entries: [{insertId: 'json-1', jsonPayload: {requestId: 7}, severity: 'WARNING'}]}))
        }) as unknown as typeof fetch

        const query = 'severity>=WARNING AND timestamp>="2026-10-17T00:00:00.000Z"'
        const page = await adapter().items.queryItems!(logName, query)
        expect(body.filter).toBe(`logName="${logName}" AND ${query}`)
        expect(page.nextCursor).toBeNull()
        expect(page.items[0].body).toEqual({message: '{"requestId":7}', severity: 'WARNING', jsonPayload: {requestId: 7}})
    })

    test('rejects a cross-project log or unsupported filter clause', async () => {
        await expect(adapter().items.listItems('projects/other/logs/app')).rejects.toThrow('configured GCP project')
        expect(() => adapter().items.queryItems!(logName, 'logName="projects/other/logs/app"')).toThrow('Only severity')
    })
})
