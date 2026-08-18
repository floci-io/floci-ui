import {describe, expect, test} from 'bun:test'
import {
    CreateUserCommand,
    DeleteUserCommand,
    GetUserCommand,
    ListUsersCommand,
    type IAMClient,
} from '@aws-sdk/client-iam'
import {AwsIamAdapter} from './AwsIamAdapter'

function fakeClient(handler: (command: unknown) => unknown): IAMClient {
    return {
        send: async (command: unknown) => handler(command),
    } as unknown as IAMClient
}

const alice = {
    UserName: 'alice',
    UserId: 'AIDAALICE',
    Arn: 'arn:aws:iam::000000000000:user/team/alice',
    Path: '/team/',
    CreateDate: new Date('2026-01-02T03:04:05.000Z'),
}

describe('AwsIamAdapter', () => {
    test('lists every page and maps IAM users to normalized resources', async () => {
        const adapter = new AwsIamAdapter(fakeClient((command) => {
            if (!(command instanceof ListUsersCommand)) throw new Error('Unexpected command')
            if (!command.input.Marker) return {Users: [alice], IsTruncated: true, Marker: 'next'}
            return {Users: [{...alice, UserName: 'bob', UserId: 'AIDABOB'}], IsTruncated: false}
        }))

        const result = await adapter.list()

        expect(result).toHaveLength(2)
        expect(result[0]).toMatchObject({
            id: 'alice',
            name: 'alice',
            cloud: 'aws',
            service: 'identity',
            type: 'iam-user',
            region: null,
            createdAt: '2026-01-02T03:04:05.000Z',
        })
        expect(result[0].metadata).toMatchObject({
            identityService: 'iam',
            userId: 'AIDAALICE',
            path: '/team/',
        })
    })

    test('filters users by search term', async () => {
        const adapter = new AwsIamAdapter(fakeClient(() => ({
            Users: [alice, {...alice, UserName: 'bob'}],
            IsTruncated: false,
        })))

        const result = await adapter.list({search: 'ALI'})

        expect(result.map((resource) => resource.name)).toEqual(['alice'])
    })

    test('gets and maps one IAM user', async () => {
        const adapter = new AwsIamAdapter(fakeClient((command) => {
            expect(command).toBeInstanceOf(GetUserCommand)
            return {User: alice}
        }))

        const result = await adapter.get('alice')

        expect(result?.id).toBe('alice')
        expect(result?.metadata.arn).toBe(alice.Arn)
    })

    test('returns null when IAM reports a missing user', async () => {
        const adapter = new AwsIamAdapter(fakeClient(() => {
            throw Object.assign(new Error('missing'), {name: 'NoSuchEntityException'})
        }))

        await expect(adapter.get('missing')).resolves.toBeNull()
    })

    test('creates an IAM user with an optional path', async () => {
        const adapter = new AwsIamAdapter(fakeClient((command) => {
            expect(command).toBeInstanceOf(CreateUserCommand)
            expect((command as CreateUserCommand).input).toEqual({UserName: 'alice', Path: '/team/'})
            return {User: alice}
        }))

        const result = await adapter.create({values: {userName: 'alice', path: '/team/'}})

        expect(result.id).toBe('alice')
    })

    test('reports an empty create response as a runtime error', async () => {
        const adapter = new AwsIamAdapter(fakeClient(() => ({})))

        await expect(adapter.create({values: {userName: 'alice'}})).rejects.toMatchObject({
            name: 'RuntimeError',
            message: 'AWS IAM did not return the created user',
        })
    })

    test('rejects invalid user names before calling IAM', async () => {
        let called = false
        const adapter = new AwsIamAdapter(fakeClient(() => {
            called = true
            return {}
        }))

        await expect(adapter.create({values: {userName: 'not valid'}})).rejects.toThrow('Use a valid IAM user name')
        await expect(adapter.create({values: {userName: 'alice', path: 'team'}})).rejects.toThrow('Use a valid IAM path')
        expect(called).toBeFalse()
    })

    test('deletes the requested IAM user', async () => {
        const adapter = new AwsIamAdapter(fakeClient((command) => {
            expect(command).toBeInstanceOf(DeleteUserCommand)
            expect((command as DeleteUserCommand).input.UserName).toBe('alice')
            return {}
        }))

        await adapter.delete('alice')
    })

    test('reports a delete of a missing IAM user as not found', async () => {
        const adapter = new AwsIamAdapter(fakeClient(() => {
            throw Object.assign(new Error('The user with name alice cannot be found.'), {name: 'NoSuchEntityException'})
        }))

        await expect(adapter.delete('alice')).rejects.toMatchObject({
            name: 'NotFoundError',
            message: 'IAM user alice not found',
        })
    })

    test('reports a delete blocked by attached resources as a conflict', async () => {
        const adapter = new AwsIamAdapter(fakeClient(() => {
            throw Object.assign(new Error('Cannot delete entity, must delete access keys first.'), {
                name: 'DeleteConflictException',
            })
        }))

        await expect(adapter.delete('alice')).rejects.toMatchObject({
            name: 'ConflictError',
            message: expect.stringContaining('IAM user alice still has attached resources'),
        })
    })

    test('returns the AWS IAM schema', () => {
        const adapter = new AwsIamAdapter(fakeClient(() => ({})))

        expect(adapter.schema()).toMatchObject({
            cloud: 'aws',
            service: 'identity',
            displayName: 'AWS IAM users',
            actions: ['list', 'create', 'delete', 'inspect'],
        })
    })
})
