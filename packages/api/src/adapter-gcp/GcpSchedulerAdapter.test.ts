import {afterEach, describe, expect, test} from 'bun:test'
import {GcpSchedulerAdapter} from './GcpSchedulerAdapter'
import {GcpRestRuntimeClient} from '../gcp'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4588'
const JOBS_PATH = '/v1/projects/floci-local/locations/us-central1/jobs'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): GcpSchedulerAdapter {
    return new GcpSchedulerAdapter(new GcpRestRuntimeClient(ENDPOINT, 'floci-local', 'us-central1'))
}

function sampleJob(name: string) {
    return {
        name: `projects/floci-local/locations/us-central1/jobs/${name}`,
        description: 'Daily database backup',
        schedule: '0 2 * * *',
        timeZone: 'UTC',
        state: 'ENABLED',
        httpTarget: {
            uri: 'https://api.floci-local.net/backup',
            httpMethod: 'POST',
        },
        userUpdateTime: '2026-06-22T05:29:13Z',
    }
}

describe('GcpSchedulerAdapter', () => {
    test('lists jobs and maps the resource shape', async () => {
        globalThis.fetch = (async () => new Response(JSON.stringify({
            jobs: [sampleJob('db-backup')],
        }), {status: 200})) as unknown as typeof fetch

        const resources = await adapter().list()
        expect(resources).toEqual([
            {
                id: 'db-backup',
                name: 'db-backup',
                cloud: 'gcp',
                service: 'scheduler',
                type: 'scheduler-job',
                region: 'us-central1',
                createdAt: '2026-06-22T05:29:13Z',
                status: 'ENABLED',
                metadata: {
                    provider: 'gcp',
                    resourceName: 'projects/floci-local/locations/us-central1/jobs/db-backup',
                    schedule: '0 2 * * *',
                    timeZone: 'UTC',
                    target: 'https://api.floci-local.net/backup',
                    httpMethod: 'POST',
                    description: 'Daily database backup',
                    scheduleTime: undefined,
                    lastAttemptTime: undefined,
                    userUpdateTime: '2026-06-22T05:29:13Z',
                },
            },
        ])
    })

    test('normalizes an empty list payload', async () => {
        globalThis.fetch = (async () => new Response('{}', {status: 200})) as unknown as typeof fetch
        await expect(adapter().list()).resolves.toEqual([])
    })

    test('follows nextPageToken pagination and collects all jobs', async () => {
        const calls: string[] = []
        globalThis.fetch = (async (url: RequestInfo | URL) => {
            const urlStr = String(url)
            calls.push(urlStr)
            if (urlStr.includes('pageToken=token-page-2')) {
                return new Response(JSON.stringify({
                    jobs: [sampleJob('job-page-2')],
                }), {status: 200})
            }
            return new Response(JSON.stringify({
                jobs: [sampleJob('job-page-1')],
                nextPageToken: 'token-page-2',
            }), {status: 200})
        }) as unknown as typeof fetch

        const resources = await adapter().list()
        expect(calls).toEqual([
            `${ENDPOINT}${JOBS_PATH}`,
            `${ENDPOINT}${JOBS_PATH}?pageToken=token-page-2`,
        ])
        expect(resources.map((r) => r.name)).toEqual(['job-page-1', 'job-page-2'])
    })

    test('filters across paginated results by search term', async () => {
        globalThis.fetch = (async (url: RequestInfo | URL) => {
            const urlStr = String(url)
            if (urlStr.includes('pageToken=page2')) {
                return new Response(JSON.stringify({
                    jobs: [sampleJob('nightly-sync')],
                }), {status: 200})
            }
            return new Response(JSON.stringify({
                jobs: [sampleJob('hourly-cleanup')],
                nextPageToken: 'page2',
            }), {status: 200})
        }) as unknown as typeof fetch

        const resources = await adapter().list({search: 'sync'})
        expect(resources.map((r) => r.name)).toEqual(['nightly-sync'])
    })

    test('get returns null when the job is not found', async () => {
        globalThis.fetch = (async () => new Response('Not Found', {status: 404})) as unknown as typeof fetch
        await expect(adapter().get('nonexistent')).resolves.toBeNull()
    })

    test('create posts job payload and returns mapped resource', async () => {
        const calls: Array<{url: string; init: RequestInit}> = []
        globalThis.fetch = (async (url: RequestInfo | URL, init: RequestInit) => {
            calls.push({url: String(url), init})
            return new Response(JSON.stringify(sampleJob('db-backup')), {status: 200})
        }) as unknown as typeof fetch

        const resource = await adapter().create({
            values: {
                jobName: 'db-backup',
                schedule: '0 2 * * *',
                timeZone: 'UTC',
                targetUri: 'https://api.floci-local.net/backup',
                httpMethod: 'POST',
                description: 'Daily database backup',
            },
        })

        expect(calls).toHaveLength(1)
        expect(calls[0].url).toBe(`${ENDPOINT}${JOBS_PATH}`)
        expect(calls[0].init.method).toBe('POST')
        expect(JSON.parse(String(calls[0].init.body))).toEqual({
            name: 'projects/floci-local/locations/us-central1/jobs/db-backup',
            description: 'Daily database backup',
            schedule: '0 2 * * *',
            timeZone: 'UTC',
            httpTarget: {
                uri: 'https://api.floci-local.net/backup',
                httpMethod: 'POST',
            },
        })
        expect(resource.id).toBe('db-backup')
        expect(resource.status).toBe('ENABLED')
        expect(resource.metadata.schedule).toBe('0 2 * * *')
    })

    test('create rejects when required fields are missing', async () => {
        await expect(adapter().create({values: {jobName: 'test'}})).rejects.toThrow('schedule is required')
    })

    test('delete issues a DELETE against the job path', async () => {
        const calls: Array<{url: string; method?: string}> = []
        globalThis.fetch = (async (url: RequestInfo | URL, init: RequestInit) => {
            calls.push({url: String(url), method: init.method})
            return new Response(JSON.stringify({}), {status: 200})
        }) as unknown as typeof fetch

        await adapter().delete('db-backup')
        expect(calls[0].url).toBe(`${ENDPOINT}${JOBS_PATH}/db-backup`)
        expect(calls[0].method).toBe('DELETE')
    })
})
