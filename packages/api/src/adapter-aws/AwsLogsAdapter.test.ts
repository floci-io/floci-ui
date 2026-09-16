import {describe, expect, test} from 'bun:test'
import {AwsLogsAdapter} from './AwsLogsAdapter'

/**
 * Stubs the SDK client's `send`, dispatching on the command's constructor name.
 * Matching the real SDK's *name* rather than the wire shape is deliberate — see
 * .claude/memory/aws-sdk-error-names-differ-from-wire-codes.md.
 */
function stubClient(handlers: Record<string, (input: Record<string, unknown>) => unknown>) {
    const calls: Array<{command: string; input: Record<string, unknown>}> = []
    const client = {
        async send(command: {constructor: {name: string}; input: Record<string, unknown>}) {
            const name = command.constructor.name
            calls.push({command: name, input: command.input})
            const handler = handlers[name]
            if (!handler) throw new Error(`unexpected command ${name}`)
            return handler(command.input)
        },
    }
    return {client: client as never, calls}
}

describe('AwsLogsAdapter resources', () => {
    test('normalizes log groups as cloud resources', async () => {
        const {client} = stubClient({
            DescribeLogGroupsCommand: () => ({
                logGroups: [{
                    logGroupName: '/floci/probe',
                    creationTime: 1785260691820,
                    arn: 'arn:aws:logs:us-east-1:000000000000:log-group:/floci/probe',
                    storedBytes: 0,
                    metricFilterCount: 0,
                }],
            }),
        })
        const adapter = new AwsLogsAdapter(client)

        await expect(adapter.list()).resolves.toMatchObject([{
            id: '/floci/probe',
            name: '/floci/probe',
            cloud: 'aws',
            service: 'logs',
            type: 'log-group',
            createdAt: new Date(1785260691820).toISOString(),
        }])
    })

    // The runtime filters natively by prefix, so `search` must not be a
    // client-side contains — that would silently disagree with the field label.
    test('search is sent as logGroupNamePrefix', async () => {
        const {client, calls} = stubClient({DescribeLogGroupsCommand: () => ({logGroups: []})})
        const adapter = new AwsLogsAdapter(client)

        await adapter.list({search: '/floci'})

        expect(calls[0].input).toMatchObject({logGroupNamePrefix: '/floci'})
    })

    test('get returns null for a group the runtime does not have', async () => {
        const {client} = stubClient({DescribeLogGroupsCommand: () => ({logGroups: []})})
        const adapter = new AwsLogsAdapter(client)

        await expect(adapter.get('/nope')).resolves.toBeNull()
    })

    // DescribeLogGroups is a prefix match, so a longer name starting with the
    // requested one would otherwise be returned as if it were an exact hit.
    test('get matches the name exactly, not by prefix', async () => {
        const {client} = stubClient({
            DescribeLogGroupsCommand: () => ({logGroups: [{logGroupName: '/floci/probe-two', creationTime: 1}]}),
        })
        const adapter = new AwsLogsAdapter(client)

        await expect(adapter.get('/floci/probe')).resolves.toBeNull()
    })

    test('create and delete issue the right commands', async () => {
        const {client, calls} = stubClient({
            CreateLogGroupCommand: () => ({}),
            DeleteLogGroupCommand: () => ({}),
            DescribeLogGroupsCommand: () => ({logGroups: [{logGroupName: '/floci/new', creationTime: 1}]}),
        })
        const adapter = new AwsLogsAdapter(client)

        await expect(adapter.create({values: {name: '/floci/new'}})).resolves.toMatchObject({id: '/floci/new'})
        await adapter.delete('/floci/new')

        expect(calls.map((call) => call.command)).toEqual([
            'CreateLogGroupCommand',
            'DescribeLogGroupsCommand',
            'DeleteLogGroupCommand',
        ])
    })

    /**
     * `creationTime` is the field the SDK models and real AWS returns. The
     * local runtime sends `createdTime`, which the SDK deserializer discards —
     * so createdAt is legitimately null against the emulator, and a stub that
     * feeds `createdTime` is testing a shape the SDK can never produce. That
     * mistake shipped here once already; this pins the real contract.
     */
    test('reads the creation timestamp the SDK actually models', async () => {
        const {client} = stubClient({
            DescribeLogGroupsCommand: () => ({logGroups: [{logGroupName: '/a', creationTime: 1785260691820}]}),
        })

        await expect(new AwsLogsAdapter(client).list()).resolves.toMatchObject([
            {createdAt: new Date(1785260691820).toISOString()},
        ])
    })

    test('a group with no modelled timestamp reports null rather than a bogus date', async () => {
        const {client} = stubClient({
            DescribeLogGroupsCommand: () => ({logGroups: [{logGroupName: '/a'}]}),
        })

        await expect(new AwsLogsAdapter(client).list()).resolves.toMatchObject([{createdAt: null}])
    })

    test('create rejects a blank name before calling the runtime', async () => {
        const {client, calls} = stubClient({})
        const adapter = new AwsLogsAdapter(client)

        await expect(adapter.create({values: {name: '  '}})).rejects.toThrow()
        expect(calls).toEqual([])
    })
})

describe('AwsLogsAdapter documents', () => {
    test('lists log streams as collections, newest activity first', async () => {
        const {client, calls} = stubClient({
            DescribeLogStreamsCommand: () => ({
                logStreams: [{
                    logStreamName: 'stream-a',
                    arn: 'arn:aws:logs:us-east-1:000000000000:log-group:/floci/probe:log-stream:stream-a',
                    creationTime: 1785260702176,
                    storedBytes: 70,
                    firstEventTimestamp: 1785260000000,
                    lastEventTimestamp: 1785260001000,
                }],
                nextToken: 'page-2',
            }),
        })
        const adapter = new AwsLogsAdapter(client)

        const page = await adapter.documents.listCollections('/floci/probe')

        expect(page).toMatchObject({
            items: [{id: 'stream-a', name: 'stream-a', parentId: '/floci/probe'}],
            nextCursor: 'page-2',
        })
        expect(calls[0].input).toMatchObject({
            logGroupName: '/floci/probe',
            orderBy: 'LastEventTime',
            descending: true,
        })
    })

    /**
     * Real AWS caps DescribeLogStreams Limit at 50 and rejects anything higher
     * with a ValidationException. The SPI defaults to 100 and permits 1000, and
     * the local runtime does not enforce the cap — so an unclamped value passes
     * every local test and 400s in production. Encode the provider's rule.
     */
    test('clamps the stream page size to the AWS maximum of 50', async () => {
        const {client, calls} = stubClient({DescribeLogStreamsCommand: () => ({logStreams: []})})
        const adapter = new AwsLogsAdapter(client)

        await adapter.documents.listCollections('/floci/probe')
        await adapter.documents.listCollections('/floci/probe', {limit: 1000})
        await adapter.documents.listCollections('/floci/probe', {limit: 25})

        expect(calls.map((call) => call.input.limit)).toEqual([50, 50, 25])
    })

    test('reads log events as items, oldest first', async () => {
        const {client, calls} = stubClient({
            GetLogEventsCommand: () => ({
                events: [
                    {timestamp: 1785260000000, message: 'hello one', ingestionTime: 1785260702192},
                    {timestamp: 1785260001000, message: 'hello two', ingestionTime: 1785260702192},
                ],
                nextForwardToken: 'f/2',
                nextBackwardToken: 'b/0',
            }),
        })
        const adapter = new AwsLogsAdapter(client)

        const page = await adapter.documents.listItems('/floci/probe', 'stream-a')

        // Real AWS gives events no id, so it is derived from timestamp and
        // position. Two events sharing a millisecond still get distinct ids.
        expect(page.items).toMatchObject([
            {
                id: '1785260000000-0',
                collectionId: 'stream-a',
                timestamp: new Date(1785260000000).toISOString(),
                body: {message: 'hello one'},
            },
            {id: '1785260001000-1', collectionId: 'stream-a'},
        ])
        expect(page.nextCursor).toBe('f/2')
        // Without startFromHead the runtime returns the newest page, so paging
        // forward from a fresh cursor would skip the history.
        expect(calls[0].input).toMatchObject({startFromHead: true})
    })

    /**
     * The termination rule. GetLogEvents echoes the supplied token back when
     * there is nothing further, so a cursor loop that trusts a non-null token
     * never ends. Verified against the runtime on 2026-07-28.
     */
    test('stops paging when the runtime echoes the cursor back', async () => {
        const {client} = stubClient({
            GetLogEventsCommand: () => ({events: [], nextForwardToken: 'f/2', nextBackwardToken: 'b/2'}),
        })
        const adapter = new AwsLogsAdapter(client)

        const page = await adapter.documents.listItems('/floci/probe', 'stream-a', {cursor: 'f/2'})

        expect(page.items).toEqual([])
        expect(page.nextCursor).toBeNull()
    })

    test('an empty first page terminates too', async () => {
        const {client} = stubClient({
            GetLogEventsCommand: () => ({events: [], nextForwardToken: 'f/0', nextBackwardToken: 'b/0'}),
        })
        const adapter = new AwsLogsAdapter(client)

        await expect(adapter.documents.listItems('/floci/probe', 'stream-a')).resolves.toMatchObject({nextCursor: null})
    })

    test('creates and deletes a log stream', async () => {
        const {client, calls} = stubClient({
            CreateLogStreamCommand: () => ({}),
            DeleteLogStreamCommand: () => ({}),
            DescribeLogStreamsCommand: () => ({
                logStreams: [{logStreamName: 'stream-b', creationTime: 1785260702176}],
            }),
        })
        const adapter = new AwsLogsAdapter(client)

        await expect(adapter.documents.createCollection!('/floci/probe', {values: {name: 'stream-b'}}))
            .resolves.toMatchObject({id: 'stream-b', parentId: '/floci/probe'})
        await adapter.documents.deleteCollection!('/floci/probe', 'stream-b')

        expect(calls.map((call) => call.command)).toEqual([
            'CreateLogStreamCommand',
            'DescribeLogStreamsCommand',
            'DeleteLogStreamCommand',
        ])
    })

    // Provider behaviour, verified: a missing group raises, a missing stream
    // returns an empty page. The contract mirrors that rather than smoothing it.
    test('a missing stream yields an empty page rather than an error', async () => {
        const {client} = stubClient({
            GetLogEventsCommand: () => ({events: [], nextForwardToken: 'f/0', nextBackwardToken: 'b/0'}),
        })
        const adapter = new AwsLogsAdapter(client)

        await expect(adapter.documents.listItems('/floci/probe', 'nope')).resolves.toEqual({items: [], nextCursor: null})
    })

    test('the store advertises no item writes', () => {
        const {client} = stubClient({})
        const adapter = new AwsLogsAdapter(client)

        expect(adapter.documents.putItem).toBeUndefined()
        expect(adapter.documents.deleteItem).toBeUndefined()
        expect(adapter.documents.queryItems).toBeUndefined()
    })
})
