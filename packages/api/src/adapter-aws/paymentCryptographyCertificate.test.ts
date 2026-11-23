import {describe, expect, test} from 'bun:test'
import {
    GetKeyCommand,
    GetPublicKeyCertificateCommand,
    type PaymentCryptographyClient,
} from '@aws-sdk/client-payment-cryptography'
import {AwsPaymentCryptographyAdapter} from './AwsPaymentCryptographyAdapter'

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

const symmetricKey = {
    KeyArn: ARN,
    KeyAttributes: {
        KeyClass: 'SYMMETRIC_KEY',
        KeyUsage: 'TR31_K0_KEY_ENCRYPTION_KEY',
        KeyAlgorithm: 'AES_256',
        KeyModesOfUse: {Encrypt: true, Decrypt: true, Wrap: true, Unwrap: true},
    },
    KeyCheckValue: '3F2A1B',
    KeyCheckValueAlgorithm: 'CMAC',
    Enabled: true,
    Exportable: false,
    KeyState: 'CREATE_COMPLETE',
    KeyOrigin: 'AWS_PAYMENT_CRYPTOGRAPHY',
    CreateTimestamp: new Date('2026-11-04T09:15:00.000Z'),
}

/** An asymmetric key has a public half, and the reference signs a certificate for it. */
const asymmetricKey = {
    ...symmetricKey,
    KeyAttributes: {
        ...symmetricKey.KeyAttributes,
        KeyClass: 'ASYMMETRIC_KEY_PAIR',
        KeyUsage: 'TR31_S0_ASYMMETRIC_KEY_FOR_DIGITAL_SIGNATURE',
        KeyAlgorithm: 'RSA_2048',
    },
}

const CERTIFICATE = 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t'

function runtimeStub(key: unknown) {
    return stubClient((command) => {
        if (command instanceof GetKeyCommand) return {Key: key}
        if (command instanceof GetPublicKeyCertificateCommand) {
            return {KeyCertificate: CERTIFICATE, KeyCertificateChain: ''}
        }
        return {}
    })
}

describe('the certificate of a payment key', () => {
    test('an asymmetric key carries the certificate of its public half', async () => {
        const {client, sent} = runtimeStub(asymmetricKey)
        const adapter = new AwsPaymentCryptographyAdapter(client)

        const resource = await adapter.get(ARN)

        const command = sent.find((each) => each instanceof GetPublicKeyCertificateCommand)
        expect(command).toBeDefined()
        expect((command as GetPublicKeyCertificateCommand).input.KeyIdentifier).toBe(ARN)
        expect(resource?.metadata.publicKeyCertificate).toBe(CERTIFICATE)
    })

    test('a symmetric key has no public half, so it has no certificate', async () => {
        const {client, sent} = runtimeStub(symmetricKey)
        const adapter = new AwsPaymentCryptographyAdapter(client)

        const resource = await adapter.get(ARN)

        expect(sent.some((each) => each instanceof GetPublicKeyCertificateCommand)).toBe(false)
        expect(resource?.metadata.publicKeyCertificate).toBeNull()
    })
})
