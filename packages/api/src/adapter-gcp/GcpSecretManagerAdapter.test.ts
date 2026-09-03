import {afterEach, describe, expect, test} from 'bun:test'
import {GcpSecretManagerAdapter} from './GcpSecretManagerAdapter'
import {GcpRestRuntimeClient} from '../gcp'
import {NotFoundError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4588'
const SECRETS_PATH = '/v1/projects/floci-local/secrets'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): GcpSecretManagerAdapter {
    return new GcpSecretManagerAdapter(new GcpRestRuntimeClient(ENDPOINT, 'floci-local', 'us-central1'))
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
    const calls: Array<{url: string; init?: RequestInit}> = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({url: String(url), init})
        return handler(String(url), init)
    }) as unknown as typeof fetch
    return calls
}

/** Shape captured from floci-gcp 0.5.0. */
function secret(name: string) {
    return {
        name: `projects/floci-local/secrets/${name}`,
        createTime: '2026-07-28T04:34:51.773522423Z',
        replication: {automatic: {}},
    }
}

describe('GcpSecretManagerAdapter', () => {
    test('identifies itself as the GCP secrets adapter', () => {
        const instance = adapter()
        expect(instance.cloud).toBe('gcp')
        expect(instance.service).toBe('secrets')
        expect(instance.schema().displayName).toBe('Secret Manager')
    })

    test('lists secrets and reduces the resource path to a short id', async () => {
        stubFetch(() => new Response(JSON.stringify({secrets: [secret('db-password')]}), {status: 200}))
        const [resource] = await adapter().list()

        expect(resource).toMatchObject({id: 'db-password', name: 'db-password', type: 'secret', service: 'secrets'})
        expect(resource?.metadata.resourcePath).toBe('projects/floci-local/secrets/db-password')
        expect(resource?.metadata.replication).toBe('automatic')
    })

    test('never fetches or exposes a secret payload', async () => {
        // Reading a value needs versions/latest:access; the adapter must not.
        const calls = stubFetch(() => new Response(JSON.stringify({secrets: [secret('db-password')]}), {status: 200}))
        const [resource] = await adapter().list()

        expect(calls.every((c) => !c.url.includes(':access'))).toBe(true)
        expect(calls.every((c) => !c.url.includes('/versions'))).toBe(true)
        expect(JSON.stringify(resource)).not.toContain('payload')
    })

    test('reports a user-managed replication policy distinctly', async () => {
        stubFetch(() => new Response(JSON.stringify({
            secrets: [{...secret('db-password'), replication: {userManaged: {replicas: []}}}],
        }), {status: 200}))

        const [resource] = await adapter().list()
        expect(resource?.metadata.replication).toBe('user-managed')
    })

    test('normalizes an empty list payload', async () => {
        stubFetch(() => new Response('{}', {status: 200}))
        await expect(adapter().list()).resolves.toEqual([])
    })

    test('filters the list by search term', async () => {
        stubFetch(() => new Response(JSON.stringify({secrets: [secret('db-password'), secret('api-key')]}), {status: 200}))
        await expect(adapter().list({search: 'api'})).resolves.toHaveLength(1)
    })

    test('returns null when the secret does not exist', async () => {
        stubFetch(() => new Response(JSON.stringify({error: {code: 404, message: 'Secret not found'}}), {status: 404}))
        await expect(adapter().get('nope')).resolves.toBeNull()
    })

    test('creates with the id as a query parameter and a replication body', async () => {
        const calls = stubFetch(() => new Response(JSON.stringify(secret('api-key')), {status: 200}))
        const resource = await adapter().create({values: {secretName: 'api-key'}})

        expect(calls[0]?.init?.method).toBe('POST')
        expect(calls[0]?.url).toBe(`${ENDPOINT}${SECRETS_PATH}?secretId=api-key`)
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({replication: {automatic: {}}})
        expect(resource.id).toBe('api-key')
    })

    test('requires a secret name and rejects one the runtime would refuse', async () => {
        stubFetch(() => new Response('{}', {status: 200}))
        await expect(adapter().create({values: {}})).rejects.toBeInstanceOf(ValidationError)
        for (const name of ['has space', 'has/slash', 'a'.repeat(256)]) {
            await expect(adapter().create({values: {secretName: name}})).rejects.toBeInstanceOf(ValidationError)
        }
    })

    test('deletes a secret', async () => {
        const calls = stubFetch(() => new Response('{}', {status: 200}))
        await adapter().delete('api-key')

        expect(calls[0]?.url).toBe(`${ENDPOINT}${SECRETS_PATH}/api-key`)
        expect(calls[0]?.init?.method).toBe('DELETE')
    })

    test('surfaces a missing secret on delete', async () => {
        stubFetch(() => new Response(JSON.stringify({error: {code: 404, message: 'Secret not found'}}), {status: 404}))
        await expect(adapter().delete('nope')).rejects.toBeInstanceOf(NotFoundError)
    })
})
