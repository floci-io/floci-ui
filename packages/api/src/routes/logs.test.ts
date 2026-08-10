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
