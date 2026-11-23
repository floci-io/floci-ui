import {describe, expect, test} from 'bun:test'
import {
    GetKeyCommand,
    GetPublicKeyCertificateCommand,
    ListKeysCommand,
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

function runtimeStub(key: unknown, certificate?: () => never, certificateResponse?: Record<string, unknown>) {
    return stubClient((command) => {
        if (command instanceof ListKeysCommand) return {Keys: [{KeyArn: ARN}]}
        if (command instanceof GetKeyCommand) return {Key: key}
        if (command instanceof GetPublicKeyCertificateCommand) {
            if (certificate) return certificate()
            return {KeyCertificate: CERTIFICATE, KeyCertificateChain: '', ...certificateResponse}
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
        expect(resource?.metadata.publicKeyCertificateState).toBe('signed')
    })

    test('the chain the certificate is signed in travels with it', async () => {
        const {client} = runtimeStub(asymmetricKey)
        const adapter = new AwsPaymentCryptographyAdapter(client)

        const resource = await adapter.get(ARN)

        // The leaf alone cannot be verified against anything, so the chain the
        // service handed out is published beside it.
        expect(resource?.metadata.publicKeyCertificateChain).toBe('')
    })

    test('a key whose class was not read is not asked for a certificate', async () => {
        const {client, sent} = runtimeStub({...asymmetricKey, KeyAttributes: undefined})
        const adapter = new AwsPaymentCryptographyAdapter(client)

        const resource = await adapter.get(ARN)

        // The class was not read, so the question of a certificate was never
        // asked, and the metadata does not claim that the key has none.
        expect(sent.some((each) => each instanceof GetPublicKeyCertificateCommand)).toBe(false)
        expect(resource?.metadata.publicKeyCertificate).toBeUndefined()
        expect(resource?.metadata.publicKeyCertificateState).toBe('unknown')
    })

    test('a symmetric key has no public half, so it has no certificate', async () => {
        const {client, sent} = runtimeStub(symmetricKey)
        const adapter = new AwsPaymentCryptographyAdapter(client)

        const resource = await adapter.get(ARN)

        expect(sent.some((each) => each instanceof GetPublicKeyCertificateCommand)).toBe(false)
        expect(resource?.metadata.publicKeyCertificate).toBeUndefined()
        expect(resource?.metadata.publicKeyCertificateState).toBe('no-public-half')
    })

    test('a key that was never inspected carries no certificate at all', async () => {
        const {client} = runtimeStub(asymmetricKey)
        const adapter = new AwsPaymentCryptographyAdapter(client)

        const rows = await adapter.list()

        // The certificate belongs to the key's detail, so the table's rows carry
        // neither one nor a state: the question was never asked of them, and a
        // state would contradict the key class the row does carry.
        expect(rows[0]?.metadata.publicKeyCertificate).toBeUndefined()
        expect(rows[0]?.metadata.publicKeyCertificateState).toBeUndefined()
    })

    test('a certificate that cannot be read does not take the key with it', async () => {
        const {client} = runtimeStub(asymmetricKey, () => {
            throw Object.assign(new Error('The service is busy.'), {
                name: 'InternalServerException',
                $metadata: {httpStatusCode: 500},
            })
        })
        const adapter = new AwsPaymentCryptographyAdapter(client)

        const resource = await adapter.get(ARN)

        // The certificate is enrichment, so a failure degrades the inspector
        // rather than the request, the way the tag lookup does.
        expect(resource?.metadata.publicKeyCertificateState).toBe('unreadable')
        expect(resource?.metadata.keyAlgorithm).toBe('RSA_2048')
    })

    test('a service that signed no certificate says so', async () => {
        const {client} = runtimeStub(asymmetricKey, undefined, {KeyCertificate: undefined})
        const adapter = new AwsPaymentCryptographyAdapter(client)

        const resource = await adapter.get(ARN)

        // The key has a public half, so it is the service that signed none,
        // and the state says that rather than claiming there is no half.
        expect(resource?.metadata.publicKeyCertificateState).toBe('unsigned')
        expect(resource?.metadata.publicKeyCertificate).toBeNull()
    })

    test('a service that refuses the request has no certificate to give', async () => {
        const {client} = runtimeStub(asymmetricKey, () => {
            throw Object.assign(new Error('the key has no public key'), {
                name: 'ValidationException',
                $metadata: {httpStatusCode: 400},
            })
        })
        const adapter = new AwsPaymentCryptographyAdapter(client)

        const resource = await adapter.get(ARN)

        // A refusal is the service saying it has none to give, which is not the
        // same thing as a read that did not come.
        expect(resource?.metadata.publicKeyCertificateState).toBe('unsigned')
    })
})
