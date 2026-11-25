import {describe, expect, test} from 'bun:test'
import {CloudAdapterRegistry} from '../registry/CloudAdapterRegistry'
import {CloudProxyService} from './CloudProxyService'
import {NotSupportedError, ValidationError} from '../cloud-spi/errors'
import type {CloudServiceAdapter, ExportedKeyMaterial} from '../cloud-spi/types'
import type {CloudProvider} from '../cloud-spi/types'
import type {RuntimeProbe} from './runtimeProbe'

/**
 * Runtime probes make real HTTP calls to the emulator endpoints, so tests inject
 * stubs, otherwise the status assertions depend on whether something happens to
 * be listening.
 */
function stubProbes(): Record<CloudProvider, RuntimeProbe> {
    const reachable: RuntimeProbe = async () => {}
    return {aws: reachable, azure: reachable, gcp: reachable, oci: reachable}
}

/** The material an export answers with. */
const material: ExportedKeyMaterial = {
    keyMaterial: 'D0112K1AB00E0000',
    format: 'TR31_KEY_BLOCK',
    wrappingKeyArn: null,
    keyCheckValue: null,
}

/** An adapter for the payment cryptography service that records what it was asked. */
function paymentAdapter(overrides: Partial<CloudServiceAdapter> = {}): CloudServiceAdapter {
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
        ...overrides,
    } as CloudServiceAdapter
}

function serviceWith(adapters: CloudServiceAdapter[]): CloudProxyService {
    return new CloudProxyService(new CloudAdapterRegistry(adapters), stubProbes())
}

describe('the material a key leaves under', () => {
    test('the body reaches the adapter as a checked string', async () => {
        const seen: Array<{id: string; input: {wrappingKeyArn: string}}> = []
        const service = serviceWith([
            paymentAdapter({
                exportKey: async (id: string, input: {wrappingKeyArn: string}) => {
                    seen.push({id, input})
                    return material
                },
            } as Partial<CloudServiceAdapter>),
        ])

        const exported = await service.exportPaymentCryptographyKey(
            'aws',
            'paymentcryptography',
            'key/abc',
            {wrappingKeyArn: '  key/def  '},
        )

        expect(seen[0]).toEqual({id: 'key/abc', input: {wrappingKeyArn: 'key/def'}})
        expect(exported).toEqual(material)
    })

    test('a body that does not hold a string is refused', async () => {
        const service = serviceWith([
            paymentAdapter({
                exportKey: async () => material,
            } as Partial<CloudServiceAdapter>),
        ])

        // The body arrives from a route that casts it, so the service checks it
        // rather than handing the adapter a value that is not a string.
        await expect(
            service.exportPaymentCryptographyKey('aws', 'paymentcryptography', 'key/abc', {
                wrappingKeyArn: 42 as unknown as string,
            }),
        ).rejects.toBeInstanceOf(ValidationError)
        await expect(
            service.exportPaymentCryptographyKey('aws', 'paymentcryptography', 'key/abc', {
                wrappingKeyArn: '   ' as unknown as string,
            }),
        ).rejects.toBeInstanceOf(ValidationError)
    })

    test('a service that does not export keys says so', async () => {
        const service = serviceWith([paymentAdapter()])

        await expect(
            service.exportPaymentCryptographyKey('aws', 'paymentcryptography', 'key/abc', {
                wrappingKeyArn: 'key/def',
            }),
        ).rejects.toBeInstanceOf(NotSupportedError)
    })
})
