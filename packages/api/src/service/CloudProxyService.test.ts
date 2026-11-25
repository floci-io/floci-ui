import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {CloudAdapterRegistry} from '../registry/CloudAdapterRegistry'
import {CloudProxyService} from './CloudProxyService'
import type {CloudProvider, CloudServiceAdapter} from '../cloud-spi/types'
import type {RuntimeProbe} from './runtimeProbe'

/**
 * The doc block that sits above each method of a file, by the method's name.
 *
 * <p>A block that documents nothing is a block stacked on another one, so the
 * map says where the blocks of the file really are.
 */
function documentedMethods(source: string): Map<string, string> {
    const documented = new Map<string, string>()
    const pattern = /((?:\/\*\*[\s\S]*?\*\/\s*)+)(?:public |private |protected )?(?:async )?([A-Za-z_]\w*)\s*\(/g
    for (const match of source.matchAll(pattern)) {
        documented.set(match[2], match[1])
    }
    return documented
}

/** Runtime probes make real HTTP calls, so the tests hand the service idle ones. */
function stubProbes(): Record<CloudProvider, RuntimeProbe> {
    const reachable: RuntimeProbe = async () => {}
    return {aws: reachable, azure: reachable, gcp: reachable, oci: reachable}
}

/** An adapter for the payment cryptography service, with the settings it is given. */
function paymentAdapter(settings: Partial<CloudServiceAdapter> = {}): CloudServiceAdapter {
    return {
        cloud: 'aws',
        service: 'paymentcryptography',
        schema: () => ({
            cloud: 'aws',
            service: 'paymentcryptography',
            displayName: 'Payment Cryptography',
            fields: [],
            actions: ['list', 'create', 'delete', 'inspect'],
            filters: [],
            columns: [],
        }),
        list: async () => [],
        get: async () => null,
        create: async () => ({
            id: 'key/abc',
            name: 'abc',
            cloud: 'aws',
            service: 'paymentcryptography',
            type: 'key',
            region: 'us-east-1',
            createdAt: null,
            metadata: {},
        }),
        delete: async () => {},
        ...settings,
    } as CloudServiceAdapter
}

/** The service that dispatches to the adapters it is given. */
function serviceWith(adapters: CloudServiceAdapter[]): CloudProxyService {
    return new CloudProxyService(new CloudAdapterRegistry(adapters), stubProbes())
}

describe('the doc blocks of the service', () => {
    test('every block sits above the method it documents', () => {
        const source = readFileSync(new URL('./CloudProxyService.ts', import.meta.url), 'utf8')
        const documented = documentedMethods(source)

        // The policy's block sits above the method that sets a policy and the
        // usage's above the method that sets a usage: a block stacked on
        // another one documents neither.
        expect(documented.get('setPaymentCryptographyKeyPolicy')).toContain(
            'The policy that lets another account use a key.',
        )
        expect(documented.get('setPaymentCryptographyKeyUsage')).toContain('Whether a key may be used.')
        expect(documented.get('setPaymentCryptographyKeyUsage')).not.toContain(
            'The policy that lets another account use a key.',
        )
    })
})

describe('the settings of a payment key', () => {
    test('a refusal to set a policy names the setting that was refused', async () => {
        const service = serviceWith([paymentAdapter()])

        // The refusal says what was refused, the way the other refusals of the
        // service do, so the caller is not left with a refusal that names
        // nothing.
        await expect(
            service.setPaymentCryptographyKeyPolicy('aws', 'paymentcryptography', 'key/abc', {}),
        ).rejects.toThrow('Setting a key policy is not supported for aws/paymentcryptography')
    })

    test('the two settings are dispatched in one place', () => {
        const source = readFileSync(new URL('./CloudProxyService.ts', import.meta.url), 'utf8')

        // The adapter is cast to the shape that carries its own methods once,
        // so the dispatch that reaches it is written once and the two settings
        // cannot drift apart.
        expect(source.match(/adapter as \{/g)?.length ?? 0).toBe(1)
    })

    test('each setting reaches the adapter method of its own', async () => {
        const seen: string[] = []
        const service = serviceWith([
            paymentAdapter({
                setUsage: async () => {
                    seen.push('setUsage')
                },
                setPolicy: async () => {
                    seen.push('setPolicy')
                },
            } as Partial<CloudServiceAdapter>),
        ])

        await service.setPaymentCryptographyKeyUsage('aws', 'paymentcryptography', 'key/abc', {enabled: 'true'})
        await service.setPaymentCryptographyKeyPolicy('aws', 'paymentcryptography', 'key/abc', {policy: '{}'})

        expect(seen).toEqual(['setUsage', 'setPolicy'])
    })
})
