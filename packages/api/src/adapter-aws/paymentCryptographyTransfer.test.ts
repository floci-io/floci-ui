import {describe, expect, test} from 'bun:test'
import {
    ExportKeyCommand,
    GetKeyCommand,
    type PaymentCryptographyClient,
} from '@aws-sdk/client-payment-cryptography'
import {AwsPaymentCryptographyAdapter} from './AwsPaymentCryptographyAdapter'
import {ValidationError} from '../cloud-spi/errors'

type SendResult = Record<string, unknown>

/** Minimal PaymentCryptographyClient stub that records the commands it was sent. */
function stubClient(handler: (command: object) => SendResult | Promise<SendResult>) {
    const sent: object[] = []
    const client = {
        async send(command: object) {
            sent.push(command)
            return handler(command)
        },
    } as unknown as PaymentCryptographyClient
    return {client, sent}
}

const ARN = 'arn:aws:payment-cryptography:us-east-1:000000000000:key/4a1b2c3d4e5f60718293a4b5c6d7e8f9'
const KEK_ARN = 'arn:aws:payment-cryptography:us-east-1:000000000000:key/11111111111111111111111111111111'
const KEY_ID = `key/${ARN}`
const ALIAS_ID = 'alias/ExampleAlias'

const key = {
    KeyArn: ARN,
    KeyAttributes: {
        KeyClass: 'SYMMETRIC_KEY',
        KeyUsage: 'TR31_K1_KEY_BLOCK_PROTECTION_KEY',
        KeyAlgorithm: 'AES_256',
        KeyModesOfUse: {Encrypt: true, Decrypt: true, Wrap: true, Unwrap: true},
    },
    KeyCheckValue: '3F2A1B',
    KeyCheckValueAlgorithm: 'CMAC',
    Enabled: true,
    Exportable: true,
    KeyState: 'CREATE_COMPLETE',
    KeyOrigin: 'AWS_PAYMENT_CRYPTOGRAPHY',
    CreateTimestamp: new Date('2026-11-04T09:15:00.000Z'),
}

/** The wrapping key, which is as strong as the key it carries. */
const kek = {
    ...key,
    KeyArn: KEK_ARN,
    KeyAttributes: {
        KeyClass: 'SYMMETRIC_KEY',
        KeyUsage: 'TR31_K0_KEY_ENCRYPTION_KEY',
        KeyAlgorithm: 'AES_256',
        KeyModesOfUse: {Encrypt: true, Decrypt: true, Wrap: true, Unwrap: true},
    },
}

/** A wrapping key that is too weak to carry the key. */
const weakKek = {
    ...kek,
    KeyAttributes: {...kek.KeyAttributes, KeyAlgorithm: 'TDES_2KEY'},
}

function runtimeStub(wrapping: unknown = kek) {
    return stubClient((command) => {
        if (command instanceof GetKeyCommand) {
            const named = (command as GetKeyCommand).input.KeyIdentifier
            if (named === KEK_ARN) return {Key: wrapping}
            if (named === ARN) return {Key: key}
            return {Key: undefined}
        }
        if (command instanceof ExportKeyCommand) {
            return {KeyId: ARN, WrappedKey: {KeyMaterial: 'D0112K1AB00E0000', WrappedKeyMaterialFormat: 'TR31_KEY_BLOCK'}}
        }
        return {}
    })
}

describe('the material a payment key leaves under', () => {
    test('a key leaves under a wrapping key that may carry it', async () => {
        const {client, sent} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        const material = await adapter.exportKey(KEY_ID, {wrappingKeyArn: KEK_ARN})

        const command = sent.find((each) => each instanceof ExportKeyCommand)
        expect(command).toBeDefined()
        const input = (command as ExportKeyCommand).input
        expect(input.ExportKeyIdentifier).toBe(ARN)
        expect(input.KeyMaterial?.Tr31KeyBlock?.WrappingKeyIdentifier).toBe(KEK_ARN)
        expect(material.keyMaterial).toBe('D0112K1AB00E0000')
    })

    test('a wrapping key that is too weak to carry the key is refused', async () => {
        const {client, sent} = runtimeStub(weakKek)
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await expect(adapter.exportKey(KEY_ID, {wrappingKeyArn: KEK_ARN})).rejects.toBeInstanceOf(ValidationError)
        expect(sent.some((command) => command instanceof ExportKeyCommand)).toBe(false)
    })

    test('a wrapping key that is not there is refused', async () => {
        const {client, sent} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await expect(
            adapter.exportKey(KEY_ID, {wrappingKeyArn: 'key/arn:aws:payment-cryptography:us-east-1:000000000000:key/22222222222222222222222222222222'}),
        ).rejects.toBeInstanceOf(ValidationError)
        expect(sent.some((command) => command instanceof ExportKeyCommand)).toBe(false)
    })

    test('an alias is a name for a key; it is the key that leaves', async () => {
        const {client} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await expect(adapter.exportKey(ALIAS_ID, {wrappingKeyArn: KEK_ARN})).rejects.toBeInstanceOf(ValidationError)
    })
})
