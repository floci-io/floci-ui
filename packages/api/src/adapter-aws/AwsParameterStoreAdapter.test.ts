import {describe, expect, test} from 'bun:test'
import {
    AddTagsToResourceCommand,
    DeleteParameterCommand,
    DescribeParametersCommand,
    ListTagsForResourceCommand,
    PutParameterCommand,
    RemoveTagsFromResourceCommand,
    type SSMClient,
} from '@aws-sdk/client-ssm'
import {AwsParameterStoreAdapter} from './AwsParameterStoreAdapter'
import {ValidationError} from '../cloud-spi/errors'

type SendResult = Record<string, unknown>

/** Minimal SSMClient stub that records the commands it was sent. */
function stubSsm(handler: (command: object) => SendResult | Promise<SendResult>) {
    const sent: object[] = []
    const client = {
        async send(command: object) {
            sent.push(command)
            return handler(command)
        },
    } as unknown as SSMClient
    return {client, sent}
}

const plain = {
    Name: '/floci/app/region',
    Type: 'String',
    Version: 1,
    LastModifiedDate: new Date('2026-07-28T10:00:00.000Z'),
    Description: 'deployment region',
    DataType: 'text',
    Tier: 'Standard',
}

const secure = {
    Name: '/floci/app/token',
    Type: 'SecureString',
    Version: 3,
    LastModifiedDate: new Date('2026-07-28T11:00:00.000Z'),
    DataType: 'text',
}

function runtimeStub(overrides: {describe?: SendResult; tags?: SendResult} = {}) {
    return stubSsm((command) => {
        if (command instanceof DescribeParametersCommand) {
            return overrides.describe ?? {Parameters: [plain, secure]}
        }
        if (command instanceof ListTagsForResourceCommand) {
            return overrides.tags ?? {TagList: []}
        }
        if (command instanceof PutParameterCommand) return {Version: 1}
        return {}
    })
}

describe('AwsParameterStoreAdapter', () => {
    test('identifies itself as the AWS Parameter Store adapter', () => {
        const adapter = new AwsParameterStoreAdapter(runtimeStub().client)

        expect(adapter.cloud).toBe('aws')
        expect(adapter.service).toBe('parameters')
        expect(adapter.schema().displayName).toBe('SSM Parameter Store')
    })

    test('lists parameters with their metadata', async () => {
        const {client, sent} = runtimeStub()
        const resources = await new AwsParameterStoreAdapter(client).list()

        expect(sent[0]).toBeInstanceOf(DescribeParametersCommand)
        expect(resources).toHaveLength(2)
        expect(resources[0]).toMatchObject({
            id: '/floci/app/region',
            name: '/floci/app/region',
            cloud: 'aws',
            service: 'parameters',
            type: 'parameter',
            createdAt: '2026-07-28T10:00:00.000Z',
        })
        expect(resources[0]?.metadata).toMatchObject({
            parameterType: 'String',
            version: 1,
            description: 'deployment region',
            dataType: 'text',
            tier: 'Standard',
        })
    })

    test('never exposes a parameter value, not even for a plain String', async () => {
        // metadata reaches the inspector, the query cache and telemetry, so a
        // value must not travel with the resource. This is the same rule both
        // secrets adapters pin, and it matters more here: the local runtime
        // returns SecureString plaintext even without WithDecryption, so relying
        // on the runtime to withhold it would leak.
        const {client, sent} = runtimeStub()
        const adapter = new AwsParameterStoreAdapter(client)

        const resources = await adapter.list()
        const inspected = await adapter.get('/floci/app/token')

        for (const resource of [...resources, inspected]) {
            expect(JSON.stringify(resource)).not.toContain('Value')
            expect(resource?.metadata.value).toBeUndefined()
        }
        // The value is never even requested.
        expect(sent.every((command) => command.constructor.name !== 'GetParameterCommand')).toBe(true)
    })

    test('marks that the value is withheld so the UI can explain the empty field', async () => {
        const {client} = runtimeStub()
        const [resource] = await new AwsParameterStoreAdapter(client).list()

        expect(resource?.metadata.valueWithheld).toBe(true)
    })

    test('follows NextToken until the runtime stops paging', async () => {
        // The local runtime ignores MaxResults and returns everything in one
        // response, so only a stub can prove the loop works. Real SSM pages at 10.
        let call = 0
        const {client, sent} = stubSsm((command) => {
            if (command instanceof ListTagsForResourceCommand) return {TagList: []}
            call += 1
            if (call === 1) return {Parameters: [plain], NextToken: 'page-2'}
            if (call === 2) return {Parameters: [secure], NextToken: 'page-3'}
            return {Parameters: [{...plain, Name: '/floci/app/third'}]}
        })

        const resources = await new AwsParameterStoreAdapter(client).list()

        expect(resources.map((r) => r.id)).toEqual(['/floci/app/region', '/floci/app/token', '/floci/app/third'])
        const describes = sent.filter((c) => c instanceof DescribeParametersCommand) as DescribeParametersCommand[]
        expect(describes).toHaveLength(3)
        expect(describes[1]?.input.NextToken).toBe('page-2')
        expect(describes[2]?.input.NextToken).toBe('page-3')
    })

    test('filters the list by name or description', async () => {
        const adapter = new AwsParameterStoreAdapter(runtimeStub().client)

        await expect(adapter.list({search: 'token'})).resolves.toHaveLength(1)
        await expect(adapter.list({search: 'deployment'})).resolves.toHaveLength(1)
        await expect(adapter.list({search: 'nope'})).resolves.toHaveLength(0)
    })

    test('inspects a parameter through a server-side name filter', async () => {
        const {client, sent} = runtimeStub({describe: {Parameters: [plain]}})
        const resource = await new AwsParameterStoreAdapter(client).get('/floci/app/region')

        const command = sent[0] as DescribeParametersCommand
        expect(command).toBeInstanceOf(DescribeParametersCommand)
        expect(command.input.ParameterFilters).toEqual([
            {Key: 'Name', Option: 'Equals', Values: ['/floci/app/region']},
        ])
        expect(resource?.id).toBe('/floci/app/region')
    })

    test('returns null when the name filter matches nothing', async () => {
        const {client} = runtimeStub({describe: {Parameters: []}})
        await expect(new AwsParameterStoreAdapter(client).get('/nope')).resolves.toBeNull()
    })

    test('returns null on ParameterNotFound even though the runtime answers 400', async () => {
        // SSM reports a missing parameter as ParameterNotFound with HTTP 400, not
        // 404, so matching on the status alone would rethrow instead of returning
        // null and the inspector would show a runtime error for a missing row.
        const {client} = stubSsm(() => {
            throw Object.assign(new Error('Parameter /nope not found.'), {
                name: 'ParameterNotFound',
                $metadata: {httpStatusCode: 400},
            })
        })
        await expect(new AwsParameterStoreAdapter(client).get('/nope')).resolves.toBeNull()
    })

    test('rethrows a failure that is not a missing parameter', async () => {
        const {client} = stubSsm(() => {
            throw Object.assign(new Error('AccessDenied'), {
                name: 'AccessDeniedException',
                $metadata: {httpStatusCode: 403},
            })
        })
        await expect(new AwsParameterStoreAdapter(client).get('/floci/app/region')).rejects.toThrow('AccessDenied')
    })

    test('creates a parameter without Overwrite so an existing name is a conflict', async () => {
        // Overwrite:true would silently replace a parameter the user did not mean
        // to touch, which is data loss dressed up as a create.
        const {client, sent} = runtimeStub({describe: {Parameters: [plain]}})
        await new AwsParameterStoreAdapter(client).create({
            values: {name: '/floci/app/region', value: 'eu-west-1', type: 'String', description: 'deployment region'},
        })

        const command = sent[0] as PutParameterCommand
        expect(command).toBeInstanceOf(PutParameterCommand)
        expect(command.input.Name).toBe('/floci/app/region')
        expect(command.input.Value).toBe('eu-west-1')
        expect(command.input.Type).toBe('String')
        expect(command.input.Overwrite).toBeUndefined()
    })

    test('returns the created parameter without echoing the value back', async () => {
        const {client} = runtimeStub({describe: {Parameters: [plain]}})
        const resource = await new AwsParameterStoreAdapter(client).create({
            values: {name: '/floci/app/region', value: 'eu-west-1', type: 'String'},
        })

        expect(resource.id).toBe('/floci/app/region')
        expect(JSON.stringify(resource)).not.toContain('eu-west-1')
    })

    test('requires the fields the schema marks required', async () => {
        const adapter = new AwsParameterStoreAdapter(runtimeStub().client)

        const cases: Array<[Record<string, unknown>, string]> = [
            [{}, 'name is required'],
            [{name: '/floci/app/region'}, 'value is required'],
        ]

        for (const [values, message] of cases) {
            await expect(adapter.create({values})).rejects.toThrow(new ValidationError(message))
        }
    })

    test('rejects a parameter type the schema does not offer', async () => {
        const adapter = new AwsParameterStoreAdapter(runtimeStub().client)

        await expect(
            adapter.create({values: {name: '/a', value: 'b', type: 'Encrypted'}}),
        ).rejects.toThrow(ValidationError)
    })

    test('deletes a parameter by name', async () => {
        const {client, sent} = stubSsm(() => ({}))
        await new AwsParameterStoreAdapter(client).delete('/floci/app/region')

        const command = sent[0] as DeleteParameterCommand
        expect(command).toBeInstanceOf(DeleteParameterCommand)
        expect(command.input.Name).toBe('/floci/app/region')
    })

    test('surfaces parameter tags under metadata', async () => {
        const {client} = runtimeStub({
            describe: {Parameters: [plain]},
            tags: {TagList: [{Key: 'env', Value: 'prod'}]},
        })
        const [resource] = await new AwsParameterStoreAdapter(client).list()

        expect(resource?.metadata.tags).toEqual([{key: 'env', value: 'prod'}])
    })

    test('still lists parameters when the tag lookup fails', async () => {
        // list() builds every row through Promise.all, so an unisolated tag
        // failure — throttling, transient IAM, a delete race — would reject the
        // whole view and show nothing rather than metadata without tags.
        const {client} = stubSsm((command) => {
            if (command instanceof DescribeParametersCommand) return {Parameters: [plain]}
            throw Object.assign(new Error('Rate exceeded'), {
                name: 'ThrottlingException',
                $metadata: {httpStatusCode: 400},
            })
        })

        const [resource] = await new AwsParameterStoreAdapter(client).list()

        expect(resource?.id).toBe('/floci/app/region')
        expect(resource?.metadata.tags).toEqual([])
        // Degraded, not silent: the UI can say tags could not be read.
        expect(resource?.metadata.tagsUnavailable).toBe(true)
    })

    test('does not claim tags are unavailable when they are simply empty', async () => {
        const {client} = runtimeStub({describe: {Parameters: [plain]}, tags: {TagList: []}})
        const [resource] = await new AwsParameterStoreAdapter(client).list()

        expect(resource?.metadata.tags).toEqual([])
        expect(resource?.metadata.tagsUnavailable).toBeUndefined()
    })

    test('adds and removes tags against the Parameter resource type', async () => {
        const {client, sent} = stubSsm(() => ({}))
        await new AwsParameterStoreAdapter(client).updateTags('/floci/app/region', {env: 'prod', stale: null})

        const added = sent.find((c) => c instanceof AddTagsToResourceCommand) as AddTagsToResourceCommand
        const removed = sent.find((c) => c instanceof RemoveTagsFromResourceCommand) as RemoveTagsFromResourceCommand

        expect(added.input.ResourceType).toBe('Parameter')
        expect(added.input.ResourceId).toBe('/floci/app/region')
        expect(added.input.Tags).toEqual([{Key: 'env', Value: 'prod'}])
        expect(removed.input.TagKeys).toEqual(['stale'])
    })

    test('skips the tag call when it has nothing to send', async () => {
        const {client, sent} = stubSsm(() => ({}))
        await new AwsParameterStoreAdapter(client).updateTags('/floci/app/region', {env: 'prod'})

        expect(sent.some((c) => c instanceof RemoveTagsFromResourceCommand)).toBe(false)
    })
})
