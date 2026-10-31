import {afterEach, describe, expect, test} from 'bun:test'
import {AzureDeploymentsAdapter} from './AzureDeploymentsAdapter'
import {AzureRestRuntimeClient} from '../azure'
import {NotSupportedError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4577'
const SUB = '00000000-0000-0000-0000-000000000001'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): AzureDeploymentsAdapter {
    return new AzureDeploymentsAdapter(new AzureRestRuntimeClient(ENDPOINT, 'devstoreaccount1'))
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status})
}

function deployment(name = 'web', resourceGroup = 'rg1', overrides: Record<string, unknown> = {}) {
    return {
        id: `/subscriptions/${SUB}/resourceGroups/${resourceGroup}/providers/Microsoft.Resources/deployments/${name}`,
        name,
        type: 'Microsoft.Resources/deployments',
        properties: {
            provisioningState: 'Succeeded',
            timestamp: '2026-10-31T11:48:38.129479302Z',
            duration: 'PT0.0046S',
            mode: 'Incremental',
            correlationId: 'c3cd365d-655f-4b9f-ac08-b5642605901f',
            templateHash: '6269866043436895056',
            parameters: {n: {type: 'String', value: 'flocist385'}},
            outputs: {acct: {type: 'string', value: 'flocist385'}},
            outputResources: [{id: `/subscriptions/${SUB}/resourceGroups/${resourceGroup}/providers/Microsoft.Storage/storageAccounts/flocist385`}],
            providers: [{namespace: 'Microsoft.Storage', resourceTypes: [{resourceType: 'storageAccounts'}]}],
            ...overrides,
        },
    }
}

const operations = [
    {
        operationId: 'E9B2F7C6678F8557',
        properties: {
            provisioningOperation: 'Create',
            provisioningState: 'Succeeded',
            statusCode: 'OK',
            targetResource: {resourceType: 'Microsoft.Storage/storageAccounts', resourceName: 'flocist385'},
        },
    },
    {
        operationId: '8D532759624A71F1',
        properties: {
            provisioningOperation: 'Create',
            provisioningState: 'Failed',
            statusCode: 'BadRequest',
            statusMessage: {status: 'Failed', error: {code: 'AccountNameInvalid', message: 'not a valid storage account name'}},
            targetResource: {resourceType: 'Microsoft.Storage/storageAccounts', resourceName: 'BAD'},
        },
    },
]

/** Routes each request to what the runtime answers for it, recording the URLs. */
function runtimeStub(options: {groups?: string[]; deployments?: Record<string, unknown[]>; operations?: unknown[]} = {}) {
    const urls: string[] = []
    const groups = options.groups ?? ['rg1']
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input)
        urls.push(url.replace(ENDPOINT, ''))
        const path = new URL(url).pathname

        if (path === '/subscriptions') return json({value: [{subscriptionId: SUB}]})
        if (path === `/subscriptions/${SUB}/resourceGroups`) return json({value: groups.map((name) => ({name}))})

        const match = path.match(/resourceGroups\/([^/]+)\/providers\/Microsoft\.Resources\/deployments(?:\/([^/]+)(\/operations)?)?$/)
        if (!match) return json({error: {code: 'NotFound'}}, 404)
        const [, group, name, ops] = match
        const known = (options.deployments ?? {rg1: [deployment()]})[group]
        if (!known) return json({error: {code: 'ResourceGroupNotFound'}}, 404)
        if (!name) return json({value: known})
        const found = (known as Array<{name: string}>).find((item) => item.name === name)
        if (!found) return json({error: {code: 'DeploymentNotFound'}}, 404)
        return ops ? json({value: options.operations ?? []}) : json(found)
    }) as unknown as typeof fetch
    return urls
}

describe('AzureDeploymentsAdapter', () => {
    test('advertises only list and inspect', () => {
        const schema = adapter().schema()
        expect(schema.actions).toEqual(['list', 'inspect'])
        expect(schema.capabilities?.resourceActions?.map((action) => action.name)).toEqual(['list', 'inspect'])
    })

    test('lists deployments across resource groups with state and timestamp', async () => {
        runtimeStub({groups: ['rg1', 'rg2'], deployments: {rg1: [deployment('a', 'rg1')], rg2: [deployment('b', 'rg2', {provisioningState: 'Failed'})]}})

        const resources = await adapter().list()

        expect(resources.map((resource) => resource.id)).toEqual(['rg1/a', 'rg2/b'])
        expect(resources[0]).toMatchObject({
            name: 'a',
            service: 'iac',
            status: 'Succeeded',
            createdAt: '2026-10-31T11:48:38.129479302Z',
            metadata: {resourceGroup: 'rg1', mode: 'Incremental'},
        })
        expect(resources[1].status).toBe('Failed')
    })

    test('returns an empty list when there are no groups or no deployments', async () => {
        runtimeStub({groups: []})
        expect(await adapter().list()).toEqual([])

        runtimeStub({groups: ['rg1'], deployments: {rg1: []}})
        expect(await adapter().list()).toEqual([])
    })

    test('skips a group the runtime no longer finds', async () => {
        runtimeStub({groups: ['gone'], deployments: {}})
        expect(await adapter().list()).toEqual([])
    })

    test('filters by search, case insensitively', async () => {
        runtimeStub({deployments: {rg1: [deployment('Web-App'), deployment('db')]}})
        expect((await adapter().list({search: 'WEB'})).map((resource) => resource.name)).toEqual(['Web-App'])
    })

    test('does not fetch operations while listing', async () => {
        const urls = runtimeStub()
        await adapter().list()
        expect(urls.some((url) => url.includes('/operations'))).toBe(false)
    })

    test('inspect returns outputs, parameters, output resources and operations', async () => {
        runtimeStub({operations})

        const resource = await adapter().get('rg1/web')

        expect(resource?.metadata).toMatchObject({
            outputs: [{name: 'acct', type: 'string', value: 'flocist385'}],
            parameters: [{name: 'n', type: 'String', value: 'flocist385'}],
            providers: ['Microsoft.Storage'],
            outputResources: [expect.stringContaining('storageAccounts/flocist385')],
        })
        expect(resource?.metadata.operations).toEqual([
            expect.objectContaining({operation: 'Create', state: 'Succeeded', statusCode: 'OK', resourceName: 'flocist385'}),
            expect.objectContaining({state: 'Failed', statusCode: 'BadRequest', message: 'not a valid storage account name'}),
        ])
    })

    test('inspect surfaces the deployment error and its details', async () => {
        runtimeStub({
            deployments: {
                rg1: [deployment('bad', 'rg1', {
                    provisioningState: 'Failed',
                    error: {code: 'DeploymentFailed', message: 'At least one failed', details: [{code: 'AccountNameInvalid', message: 'bad name', target: '/x'}]},
                })],
            },
        })

        const resource = await adapter().get('rg1/bad')

        expect(resource?.metadata.error).toEqual({
            code: 'DeploymentFailed',
            message: 'At least one failed',
            details: [{code: 'AccountNameInvalid', message: 'bad name', target: '/x'}],
        })
    })

    test('never copies the value of a secure parameter or output', async () => {
        runtimeStub({
            deployments: {
                rg1: [deployment('s', 'rg1', {
                    parameters: {pw: {type: 'SecureString', value: 'hunter2'}},
                    outputs: {key: {type: 'secureObject', value: {k: 'hunter2'}}},
                })],
            },
        })

        const resource = await adapter().get('rg1/s')

        expect(JSON.stringify(resource)).not.toContain('hunter2')
        expect(resource?.metadata.parameters).toEqual([{name: 'pw', type: 'SecureString'}])
    })

    test('returns null for an unknown deployment or resource group', async () => {
        runtimeStub()
        expect(await adapter().get('rg1/missing')).toBeNull()
        expect(await adapter().get('nope/web')).toBeNull()
    })

    test('rejects an id without a resource group', async () => {
        runtimeStub()
        await expect(adapter().get('web')).rejects.toBeInstanceOf(ValidationError)
    })

    test('create and delete are not supported', async () => {
        await expect(adapter().create({values: {}})).rejects.toBeInstanceOf(NotSupportedError)
        await expect(adapter().delete('rg1/web')).rejects.toBeInstanceOf(NotSupportedError)
    })
})
