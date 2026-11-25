import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {
    AddKeyReplicationRegionsCommand,
    GetKeyCommand,
    RemoveKeyReplicationRegionsCommand,
    type PaymentCryptographyClient,
} from '@aws-sdk/client-payment-cryptography'
import {AwsPaymentCryptographyAdapter} from './AwsPaymentCryptographyAdapter'
import {addReplicationRegions, removeReplicationRegions} from './paymentCryptographyReplication'
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
    test('a request that names only the Regions to add is not refused', async () => {
        const {client, sent} = runtimeStub({})
        const adapter = new AwsPaymentCryptographyAdapter(client)

        // A list that is not there is a list of no Regions: the request says
        // which Region to add and says nothing about the ones that go.
        await adapter.setReplication(KEY_ID, {addReplicationRegions: ['us-east-2']})

        const command = sent.find((each) => each instanceof AddKeyReplicationRegionsCommand)
        expect(command).toBeDefined()
        expect((command as AddKeyReplicationRegionsCommand).input.ReplicationRegions).toEqual(['us-east-2'])
        expect(sent.some((each) => each instanceof RemoveKeyReplicationRegionsCommand)).toBe(false)
    })

    test('the Regions are changed with the ARN of the key', async () => {
        const {client, sent} = runtimeStub({})
        const adapter = new AwsPaymentCryptographyAdapter(client)

        // The commands take the ARN of the key, and a key asked for by a short
        // id is resolved to the ARN it has.
        await adapter.setReplication('key/abcd1234', {addReplicationRegions: ['us-east-2']})

        const command = sent.find((each) => each instanceof AddKeyReplicationRegionsCommand)
        expect((command as AddKeyReplicationRegionsCommand).input.KeyIdentifier).toBe(ARN)
    })

    test('a Region the key is not in yet is added', async () => {
        const {client, sent} = runtimeStub({})
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await adapter.setReplication(KEY_ID, {addReplicationRegions: ['us-east-2'], removeReplicationRegions: []})

        const command = sent.find((each) => each instanceof AddKeyReplicationRegionsCommand)
        expect(command).toBeDefined()
        const input = (command as AddKeyReplicationRegionsCommand).input
        expect(input.KeyIdentifier).toBe(ARN)
        expect(input.ReplicationRegions).toEqual(['us-east-2'])
    })

    test('a Region the key is in is left alone', async () => {
        const {client, sent} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await adapter.setReplication(KEY_ID, {addReplicationRegions: ['us-east-2'], removeReplicationRegions: []})

        expect(sent.some((each) => each instanceof AddKeyReplicationRegionsCommand)).toBe(false)
        expect(sent.some((each) => each instanceof RemoveKeyReplicationRegionsCommand)).toBe(false)
    })

    test('a Region the request names is removed', async () => {
        const {client, sent} = runtimeStub({'us-east-2': {}, 'us-west-2': {}})
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await adapter.setReplication(KEY_ID, {addReplicationRegions: [], removeReplicationRegions: ['us-west-2']})

        const command = sent.find((each) => each instanceof RemoveKeyReplicationRegionsCommand)
        expect(command).toBeDefined()
        const input = (command as RemoveKeyReplicationRegionsCommand).input
        expect(input.KeyIdentifier).toBe(ARN)
        expect(input.ReplicationRegions).toEqual(['us-west-2'])
    })

    test('a Region the request does not name is left alone', async () => {
        const {client, sent} = runtimeStub({'us-east-2': {}, 'us-west-2': {}})
        const adapter = new AwsPaymentCryptographyAdapter(client)

        // The request says which Region to add and which to remove, so a Region
        // that arrived while the console was open is not one it takes away.
        await adapter.setReplication(KEY_ID, {addReplicationRegions: ['eu-west-1'], removeReplicationRegions: []})

        expect(sent.some((each) => each instanceof RemoveKeyReplicationRegionsCommand)).toBe(false)
        const command = sent.find((each) => each instanceof AddKeyReplicationRegionsCommand)
        expect((command as AddKeyReplicationRegionsCommand).input.ReplicationRegions).toEqual(['eu-west-1'])
    })

    test('a Region the service does not hold is not taken away', async () => {
        const {client, sent} = runtimeStub({'us-east-2': {}})
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await adapter.setReplication(KEY_ID, {addReplicationRegions: [], removeReplicationRegions: ['us-west-2']})

        expect(sent.some((each) => each instanceof RemoveKeyReplicationRegionsCommand)).toBe(false)
    })

    test('the Regions that are gone go before the ones that come', async () => {
        const {client, sent} = runtimeStub({'us-east-2': {}, 'us-west-2': {}})
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await adapter.setReplication(KEY_ID, {addReplicationRegions: ['eu-west-1'], removeReplicationRegions: ['us-west-2']})

        // A key that replicates to as many Regions as it may would be refused a
        // fifth one, so a Region that is replaced has to be taken away first.
        const order = sent
            .filter((command) =>
                command instanceof RemoveKeyReplicationRegionsCommand ||
                command instanceof AddKeyReplicationRegionsCommand)
            .map((command) => (command instanceof RemoveKeyReplicationRegionsCommand ? 'remove' : 'add'))
        expect(order).toEqual(['remove', 'add'])
    })

    test('the Region the primary is in is refused before anything is changed', async () => {
        const {client, sent} = stubClient((command) => {
            if (command instanceof GetKeyCommand) {
                return {Key: {...key, PrimaryRegion: 'us-east-1', ReplicationStatus: {'us-east-2': {}}}}
            }
            return {}
        })
        const adapter = new AwsPaymentCryptographyAdapter(client)

        // The Regions that are gone go first, so a request that named the primary
        // would take a replica away and then fail.
        await expect(
            adapter.setReplication(KEY_ID, {
                addReplicationRegions: ['us-east-1', 'us-west-2'],
                removeReplicationRegions: [],
            }),
        ).rejects.toBeInstanceOf(ValidationError)
        expect(sent.some((command) => command instanceof RemoveKeyReplicationRegionsCommand)).toBe(false)
        expect(sent.some((command) => command instanceof AddKeyReplicationRegionsCommand)).toBe(false)
    })

    test('a replica is read-only, so the Regions of its primary are not its own to change', async () => {
        const {client, sent} = stubClient((command) => {
            if (command instanceof GetKeyCommand) {
                return {Key: {...key, MultiRegionKeyType: 'REPLICA', PrimaryRegion: 'us-east-1', ReplicationStatus: {'us-east-2': {}}}}
            }
            return {}
        })
        const adapter = new AwsPaymentCryptographyAdapter(client)

        // The reference says a Replica Region key cannot be configured to
        // replicate to other Regions, so the API refuses what it cannot do.
        await expect(
            adapter.setReplication(KEY_ID, {
                addReplicationRegions: ['us-west-2'],
                removeReplicationRegions: [],
            }),
        ).rejects.toBeInstanceOf(ValidationError)
        expect(sent.some((command) => command instanceof AddKeyReplicationRegionsCommand)).toBe(false)
        expect(sent.some((command) => command instanceof RemoveKeyReplicationRegionsCommand)).toBe(false)
    })

    test('a Region named twice is named once', async () => {
        const {client, sent} = runtimeStub({})
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await adapter.setReplication(KEY_ID, {addReplicationRegions: ['us-east-2', 'us-east-2'], removeReplicationRegions: []})

        // The same Region named twice is one Region, so the list the request
        // carries holds it once.
        const command = sent.find((each) => each instanceof AddKeyReplicationRegionsCommand)
        expect((command as AddKeyReplicationRegionsCommand).input.ReplicationRegions).toEqual(['us-east-2'])
    })

    test('a Region named in both lists is refused, whichever side the key is in', async () => {
        const {client, sent} = runtimeStub({'us-east-2': {}})
        const adapter = new AwsPaymentCryptographyAdapter(client)

        // The Region the key holds would be taken away, and the Region it does
        // not hold would be added, and which of the two happens depends on the
        // state the key is in, so the request is refused rather than resolved.
        await expect(
            adapter.setReplication(KEY_ID, {
                addReplicationRegions: ['us-east-2'],
                removeReplicationRegions: ['us-east-2'],
            }),
        ).rejects.toBeInstanceOf(ValidationError)
        await expect(
            adapter.setReplication(KEY_ID, {
                addReplicationRegions: ['eu-west-1'],
                removeReplicationRegions: ['eu-west-1'],
            }),
        ).rejects.toBeInstanceOf(ValidationError)
        expect(sent.some((each) => each instanceof AddKeyReplicationRegionsCommand)).toBe(false)
        expect(sent.some((each) => each instanceof RemoveKeyReplicationRegionsCommand)).toBe(false)
    })

    test('a name that names no Region is refused', async () => {
        const {client, sent} = runtimeStub({})
        const adapter = new AwsPaymentCryptographyAdapter(client)

        // The console's Region field is free text, so a blank name arrives.
        await expect(
            adapter.setReplication(KEY_ID, {addReplicationRegions: ['   '], removeReplicationRegions: []}),
        ).rejects.toBeInstanceOf(ValidationError)
        await expect(
            adapter.setReplication(KEY_ID, {addReplicationRegions: [], removeReplicationRegions: ['']}),
        ).rejects.toBeInstanceOf(ValidationError)
        expect(sent.some((each) => each instanceof AddKeyReplicationRegionsCommand)).toBe(false)
        expect(sent.some((each) => each instanceof RemoveKeyReplicationRegionsCommand)).toBe(false)
    })

    test('a key that is not there is refused with the reason the adapter refuses it with', async () => {
        const {client, sent} = stubClient((command) => {
            if (command instanceof GetKeyCommand) {
                throw Object.assign(new Error('The key was not found.'), {
                    name: 'ResourceNotFoundException',
                    $metadata: {httpStatusCode: 400},
                })
            }
            return {}
        })
        const adapter = new AwsPaymentCryptographyAdapter(client)

        // The raw AWS refusal would have reached the console as an error about
        // the runtime rather than as the key that is not there.
        await expect(
            adapter.setReplication(KEY_ID, {addReplicationRegions: ['us-east-2'], removeReplicationRegions: []}),
        ).rejects.toBeInstanceOf(ValidationError)
        expect(sent.some((command) => command instanceof AddKeyReplicationRegionsCommand)).toBe(false)
    })

    test('a key that may not leave is not replicated to another Region', async () => {
        const {client, sent} = stubClient((command) => {
            if (command instanceof GetKeyCommand) return {Key: {...key, Exportable: false}}
            return {}
        })
        const adapter = new AwsPaymentCryptographyAdapter(client)

        // The reference only lets an exportable key be replicated to another
        // Region, and the console states that, so the reason is given here
        // rather than by the service.
        await expect(
            adapter.setReplication(KEY_ID, {addReplicationRegions: ['us-east-2'], removeReplicationRegions: []}),
        ).rejects.toBeInstanceOf(ValidationError)
        expect(sent.some((command) => command instanceof AddKeyReplicationRegionsCommand)).toBe(false)
    })

    test('a member that is not a list of Regions is refused', async () => {
        const {client, sent} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await expect(
            adapter.setReplication(KEY_ID, {addReplicationRegions: 'us-east-2', removeReplicationRegions: []}),
        ).rejects.toBeInstanceOf(ValidationError)
        await expect(
            adapter.setReplication(KEY_ID, {addReplicationRegions: [1], removeReplicationRegions: []}),
        ).rejects.toBeInstanceOf(ValidationError)
        expect(sent.some((each) => each instanceof AddKeyReplicationRegionsCommand)).toBe(false)
    })

    test('a request that says nothing is refused, not a fault', async () => {
        const {client, sent} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await expect(adapter.setReplication(KEY_ID, null as never)).rejects.toBeInstanceOf(ValidationError)
        expect(sent.some((command) => command instanceof AddKeyReplicationRegionsCommand)).toBe(false)
    })

    test('an alias has no Regions of its own; the key it names does', async () => {
        const {client} = runtimeStub()
        const adapter = new AwsPaymentCryptographyAdapter(client)

        await expect(
            adapter.setReplication(ALIAS_ID, {
                addReplicationRegions: ['us-east-2'],
                removeReplicationRegions: [],
            }),
        ).rejects.toBeInstanceOf(ValidationError)
    })
})

describe('the helper that changes the Regions of a key', () => {
    test('a list that names no Region sends no command', async () => {
        const {client, sent} = stubClient(() => ({}))

        // The reference's own commands name the Regions they change, so a list
        // that names no Region is not a request the service can act on. The
        // helper is exported, so it does not leave the check to every caller.
        await addReplicationRegions(client, ARN, [])
        await removeReplicationRegions(client, ARN, [])

        expect(sent).toHaveLength(0)
    })
})

describe('the helper that adds and the helper that removes', () => {
    test('the Regions it is given are the ones it adds', async () => {
        const {client, sent} = stubClient(() => ({}))

        await addReplicationRegions(client, ARN, ['us-east-2'])

        // The helper does not diff for itself: the Regions it is given are the
        // ones it adds, and the caller diffs them against the ones the key holds.
        const command = sent.find((each) => each instanceof AddKeyReplicationRegionsCommand)
        expect((command as AddKeyReplicationRegionsCommand).input).toEqual({
            KeyIdentifier: ARN,
            ReplicationRegions: ['us-east-2'],
        })
        expect(sent.some((each) => each instanceof RemoveKeyReplicationRegionsCommand)).toBe(false)
    })

    test('the Regions it is given are the ones it removes', async () => {
        const {client, sent} = stubClient(() => ({}))

        await removeReplicationRegions(client, ARN, ['us-east-2'])

        const command = sent.find((each) => each instanceof RemoveKeyReplicationRegionsCommand)
        expect((command as RemoveKeyReplicationRegionsCommand).input).toEqual({
            KeyIdentifier: ARN,
            ReplicationRegions: ['us-east-2'],
        })
        expect(sent.some((each) => each instanceof AddKeyReplicationRegionsCommand)).toBe(false)
    })
})

describe('the default replication of the account', () => {
    test('is not a surface the adapter keeps', () => {
        const adapter = readFileSync(join(import.meta.dir, 'AwsPaymentCryptographyAdapter.ts'), 'utf8')
        const helper = readFileSync(join(import.meta.dir, 'paymentCryptographyReplication.ts'), 'utf8')

        // No route, service method or panel reaches the account's default
        // replication, so the methods that wrap it are unreachable code that
        // widens the adapter's surface.
        expect(adapter).not.toMatch(/defaultReplicationRegions\(\)/)
        expect(adapter).not.toMatch(/enableDefaultReplicationRegions/)
        expect(adapter).not.toMatch(/disableDefaultReplicationRegions/)
        expect(helper).not.toMatch(/DefaultKeyReplicationRegionsCommand/)
    })
})
