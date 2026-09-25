import {describe, expect, test} from 'bun:test'
import {
    CreateUserPoolCommand,
    DeleteUserPoolCommand,
    DescribeUserPoolCommand,
    ListUserPoolsCommand,
    type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import {ValidationError} from '../cloud-spi/errors'
import {AwsCognitoAdapter} from './AwsCognitoAdapter'

type SendResult = Record<string, unknown>

function stubCognito(handler: (command: object) => SendResult | Promise<SendResult>) {
    const sent: object[] = []
    const client = {
        async send(command: object) {
            sent.push(command)
            return handler(command)
        },
    } as unknown as CognitoIdentityProviderClient
    return {client, sent}
}

const POOL_ID = 'us-east-1_AbCdEf123'
const SUMMARY = {
    Id: POOL_ID,
    Name: 'orders',
    Status: 'Enabled',
    CreationDate: new Date('2026-09-18T09:30:00.000Z'),
    LastModifiedDate: new Date('2026-09-18T10:30:00.000Z'),
}

const DETAILED = {
    ...SUMMARY,
    Arn: `arn:aws:cognito-idp:us-east-1:000000000000:userpool/${POOL_ID}`,
    DeletionProtection: 'INACTIVE',
    EstimatedNumberOfUsers: 3,
    UsernameAttributes: ['email'],
    AutoVerifiedAttributes: ['email'],
}

describe('AwsCognitoAdapter', () => {
    test('identifies itself as the AWS Cognito adapter', () => {
        const adapter = new AwsCognitoAdapter(stubCognito(() => ({})).client)

        expect(adapter.cloud).toBe('aws')
        expect(adapter.service).toBe('cognito')
        expect(adapter.schema()).toMatchObject({
            cloud: 'aws',
            service: 'cognito',
            displayName: 'Amazon Cognito user pools',
            actions: ['list', 'create', 'delete', 'inspect'],
        })
    })

    test('lists every page and maps user pool summaries', async () => {
        let page = 0
        const {client, sent} = stubCognito((command) => {
            expect(command).toBeInstanceOf(ListUserPoolsCommand)
            page += 1
            if (page === 1) return {UserPools: [SUMMARY], NextToken: 'page-2'}
            return {UserPools: [{...SUMMARY, Id: 'eu-west-1_ZyXwVu987', Name: 'refunds'}]}
        })

        const resources = await new AwsCognitoAdapter(client).list()

        expect(resources).toHaveLength(2)
        expect(resources[0]).toMatchObject({
            id: POOL_ID,
            name: 'orders',
            cloud: 'aws',
            service: 'cognito',
            type: 'user-pool',
            region: 'us-east-1',
            createdAt: '2026-09-18T09:30:00.000Z',
            status: 'Enabled',
        })
        expect(resources[0]?.metadata.lastModifiedAt).toBe('2026-09-18T10:30:00.000Z')
        expect((sent[0] as ListUserPoolsCommand).input).toEqual({MaxResults: 60, NextToken: undefined})
        expect((sent[1] as ListUserPoolsCommand).input).toEqual({MaxResults: 60, NextToken: 'page-2'})
    })

    test('filters user pools by name and ID', async () => {
        const {client} = stubCognito(() => ({
            UserPools: [SUMMARY, {...SUMMARY, Id: 'us-east-1_Second', Name: 'refunds'}],
        }))
        const adapter = new AwsCognitoAdapter(client)

        await expect(adapter.list({search: 'ORD'})).resolves.toHaveLength(1)
        await expect(adapter.list({search: 'Second'})).resolves.toHaveLength(1)
        await expect(adapter.list({search: 'missing'})).resolves.toHaveLength(0)
    })

    test('inspects a user pool and surfaces detailed metadata', async () => {
        const {client, sent} = stubCognito((command) => {
            expect(command).toBeInstanceOf(DescribeUserPoolCommand)
            return {UserPool: DETAILED}
        })

        const resource = await new AwsCognitoAdapter(client).get(POOL_ID)

        expect((sent[0] as DescribeUserPoolCommand).input.UserPoolId).toBe(POOL_ID)
        expect(resource).toMatchObject({id: POOL_ID, region: 'us-east-1', status: 'Enabled'})
        expect(resource?.metadata).toMatchObject({
            arn: DETAILED.Arn,
            deletionProtection: 'INACTIVE',
            estimatedNumberOfUsers: 3,
            usernameAttributes: ['email'],
        })
    })

    test('returns null when Cognito reports a missing user pool', async () => {
        const {client} = stubCognito(() => {
            throw Object.assign(new Error('User pool not found.'), {
                name: 'ResourceNotFoundException',
                $metadata: {httpStatusCode: 400},
            })
        })

        await expect(new AwsCognitoAdapter(client).get('missing')).resolves.toBeNull()
    })

    test('rethrows failures that are not missing resources', async () => {
        const {client} = stubCognito(() => {
            throw Object.assign(new Error('AccessDenied'), {name: 'AccessDeniedException'})
        })

        await expect(new AwsCognitoAdapter(client).get(POOL_ID)).rejects.toThrow('AccessDenied')
    })

    test('creates a user pool with the provider request shape', async () => {
        const {client, sent} = stubCognito((command) => {
            expect(command).toBeInstanceOf(CreateUserPoolCommand)
            return {UserPool: DETAILED}
        })

        const resource = await new AwsCognitoAdapter(client).create({values: {poolName: ' orders '}})

        expect((sent[0] as CreateUserPoolCommand).input).toEqual({PoolName: ' orders '})
        expect(resource.id).toBe(POOL_ID)
    })

    test('requires a valid user pool name before calling Cognito', async () => {
        let called = false
        const {client} = stubCognito(() => {
            called = true
            return {}
        })
        const adapter = new AwsCognitoAdapter(client)

        await expect(adapter.create({values: {}})).rejects.toThrow(new ValidationError('poolName is required'))
        await expect(adapter.create({values: {poolName: 'name/with/slashes'}})).rejects.toThrow(ValidationError)
        await expect(adapter.create({values: {poolName: 'a'.repeat(129)}})).rejects.toThrow(ValidationError)
        expect(called).toBeFalse()
    })

    test('reports an incomplete create response as a runtime error', async () => {
        const {client} = stubCognito(() => ({UserPool: {Name: 'orders'}}))

        await expect(new AwsCognitoAdapter(client).create({values: {poolName: 'orders'}})).rejects.toMatchObject({
            name: 'RuntimeError',
            message: 'AWS Cognito did not return the created user pool',
        })
    })

    test('deletes a user pool by ID', async () => {
        const {client, sent} = stubCognito((command) => {
            expect(command).toBeInstanceOf(DeleteUserPoolCommand)
            return {}
        })

        await new AwsCognitoAdapter(client).delete(POOL_ID)

        expect((sent[0] as DeleteUserPoolCommand).input.UserPoolId).toBe(POOL_ID)
    })

    test('health checks only one user pool page', async () => {
        const {client, sent} = stubCognito((command) => {
            expect(command).toBeInstanceOf(ListUserPoolsCommand)
            return {UserPools: [SUMMARY]}
        })

        await new AwsCognitoAdapter(client).health()

        expect(sent).toHaveLength(1)
        expect((sent[0] as ListUserPoolsCommand).input).toEqual({MaxResults: 1})
    })
})
