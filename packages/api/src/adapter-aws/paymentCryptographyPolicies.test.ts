import {describe, expect, test} from 'bun:test'
import {
    DeleteResourcePolicyCommand,
    GetKeyCommand,
    PutResourcePolicyCommand,
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

const POLICY = JSON.stringify({
    Version: '2012-10-17',
    Statement: [{Sid: 'Allow', Effect: 'Allow', Principal: {AWS: 'arn:aws:iam::111122223333:root'}, Action: 'kms:Decrypt', Resource: '*'}],
})

function runtimeStub() {
    return stubClient((command) => {
        if (command instanceof GetKeyCommand) return {Key: key}
        if (command instanceof PutResourcePolicyCommand) return {KeyId: ARN, Policy: POLICY}
        if (command instanceof DeleteResourcePolicyCommand) return {KeyId: ARN}
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

    test('an alias has no policy of its own; the key it names does', async () => {
        const {client} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await expect(adapter.setPolicy(ALIAS_ID, {policy: POLICY})).rejects.toBeInstanceOf(ValidationError)
    })
})
