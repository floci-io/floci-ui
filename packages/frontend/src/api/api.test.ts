import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import {apiEndpointKeys, createApiClient} from './api'
import {copyStorageObject, deleteStorageObject, emptyStorageBucket, listStorageObjects, uploadStorageObject} from './cloudProxyClient'
import {ACCOUNT_HEADER, setAccountId} from '@/lib/accountStore'

const ACTIVE = '111111111111'
const CONFIRMED = '222222222222'

let fetchMock: ReturnType<typeof vi.fn>

/** Headers of the nth fetch, as they would go on the wire. */
function sentHeaders(call = 0): Headers {
    const init = fetchMock.mock.calls[call][1] as RequestInit
    return new Headers(init.headers)
}

describe('shared request interceptors', () => {
    beforeEach(() => {
        setAccountId(ACTIVE)
        fetchMock = vi.fn(async () => new Response(JSON.stringify({deleted: 3}), {
            status: 200,
            headers: {'content-type': 'application/json'},
        }))
        vi.stubGlobal('fetch', fetchMock)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    const families: Array<[string, string, Record<string, string> | undefined]> = [
        ['cloud proxy', apiEndpointKeys.clouds.list, undefined],
        ['legacy EC2', apiEndpointKeys.aws.ec2.instances.list, undefined],
        ['legacy EKS', apiEndpointKeys.aws.eks.clusters.list, undefined],
        ['legacy Secrets Manager', apiEndpointKeys.aws.secretsmanager.secrets.list, undefined],
    ]

    for (const [family, key, pathParams] of families) {
        test(`${family} requests fall back to the active account, keep Accept and send one bearer token`, async () => {
            const client = createApiClient(() => 'token-1')

            await client.call(key, {}, pathParams)

            const headers = sentHeaders()
            expect(headers.get(ACCOUNT_HEADER)).toBe(ACTIVE)
            expect(headers.get('accept')).toBe('application/json')
            expect(headers.get('authorization')).toBe('Bearer token-1')
        })
    }

    test('a JSON body keeps its Content-Type through both interceptors', async () => {
        const client = createApiClient(() => 'token-1')

        await client.call(apiEndpointKeys.clouds.resources.create, {body: {bucketName: 'logs'}}, {cloud: 'aws', service: 'storage'})

        expect(sentHeaders().get('content-type')).toBe('application/json')
        expect(sentHeaders().get('authorization')).toBe('Bearer token-1')
    })

    test('an explicit account header is kept, whatever its case, and sent once', async () => {
        const client = createApiClient()

        await client.call(apiEndpointKeys.clouds.list, {headers: {'X-Floci-Account-Id': CONFIRMED}})

        expect(sentHeaders().get(ACCOUNT_HEADER)).toBe(CONFIRMED)
    })

    for (const value of ['12345', 'abcdefghijkl', '1111111111111', '']) {
        test(`a malformed explicit account header ${JSON.stringify(value)} is refused before fetch`, async () => {
            const client = createApiClient()

            await expect(client.call(apiEndpointKeys.clouds.list, {headers: {[ACCOUNT_HEADER]: value}}))
                .rejects.toThrow('Invalid account ID override')
            expect(fetchMock).not.toHaveBeenCalled()
        })
    }

    test('object calls send the account they were given, not the active one', async () => {
        await listStorageObjects(CONFIRMED, 'aws', 'logs')
        await uploadStorageObject(CONFIRMED, 'aws', 'logs', 'a.txt', new Blob(['x'], {type: 'text/plain'}))
        await deleteStorageObject(CONFIRMED, 'aws', 'logs', 'a.txt')
        await copyStorageObject(CONFIRMED, 'aws', 'logs', 'a.txt', 'b.txt')

        expect(fetchMock).toHaveBeenCalledTimes(4)
        for (let call = 0; call < 4; call += 1) expect(sentHeaders(call).get(ACCOUNT_HEADER)).toBe(CONFIRMED)
        expect(sentHeaders(1).get('content-type')).toBe('text/plain')
    })

    test('emptyStorageBucket runs against the confirmed account, not the active one', async () => {
        const result = await emptyStorageBucket(CONFIRMED, 'aws', 'logs')

        expect(result).toEqual({deleted: 3})
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe('/api/clouds/aws/services/storage/resources/logs/empty')
        expect(init.method).toBe('POST')
        expect(sentHeaders().get(ACCOUNT_HEADER)).toBe(CONFIRMED)
    })
})
