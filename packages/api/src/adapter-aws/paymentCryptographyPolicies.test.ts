import {describe, expect, test} from 'bun:test'
import {
    DeleteResourcePolicyCommand,
    GetKeyCommand,
    GetPublicKeyCertificateCommand,
    GetResourcePolicyCommand,
    PutResourcePolicyCommand,
    type PaymentCryptographyClient,
} from '@aws-sdk/client-payment-cryptography'
import {AwsPaymentCryptographyAdapter} from './AwsPaymentCryptographyAdapter'
import {getKeyPolicy} from './paymentCryptographyPolicies'
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

/** A key with a public half, so the certificate is read with it. */
const pairKey = {
    ...key,
    KeyAttributes: {...attributes, KeyClass: 'ASYMMETRIC_KEY_PAIR'},
}

const POLICY = JSON.stringify({
    Version: '2012-10-17',
    Statement: [{Sid: 'Allow', Effect: 'Allow', Principal: {AWS: 'arn:aws:iam::111122223333:root'}, Action: 'kms:Decrypt', Resource: '*'}],
})

function runtimeStub(policy: string | null = POLICY) {
    return stubClient((command) => {
        if (command instanceof GetKeyCommand) return {Key: key}
        if (command instanceof GetResourcePolicyCommand) return {Policy: policy ?? undefined}
        if (command instanceof PutResourcePolicyCommand) return {ResourceArn: ARN, Policy: POLICY}
        if (command instanceof DeleteResourcePolicyCommand) return {ResourceArn: ARN}
        return {}
    })
}

describe('the policy of a payment key', () => {
    test('a policy is put on the key', async () => {
        const {client, sent} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await adapter.setPolicy(KEY_ID, {policy: POLICY})

        const command = sent.find((each) => each instanceof PutResourcePolicyCommand)
        expect(command).toBeDefined()
        const input = (command as PutResourcePolicyCommand).input
        expect(input.ResourceArn).toBe(ARN)
        expect(input.Policy).toBe(POLICY)
    })

    test('an empty policy removes the one the key has', async () => {
        const {client, sent} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await adapter.setPolicy(KEY_ID, {policy: ''})

        const command = sent.find((each) => each instanceof DeleteResourcePolicyCommand)
        expect(command).toBeDefined()
        expect((command as DeleteResourcePolicyCommand).input.ResourceArn).toBe(ARN)
        expect(sent.some((each) => each instanceof PutResourcePolicyCommand)).toBe(false)
    })

    test('the policy the key holds is read with the key', async () => {
        const {client, sent} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        const resource = await adapter.get(KEY_ID)

        // The panel shows the policy the key holds, so it is read with the key
        // rather than left for the panel to ask for.
        expect(sent.some((command) => command instanceof GetResourcePolicyCommand)).toBe(true)
        expect(resource?.metadata.keyPolicy).toBe(POLICY)
    })

    test('a key with no policy says so', async () => {
        const {client} = runtimeStub(null)
        const adapter = new AwsPaymentCryptographyAdapter(client)

        const resource = await adapter.get(KEY_ID)

        expect(resource?.metadata.keyPolicy).toBeNull()
    })

    test('a request that says nothing about the policy is refused, not a removal', async () => {
        const {client, sent} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        // A request without a policy is a fault of the caller. Reading it as a
        // removal would take the policy away from a key that still holds one.
        await expect(adapter.setPolicy(KEY_ID, {})).rejects.toBeInstanceOf(ValidationError)
        expect(sent.some((command) => command instanceof DeleteResourcePolicyCommand)).toBe(false)
        expect(sent.some((command) => command instanceof PutResourcePolicyCommand)).toBe(false)
    })

    test('a policy that is not a document is refused', async () => {
        const {client, sent} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await expect(adapter.setPolicy(KEY_ID, {policy: 42})).rejects.toBeInstanceOf(ValidationError)
        expect(sent.some((command) => command instanceof PutResourcePolicyCommand)).toBe(false)
    })

    test('a request that says nothing is refused, not a fault', async () => {
        const {client, sent} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await expect(adapter.setPolicy(KEY_ID, null as never)).rejects.toBeInstanceOf(ValidationError)
        expect(sent.some((command) => command instanceof DeleteResourcePolicyCommand)).toBe(false)
    })

    test('an alias has no policy of its own; the key it names does', async () => {
        const {client} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await expect(adapter.setPolicy(ALIAS_ID, {policy: POLICY})).rejects.toBeInstanceOf(ValidationError)
    })

    test('a policy that cannot be read is reported, not thrown', async () => {
        const {client} = stubClient(() => {
            throw Object.assign(new Error('throttled'), {name: 'ThrottlingException'})
        })

        // The policy is enrichment: a refusal says nothing of the policy the key
        // holds, so it must not take the key with it.
        expect(await getKeyPolicy(client, ARN)).toEqual({policy: null, unavailable: true})
    })

    test('a key that holds no policy is not a policy that could not be read', async () => {
        const {client} = stubClient(() => {
            throw Object.assign(new Error('not found'), {name: 'ResourceNotFoundException'})
        })

        expect(await getKeyPolicy(client, ARN)).toEqual({policy: null})
    })

    test('a policy that cannot be read leaves the key on screen and says so', async () => {
        const {client} = stubClient((command) => {
            if (command instanceof GetKeyCommand) return {Key: key}
            if (command instanceof GetResourcePolicyCommand) {
                throw Object.assign(new Error('Access denied'), {name: 'AccessDeniedException'})
            }
            return {}
        })
        const adapter = new AwsPaymentCryptographyAdapter(client)

        const resource = await adapter.get(KEY_ID)

        expect(resource?.name).toBe(ARN)
        expect(resource?.metadata.keyPolicyUnavailable).toBe(true)
    })

    test('the policy is read with the key, not after it', async () => {
        let inFlight = 0
        let peak = 0
        const {client} = stubClient(async (command) => {
            inFlight += 1
            peak = Math.max(peak, inFlight)
            await new Promise((resolve) => setTimeout(resolve, 0))
            inFlight -= 1
            if (command instanceof GetKeyCommand) return {Key: pairKey}
            if (command instanceof GetResourcePolicyCommand) return {Policy: POLICY}
            if (command instanceof GetPublicKeyCertificateCommand) return {KeyCertificate: 'CERTIFICATE-PEM'}
            return {}
        })
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await adapter.get(KEY_ID)

        // The tags, the certificate and the policy depend on none of each other,
        // so they are asked together: reading one key costs one round trip and
        // not three.
        expect(peak).toBe(3)
    })
})
