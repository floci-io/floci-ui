import {afterEach, describe, expect, test} from 'bun:test'
import {RuntimeUnavailableError} from '../cloud-spi/errors'
import {probeFlociHealth} from './flociHealth'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4577'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function stubFetch(handler: () => Response) {
    const calls: string[] = []
    globalThis.fetch = (async (url: string | URL | Request) => {
        calls.push(String(url))
        return handler()
    }) as unknown as typeof fetch
    return calls
}

function probe(rejectClientErrors: boolean) {
    return probeFlociHealth({endpoint: ENDPOINT, path: '/_floci/health', label: 'Floci-AZ', rejectClientErrors})
}

describe('probeFlociHealth', () => {
    test('probes the health path on the endpoint', async () => {
        const calls = stubFetch(() => new Response('{"status":"UP"}', {status: 200}))
        await probe(true)
        expect(calls).toEqual([`${ENDPOINT}/_floci/health`])
    })

    test('counts a 503 that carries a health report as reachable', async () => {
        // Floci-AZ answers 503 with a body when one of its services reports a problem.
        stubFetch(() => new Response('{"status":"DOWN","services":{"sql":"problem"}}', {status: 503}))
        await expect(probe(true)).resolves.toBeUndefined()
    })

    test('reports a 503 without a health report, and other 5xx, as unavailable', async () => {
        for (const response of [
            () => new Response('', {status: 503}),
            () => new Response('Service Unavailable', {status: 503}),
            () => new Response('{"message":"no"}', {status: 503}),
            () => new Response('{"status":"DOWN"}', {status: 500}),
        ]) {
            stubFetch(response)
            await expect(probe(false)).rejects.toBeInstanceOf(RuntimeUnavailableError)
        }
    })

    test('reports a 4xx as unavailable only when asked', async () => {
        stubFetch(() => new Response('', {status: 404}))
        await expect(probe(true)).rejects.toThrow(`Floci-AZ at ${ENDPOINT} returned HTTP 404`)
        await expect(probe(false)).resolves.toBeUndefined()
    })

    test('reports a refused connection as unavailable, naming the endpoint', async () => {
        globalThis.fetch = (async () => {
            throw new Error('connection refused')
        }) as unknown as typeof fetch
        await expect(probe(false)).rejects.toThrow(`Cannot reach Floci-AZ at ${ENDPOINT}: connection refused`)
    })
})
