import {describe, expect, test} from 'bun:test'
import {
    GetKeyCommand,
    StartKeyUsageCommand,
    StopKeyUsageCommand,
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
const KEY_ID = `key/${ARN}`
const ALIAS_ID = 'alias/ExampleAlias'

const attributes = {
    KeyClass: 'SYMMETRIC_KEY',
    KeyUsage: 'TR31_K0_KEY_ENCRYPTION_KEY',
    KeyAlgorithm: 'AES_256',
    KeyModesOfUse: {Encrypt: true, Decrypt: true, Wrap: true, Unwrap: true},
}

const key = {
    KeyArn: ARN,
    KeyAttributes: attributes,
    KeyCheckValue: '3F2A1B',
    KeyCheckValueAlgorithm: 'CMAC',
    Enabled: true,
    Exportable: false,
    KeyState: 'CREATE_COMPLETE',
    KeyOrigin: 'AWS_PAYMENT_CRYPTOGRAPHY',
    CreateTimestamp: new Date('2026-11-04T09:15:00.000Z'),
}

function runtimeStub() {
    return stubClient((command) => {
        if (command instanceof GetKeyCommand) return {Key: key}
        return {}
    })
}

describe('the usage of a payment key', () => {
    test('a key that is enabled again starts being used', async () => {
        const {client, sent} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await adapter.setUsage(KEY_ID, {enabled: 'true'})

        const command = sent.find((each) => each instanceof StartKeyUsageCommand)
        expect(command).toBeDefined()
        expect((command as StartKeyUsageCommand).input.KeyIdentifier).toBe(ARN)
    })

    test('a key that is disabled stops being used', async () => {
        const {client, sent} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await adapter.setUsage(KEY_ID, {enabled: 'false'})

        const command = sent.find((each) => each instanceof StopKeyUsageCommand)
        expect(command).toBeDefined()
        expect((command as StopKeyUsageCommand).input.KeyIdentifier).toBe(ARN)
    })

    test('a member that does not say whether the key may be used is refused', async () => {
        const {client, sent} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await expect(adapter.setUsage(KEY_ID, {enabled: 'maybe'})).rejects.toBeInstanceOf(ValidationError)
        expect(sent.some((command) => command instanceof StartKeyUsageCommand)).toBe(false)
        expect(sent.some((command) => command instanceof StopKeyUsageCommand)).toBe(false)
    })

    test('an alias has no usage of its own; the key it names does', async () => {
        const {client} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await expect(adapter.setUsage(ALIAS_ID, {enabled: 'true'})).rejects.toBeInstanceOf(ValidationError)
    })
})
