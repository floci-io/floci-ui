import {beforeEach, describe, expect, mock, test} from 'bun:test'
import * as realAws from '../aws'

// Unlike secretsmanager.ts (which imports a singleton client), logs.ts must
// resolve its CloudWatch Logs client per-request via awsClientsForAccount so
// the route respects the active-account header. The stub below is therefore
// a function, not a plain object, and it records the account id it was
// called with so tests can assert the route actually forwarded it -- a mock
// that ignored its argument would pass whether or not the header is honored.
//
// logs.ts also imports ACCOUNT_HEADER from './clouds', which transitively
// pulls in cloudProxy and several other adapters that import unrelated
// bindings (awsClients, s3, lambda, rds, resolveAccountId, ...) from
// '../aws'. Those bindings are never exercised by this route, but they must
// still resolve, so the mock spreads the real module and overrides only
// awsClientsForAccount -- the one binding under test.
let lastCommand: {constructor: {name: string}; input: Record<string, unknown>} | null = null
let lastAccountId: string | null | undefined = 'NEVER_CALLED'
let responder: (commandName: string, command: {input: Record<string, unknown>}) => unknown

mock.module('../aws', () => ({
    ...realAws,
    awsClientsForAccount: (accountId?: string | null) => {
        lastAccountId = accountId
        return {
            cloudWatchLogs: {
                async send(command: {constructor: {name: string}; input: Record<string, unknown>}) {
                    lastCommand = command
                    return responder(command.constructor.name, command)
                },
            },
        }
    },
}))

// Imported after the mock is registered so the route binds to the stubbed client.
const {default: app} = await import('./logs')

beforeEach(() => {
    lastCommand = null
    lastAccountId = 'NEVER_CALLED'
    responder = () => ({logGroups: []})
})

describe('GET /groups', () => {
    test('returns the mapped groups from DescribeLogGroupsCommand', async () => {
        responder = () => ({
            logGroups: [
                {
                    logGroupName: '/aws/lambda/foo',
                    arn: 'arn:aws:logs:us-east-1:111111111111:log-group:/aws/lambda/foo:*',
                    creationTime: 1700000000000,
                    retentionInDays: 14,
                    kmsKeyId: 'arn:aws:kms:us-east-1:111111111111:key/abc',
                },
            ],
        })

        const res = await app.request('/groups')
        expect(res.status).toBe(200)
        const body = await res.json()

        expect(body).toEqual([
            {
                name: '/aws/lambda/foo',
                arn: 'arn:aws:logs:us-east-1:111111111111:log-group:/aws/lambda/foo:*',
                creationTime: new Date(1700000000000).toISOString(),
                retentionInDays: 14,
                kmsKeyId: 'arn:aws:kms:us-east-1:111111111111:key/abc',
            },
        ])
    })

    test('forwards prefix as logGroupNamePrefix on the command input', async () => {
        await app.request('/groups?prefix=/aws/lambda/')

        expect(lastCommand?.input.logGroupNamePrefix).toBe('/aws/lambda/')
    })

    test('account forwarding: header value reaches awsClientsForAccount, and its absence does not', async () => {
        await app.request('/groups', {headers: {'x-floci-account-id': '111111111111'}})
        expect(lastAccountId).toBe('111111111111')

        await app.request('/groups')
        expect(lastAccountId).not.toBe('111111111111')
    })

    test('account query param is honored when the header is absent, and the header wins when both are present', async () => {
        await app.request('/groups?account=222222222222')
        expect(lastAccountId).toBe('222222222222')

        await app.request('/groups?account=222222222222', {
            headers: {'x-floci-account-id': '333333333333'},
        })
        expect(lastAccountId).toBe('333333333333')
    })

    test('an empty logGroups array yields an empty list, not an error', async () => {
        responder = () => ({logGroups: []})

        const res = await app.request('/groups')
        expect(res.status).toBe(200)
        const body = await res.json()

        expect(body).toEqual([])
    })
})

describe('GET /streams', () => {
    test('returns the mapped streams from DescribeLogStreamsCommand', async () => {
        responder = () => ({
            logStreams: [
                {
                    logStreamName: '2024/01/01/[$LATEST]abc123',
                    arn: 'arn:aws:logs:us-east-1:111111111111:log-group:/aws/lambda/foo:log-stream:2024/01/01/[$LATEST]abc123',
                    creationTime: 1700000000000,
                    firstEventTimestamp: 1700000001000,
                    lastEventTimestamp: 1700000002000,
                    storedBytes: 4096,
                },
            ],
        })

        const res = await app.request('/streams?group=/aws/lambda/foo')
        expect(res.status).toBe(200)
        const body = await res.json()

        expect(body).toEqual({
            streams: [
                {
                    name: '2024/01/01/[$LATEST]abc123',
                    arn: 'arn:aws:logs:us-east-1:111111111111:log-group:/aws/lambda/foo:log-stream:2024/01/01/[$LATEST]abc123',
                    creationTime: new Date(1700000000000).toISOString(),
                    firstEventTimestamp: new Date(1700000001000).toISOString(),
                    lastEventTimestamp: new Date(1700000002000).toISOString(),
                    storedBytes: 4096,
                },
            ],
        })
    })

    test('forwards group as logGroupName on the command input', async () => {
        await app.request('/streams?group=/aws/lambda/foo')

        expect(lastCommand?.input.logGroupName).toBe('/aws/lambda/foo')
    })

    test('rejects a missing group with 400 instead of calling the SDK', async () => {
        const res = await app.request('/streams')
        expect(res.status).toBe(400)
        expect(await res.json()).toEqual({error: 'group is required'})
        expect(lastCommand).toBeNull()
    })

    test('account forwarding: header value reaches awsClientsForAccount, and its absence does not', async () => {
        await app.request('/streams?group=/aws/lambda/foo', {headers: {'x-floci-account-id': '111111111111'}})
        expect(lastAccountId).toBe('111111111111')

        await app.request('/streams?group=/aws/lambda/foo')
        expect(lastAccountId).not.toBe('111111111111')
    })

    test('account query param is honored when the header is absent, and the header wins when both are present', async () => {
        await app.request('/streams?group=/aws/lambda/foo&account=222222222222')
        expect(lastAccountId).toBe('222222222222')

        await app.request('/streams?group=/aws/lambda/foo&account=222222222222', {
            headers: {'x-floci-account-id': '333333333333'},
        })
        expect(lastAccountId).toBe('333333333333')
    })

    test('an empty logStreams array yields an empty list, not an error', async () => {
        responder = () => ({logStreams: []})

        const res = await app.request('/streams?group=/aws/lambda/foo')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({streams: []})
    })
})

describe('GET /events', () => {
    test('returns the mapped events from GetLogEventsCommand', async () => {
        responder = () => ({
            events: [
                {timestamp: 1700000001000, message: 'START RequestId: abc'},
                {timestamp: 1700000002000, message: 'END RequestId: abc'},
            ],
            nextForwardToken: 'f/next-token',
            nextBackwardToken: 'b/prev-token',
        })

        const res = await app.request('/events?group=/aws/lambda/foo&stream=2024/01/01/[$LATEST]abc123')
        expect(res.status).toBe(200)
        const body = await res.json()

        expect(body).toEqual({
            events: [
                {timestamp: new Date(1700000001000).toISOString(), message: 'START RequestId: abc'},
                {timestamp: new Date(1700000002000).toISOString(), message: 'END RequestId: abc'},
            ],
            nextToken: 'f/next-token',
        })
    })

    test('forwards group and stream on the command input', async () => {
        await app.request('/events?group=/aws/lambda/foo&stream=2024/01/01/[$LATEST]abc123')

        expect(lastCommand?.input.logGroupName).toBe('/aws/lambda/foo')
        expect(lastCommand?.input.logStreamName).toBe('2024/01/01/[$LATEST]abc123')
    })

    test('forwards a caller-supplied nextToken on the command input', async () => {
        await app.request('/events?group=/aws/lambda/foo&stream=s1&nextToken=f/prior-token')

        expect(lastCommand?.input.nextToken).toBe('f/prior-token')
    })

    test('rejects a missing group with 400 instead of calling the SDK', async () => {
        const res = await app.request('/events?stream=s1')
        expect(res.status).toBe(400)
        expect(await res.json()).toEqual({error: 'group is required'})
        expect(lastCommand).toBeNull()
    })

    test('rejects a missing stream with 400 instead of calling the SDK', async () => {
        const res = await app.request('/events?group=/aws/lambda/foo')
        expect(res.status).toBe(400)
        expect(await res.json()).toEqual({error: 'stream is required'})
        expect(lastCommand).toBeNull()
    })

    test('collapses nextToken to undefined when CloudWatch echoes the requested token back (end of stream)', async () => {
        responder = () => ({
            events: [{timestamp: 1700000001000, message: 'only event'}],
            nextForwardToken: 'f/same-token',
        })

        const res = await app.request('/events?group=/aws/lambda/foo&stream=s1&nextToken=f/same-token')
        const body = await res.json()

        expect(body.nextToken).toBeUndefined()
    })

    test('an empty events array yields no nextToken, even though CloudWatch still returns a fresh forward token', async () => {
        responder = () => ({events: [], nextForwardToken: 'f/fresh-token'})

        const res = await app.request('/events?group=/aws/lambda/foo&stream=s1')
        const body = await res.json()

        expect(body).toEqual({events: [], nextToken: undefined})
    })

    test('account forwarding: header value reaches awsClientsForAccount, and its absence does not', async () => {
        await app.request('/events?group=/aws/lambda/foo&stream=s1', {headers: {'x-floci-account-id': '111111111111'}})
        expect(lastAccountId).toBe('111111111111')

        await app.request('/events?group=/aws/lambda/foo&stream=s1')
        expect(lastAccountId).not.toBe('111111111111')
    })
})
