import {describe, expect, test} from 'bun:test'
import {
    ExportKeyCommand,
    GetKeyCommand,
    ImportKeyCommand,
    type PaymentCryptographyClient,
} from '@aws-sdk/client-payment-cryptography'
import {AwsPaymentCryptographyAdapter} from './AwsPaymentCryptographyAdapter'
import {exportKeyTr31, importKeyTr31} from './paymentCryptographyTransfer'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'

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

    test('a wrapping key the form names is an ARN by the time it is sent', async () => {
        const {client, sent} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        // The form's options are the resource ids, which carry their kind, and the
        // runtime wants the ARN alone.
        await adapter.exportKey(KEY_ID, {wrappingKeyArn: `key/${KEK_ARN}`})

        const command = sent.find((each) => each instanceof ExportKeyCommand)
        expect(command).toBeDefined()
        expect((command as ExportKeyCommand).input.KeyMaterial?.Tr31KeyBlock?.WrappingKeyIdentifier).toBe(KEK_ARN)
        // The runtime is asked about the wrapping key by its ARN, not by the
        // resource id the form gave.
        const reads = sent
            .filter((each) => each instanceof GetKeyCommand)
            .map((each) => (each as GetKeyCommand).input.KeyIdentifier)
        expect(reads).toContain(KEK_ARN)
        expect(reads).not.toContain(`key/${KEK_ARN}`)
    })

    test('an alias is a name for a key; it is the key that leaves', async () => {
        const {client} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await expect(adapter.exportKey(ALIAS_ID, {wrappingKeyArn: KEK_ARN})).rejects.toBeInstanceOf(ValidationError)
    })
})

describe('the two halves of the exchange', () => {
    test('an export the service answered with no material is refused', async () => {
        const {client} = stubClient(() => ({}))

        // An export that produced nothing is not an export, so it is not
        // answered with an empty block.
        await expect(exportKeyTr31(client, ARN, KEK_ARN)).rejects.toBeInstanceOf(RuntimeError)
    })

    test('an export whose material is empty is refused', async () => {
        const {client} = stubClient(() => ({WrappedKey: {KeyMaterial: ''}}))

        await expect(exportKeyTr31(client, ARN, KEK_ARN)).rejects.toBeInstanceOf(RuntimeError)
    })

    test('an import sends the block under the wrapping key', async () => {
        const {client, sent} = stubClient(() => ({Key: {KeyArn: ARN}}))

        const arn = await importKeyTr31(client, KEK_ARN, 'D0112K1AB00E0000', true)

        const command = sent.find((each) => each instanceof ImportKeyCommand) as ImportKeyCommand
        expect(command.input.KeyMaterial?.Tr31KeyBlock?.WrappingKeyIdentifier).toBe(KEK_ARN)
        expect(command.input.KeyMaterial?.Tr31KeyBlock?.WrappedKeyBlock).toBe('D0112K1AB00E0000')
        expect(command.input.Enabled).toBe(true)
        expect(arn).toBe(ARN)
    })

    test('an import of a key that stays disabled says so', async () => {
        const {client, sent} = stubClient(() => ({Key: {KeyArn: ARN}}))

        await importKeyTr31(client, KEK_ARN, 'D0112K1AB00E0000', false)

        const command = sent.find((each) => each instanceof ImportKeyCommand) as ImportKeyCommand
        expect(command.input.Enabled).toBe(false)
    })

    test('a block that was wrapped across lines is sent as one block', async () => {
        const {client, sent} = stubClient(() => ({Key: {KeyArn: ARN}}))

        // A block that came out of a tool or out of a textarea carries the line
        // breaks it was wrapped at.
        await importKeyTr31(client, KEK_ARN, 'D0112K1AB\n00E0000', true)

        const command = sent.find((each) => each instanceof ImportKeyCommand) as ImportKeyCommand
        expect(command.input.KeyMaterial?.Tr31KeyBlock?.WrappedKeyBlock).toBe('D0112K1AB00E0000')
    })

    test('a block that is not a block is refused', async () => {
        const {client, sent} = stubClient(() => ({Key: {KeyArn: ARN}}))

        // The reference writes the block as a version identifier and the block
        // itself, so a slip of the keyboard is refused here rather than by the
        // service.
        await expect(importKeyTr31(client, KEK_ARN, 'not a block', true)).rejects.toBeInstanceOf(ValidationError)
        await expect(importKeyTr31(client, KEK_ARN, 'D0112K1AB00E000', true)).rejects.toBeInstanceOf(ValidationError)
        expect(sent.some((each) => each instanceof ImportKeyCommand)).toBe(false)
    })
})
