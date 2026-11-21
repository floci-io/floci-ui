import {describe, expect, test} from 'bun:test'
import {
    AddKeyReplicationRegionsCommand,
    GetKeyCommand,
    RemoveKeyReplicationRegionsCommand,
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
    Exportable: true,
    KeyState: 'CREATE_COMPLETE',
    KeyOrigin: 'AWS_PAYMENT_CRYPTOGRAPHY',
    CreateTimestamp: new Date('2026-11-04T09:15:00.000Z'),
}

/** The key holds one replica already, so a change may both add and remove. */
function runtimeStub(replication: Record<string, unknown> = {'us-east-2': {}}) {
    return stubClient((command) => {
        if (command instanceof GetKeyCommand) return {Key: {...key, ReplicationStatus: replication}}
        return {}
    })
}

describe('the replication of a payment key', () => {
    test('a Region the key is not in yet is added', async () => {
        const {client, sent} = runtimeStub({})
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await adapter.setReplication(KEY_ID, {replicationRegions: ['us-east-2']})

        const command = sent.find((each) => each instanceof AddKeyReplicationRegionsCommand)
        expect(command).toBeDefined()
        const input = (command as AddKeyReplicationRegionsCommand).input
        expect(input.KeyIdentifier).toBe(ARN)
        expect(input.ReplicationRegions).toEqual(['us-east-2'])
    })

    test('a Region the key is in is left alone', async () => {
        const {client, sent} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await adapter.setReplication(KEY_ID, {replicationRegions: ['us-east-2']})

        expect(sent.some((each) => each instanceof AddKeyReplicationRegionsCommand)).toBe(false)
        expect(sent.some((each) => each instanceof RemoveKeyReplicationRegionsCommand)).toBe(false)
    })

    test('a Region the key no longer names is removed', async () => {
        const {client, sent} = runtimeStub({'us-east-2': {}, 'us-west-2': {}})
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await adapter.setReplication(KEY_ID, {replicationRegions: ['us-east-2']})

        const command = sent.find((each) => each instanceof RemoveKeyReplicationRegionsCommand)
        expect(command).toBeDefined()
        const input = (command as RemoveKeyReplicationRegionsCommand).input
        expect(input.KeyIdentifier).toBe(ARN)
        expect(input.ReplicationRegions).toEqual(['us-west-2'])
    })

    test('the Regions that are gone go before the ones that come', async () => {
        const {client, sent} = runtimeStub({'us-east-2': {}, 'us-west-2': {}})
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await adapter.setReplication(KEY_ID, {replicationRegions: ['us-east-2', 'eu-west-1']})

        // A key that replicates to as many Regions as it may would be refused a
        // fifth one, so a Region that is replaced has to be taken away first.
        const order = sent
            .filter((command) =>
                command instanceof RemoveKeyReplicationRegionsCommand ||
                command instanceof AddKeyReplicationRegionsCommand)
            .map((command) => (command instanceof RemoveKeyReplicationRegionsCommand ? 'remove' : 'add'))
        expect(order).toEqual(['remove', 'add'])
    })

    test('the Region the primary is in is not a replica, so it is never taken away', async () => {
        // A runtime that answered with the primary in the status would have it
        // taken away, which the reference refuses.
        const {client, sent} = stubClient((command) => {
            if (command instanceof GetKeyCommand) {
                return {Key: {...key, PrimaryRegion: 'us-east-1', ReplicationStatus: {'us-east-1': {}, 'us-east-2': {}}}}
            }
            return {}
        })
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await adapter.setReplication(KEY_ID, {replicationRegions: []})

        const command = sent.find((each) => each instanceof RemoveKeyReplicationRegionsCommand)
        expect(command).toBeDefined()
        expect((command as RemoveKeyReplicationRegionsCommand).input.ReplicationRegions).toEqual(['us-east-2'])
    })

    test('a member that is not a list of Regions is refused', async () => {
        const {client, sent} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await expect(adapter.setReplication(KEY_ID, {replicationRegions: 'us-east-2'})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter.setReplication(KEY_ID, {replicationRegions: [1]})).rejects.toBeInstanceOf(ValidationError)
        expect(sent.some((each) => each instanceof AddKeyReplicationRegionsCommand)).toBe(false)
    })

    test('an alias has no Regions of its own; the key it names does', async () => {
        const {client} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await expect(adapter.setReplication(ALIAS_ID, {replicationRegions: ['us-east-2']})).rejects.toBeInstanceOf(ValidationError)
    })
})
