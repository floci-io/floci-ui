import {afterEach, describe, expect, test} from 'bun:test'
import {azureAccountName, azureLocation, azureLocationIn, azureSubscriptionId} from '../azure'
import {
    fetchEmulatorManifest,
    loadEmulatorManifest,
    manifestDefault,
    parseEmulatorManifest,
    setEmulatorManifest,
} from './emulatorManifest'

const INFO_URL = 'http://floci-az:4577/_floci/info'
const AZURE_MANIFEST = {
    manifest_version: 1,
    console_contract: 2,
    cloud: 'az',
    emulator: 'floci-az',
    services: {blob: 'enabled'},
    defaults: {
        cloud: 'AzureCloud',
        subscription_id: '00000000-0000-0000-0000-000000000001',
        tenant_id: '00000000-0000-0000-0000-000000000002',
        location: 'westeurope',
        storage_account: 'devstoreaccount1',
    },
    a_key_from_a_later_emulator: {nested: true},
}

const AZURE_VARIABLES = ['FLOCI_AZURE_ACCOUNT_NAME', 'FLOCI_AZURE_SUBSCRIPTION_ID', 'FLOCI_AZURE_LOCATION'] as const
const saved = Object.fromEntries(AZURE_VARIABLES.map((name) => [name, process.env[name]]))

afterEach(() => {
    setEmulatorManifest(null)
    for (const name of AZURE_VARIABLES) {
        if (saved[name] === undefined) delete process.env[name]
        else process.env[name] = saved[name]
    }
})

function fetcherReturning(response: () => Response) {
    const calls: string[] = []
    const fetcher = async (url: string) => {
        calls.push(url)
        return response()
    }
    return {fetcher, calls}
}

describe('parseEmulatorManifest', () => {
    test('reads the cloud and the string defaults, and ignores keys it does not know', () => {
        const manifest = parseEmulatorManifest(AZURE_MANIFEST)
        expect(manifest?.cloud).toBe('azure')
        expect(manifest?.defaults.subscription_id).toBe('00000000-0000-0000-0000-000000000001')
        expect(manifest?.defaults.location).toBe('westeurope')
    })

    test('refuses a manifest version it does not understand', () => {
        expect(parseEmulatorManifest({...AZURE_MANIFEST, manifest_version: 2})).toBeNull()
        expect(parseEmulatorManifest({...AZURE_MANIFEST, manifest_version: '1'})).toBeNull()
        expect(parseEmulatorManifest('not a manifest')).toBeNull()
        expect(parseEmulatorManifest(null)).toBeNull()
    })

    test('drops defaults that are not strings, and keeps prototype keys as plain data', () => {
        const manifest = parseEmulatorManifest(JSON.parse(
            '{"manifest_version":1,"cloud":"az","defaults":{"location":7,"__proto__":"x","storage_account":" "}}',
        ))
        expect(manifest?.defaults.location).toBeUndefined()
        expect(manifest?.defaults.storage_account).toBeUndefined()
        expect(Object.getPrototypeOf(manifest?.defaults)).toBeNull()
    })

    test('leaves the cloud unset for an emulator id it does not know', () => {
        expect(parseEmulatorManifest({...AZURE_MANIFEST, cloud: 'constructor'})?.cloud).toBeNull()
    })
})

describe('fetchEmulatorManifest', () => {
    test('does nothing without FLOCI_INFO_URL', async () => {
        const {fetcher, calls} = fetcherReturning(() => Response.json(AZURE_MANIFEST))
        expect(await fetchEmulatorManifest({}, fetcher)).toBeNull()
        expect(calls).toEqual([])
    })

    test('reads the manifest at FLOCI_INFO_URL', async () => {
        const {fetcher, calls} = fetcherReturning(() => Response.json(AZURE_MANIFEST))
        expect((await fetchEmulatorManifest({FLOCI_INFO_URL: INFO_URL}, fetcher))?.cloud).toBe('azure')
        expect(calls).toEqual([INFO_URL])
    })

    test('returns null rather than throwing on an error status, a bad body or no answer', async () => {
        const env = {FLOCI_INFO_URL: INFO_URL}
        expect(await fetchEmulatorManifest(env, fetcherReturning(() => new Response('', {status: 503})).fetcher)).toBeNull()
        expect(await fetchEmulatorManifest(env, fetcherReturning(() => new Response('<html>')).fetcher)).toBeNull()
        const refused = async () => {
            throw new Error('connection refused')
        }
        expect(await fetchEmulatorManifest(env, refused)).toBeNull()
    })

    test('gives up after its timeout', async () => {
        const hanging = (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        })
        expect(await fetchEmulatorManifest({FLOCI_INFO_URL: INFO_URL}, hanging, 20)).toBeNull()
    })
})

describe('loadEmulatorManifest', () => {
    test("answers only for the manifest's own cloud", async () => {
        await loadEmulatorManifest({FLOCI_INFO_URL: INFO_URL}, fetcherReturning(() => Response.json(AZURE_MANIFEST)).fetcher)
        expect(manifestDefault('azure', 'location')).toBe('westeurope')
        expect(manifestDefault('aws', 'location')).toBeUndefined()
    })

    test('retries in the background until the emulator answers', async () => {
        let answers = 0
        const fetcher = async () => (++answers < 2 ? new Response('', {status: 503}) : Response.json(AZURE_MANIFEST))
        await loadEmulatorManifest({FLOCI_INFO_URL: INFO_URL}, fetcher, 5)
        expect(manifestDefault('azure', 'location')).toBeUndefined()
        await Bun.sleep(50)
        expect(manifestDefault('azure', 'location')).toBe('westeurope')
    })
})

describe('Azure defaults', () => {
    test('take the variable first, then the manifest, then the built-in default', () => {
        for (const name of AZURE_VARIABLES) delete process.env[name]
        expect(azureSubscriptionId()).toBe('00000000-0000-0000-0000-000000000000')
        expect(azureLocation()).toBe('eastus')

        setEmulatorManifest(parseEmulatorManifest({...AZURE_MANIFEST, defaults: {...AZURE_MANIFEST.defaults, storage_account: 'acct'}}))
        expect(azureSubscriptionId()).toBe('00000000-0000-0000-0000-000000000001')
        expect(azureLocation()).toBe('westeurope')
        expect(azureAccountName()).toBe('acct')

        process.env.FLOCI_AZURE_SUBSCRIPTION_ID = 'from-env'
        process.env.FLOCI_AZURE_LOCATION = 'westus2'
        expect(azureSubscriptionId()).toBe('from-env')
        expect(azureLocation()).toBe('westus2')
    })

    test('fall back to eastus for a configured location outside a resource type list', () => {
        process.env.FLOCI_AZURE_LOCATION = 'swedencentral'
        expect(azureLocationIn(['eastus', 'westus2'])).toBe('eastus')
        process.env.FLOCI_AZURE_LOCATION = 'westus2'
        expect(azureLocationIn(['eastus', 'westus2'])).toBe('westus2')
    })
})
