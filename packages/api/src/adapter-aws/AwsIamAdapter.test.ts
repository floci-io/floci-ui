import {describe, expect, test} from 'bun:test'
import {
    CreatePolicyCommand,
    CreateRoleCommand,
    CreateUserCommand,
    DeletePolicyCommand,
    DeleteRoleCommand,
    DeleteUserCommand,
    GetPolicyCommand,
    GetPolicyVersionCommand,
    GetRoleCommand,
    GetUserCommand,
    type IAMClient,
    ListPoliciesCommand,
    ListRolesCommand,
    ListUsersCommand,
} from '@aws-sdk/client-iam'
import {AwsIamAdapter} from './AwsIamAdapter'
import {ValidationError} from '../cloud-spi/errors'

type SendResult = Record<string, unknown>

function stubIam(handler: (command: object) => SendResult | Promise<SendResult>) {
    const sent: object[] = []
    const client = {
        async send(command: object) {
            sent.push(command)
            return handler(command)
        },
    } as unknown as IAMClient
    return {client, sent}
}

const user = {
    UserName: 'alice',
    UserId: 'AIDA99A311H4GBZ3N9UX',
    Arn: 'arn:aws:iam::000000000000:user/alice',
    Path: '/',
    CreateDate: new Date('2026-07-28T10:00:00.000Z'),
}

const role = {
    RoleName: 'deployer',
    RoleId: 'AROAPZ9FQ6LJB8HKPRID',
    Arn: 'arn:aws:iam::000000000000:role/deployer',
    Path: '/service/',
    CreateDate: new Date('2026-07-28T11:00:00.000Z'),
    AssumeRolePolicyDocument: '%7B%22Version%22%3A%222012-10-17%22%7D',
    Description: 'CI deploy role',
}

const policy = {
    PolicyName: 'read-buckets',
    PolicyId: 'ANPAJ2UCCR6DPCEXAMPLE',
    Arn: 'arn:aws:iam::000000000000:policy/read-buckets',
    Path: '/',
    CreateDate: new Date('2026-07-28T12:00:00.000Z'),
    AttachmentCount: 2,
    DefaultVersionId: 'v1',
}

/** Answers each List/Get command the way the runtime does. */
function runtimeStub() {
    return stubIam((command) => {
        if (command instanceof ListUsersCommand) return {Users: [user], IsTruncated: false}
        if (command instanceof ListRolesCommand) return {Roles: [role], IsTruncated: false}
        if (command instanceof ListPoliciesCommand) return {Policies: [policy], IsTruncated: false}
        if (command instanceof GetUserCommand) return {User: user}
        if (command instanceof GetRoleCommand) return {Role: role}
        if (command instanceof GetPolicyCommand) return {Policy: policy}
        if (command instanceof CreateUserCommand) return {User: user}
        if (command instanceof CreateRoleCommand) return {Role: role}
        if (command instanceof CreatePolicyCommand) return {Policy: policy}
        return {}
    })
}

describe('AwsIamAdapter', () => {
    test('identifies itself as the AWS IAM adapter', () => {
        const adapter = new AwsIamAdapter(runtimeStub().client)

        expect(adapter.cloud).toBe('aws')
        expect(adapter.service).toBe('iam')
        expect(adapter.schema().displayName).toBe('AWS IAM')
    })

    test('lists all three kinds when no facet is given', async () => {
        const {client} = runtimeStub()
        const resources = await new AwsIamAdapter(client).list()

        // Policies are keyed by ARN, because GetPolicy and DeletePolicy take one.
        expect(resources.map((r) => r.id)).toEqual([
            'user/alice',
            'role/deployer',
            `policy/${policy.Arn}`,
        ])
        expect(resources.map((r) => r.type)).toEqual(['iam-user', 'iam-role', 'iam-policy'])
    })

    describe('the kind facet narrows the listing', () => {
        const cases: Array<[string, string, unknown]> = [
            ['users', 'user/alice', ListUsersCommand],
            ['roles', 'role/deployer', ListRolesCommand],
            ['policies', `policy/${policy.Arn}`, ListPoliciesCommand],
        ]

        for (const [kind, expectedId, command] of cases) {
            test(`kind=${kind} lists only ${kind}`, async () => {
                const {client, sent} = runtimeStub()
                const resources = await new AwsIamAdapter(client).list({filters: {kind}})

                expect(resources.map((r) => r.id)).toEqual([expectedId])
                expect(sent).toHaveLength(1)
                expect(sent[0]).toBeInstanceOf(command as never)
            })
        }
    })

    test('rejects a kind the schema does not offer', async () => {
        const {client} = runtimeStub()

        await expect(new AwsIamAdapter(client).list({filters: {kind: 'wizards'}})).rejects.toThrow(ValidationError)
    })

    test('only asks for customer-managed policies', async () => {
        // Real IAM returns close to a thousand AWS-managed policies without
        // Scope=Local, which would bury the account's own policies.
        const {client, sent} = runtimeStub()
        await new AwsIamAdapter(client).list({filters: {kind: 'policies'}})

        expect((sent[0] as ListPoliciesCommand).input.Scope).toBe('Local')
    })

    test('maps a user, a role and a policy onto the shared shape', async () => {
        const {client} = runtimeStub()
        const [asUser, asRole, asPolicy] = await new AwsIamAdapter(client).list()

        expect(asUser).toMatchObject({
            id: 'user/alice',
            name: 'alice',
            type: 'iam-user',
            createdAt: '2026-07-28T10:00:00.000Z',
        })
        expect(asUser?.metadata).toMatchObject({arn: user.Arn, path: '/', userId: user.UserId})
        expect(asRole?.metadata).toMatchObject({path: '/service/', description: 'CI deploy role'})
        expect(asPolicy?.metadata).toMatchObject({attachmentCount: 2, defaultVersionId: 'v1'})
    })

    test('decodes the URL-encoded trust policy the runtime returns', async () => {
        // IAM returns AssumeRolePolicyDocument percent-encoded; showing that raw in
        // the inspector is unreadable.
        const {client} = runtimeStub()
        const resource = await new AwsIamAdapter(client).get('role/deployer')

        expect(resource?.metadata.assumeRolePolicyDocument).toBe('{"Version":"2012-10-17"}')
    })

    test('follows the pagination marker', async () => {
        let call = 0
        const {client, sent} = stubIam((command) => {
            if (!(command instanceof ListUsersCommand)) return {}
            call += 1
            if (call === 1) return {Users: [user], IsTruncated: true, Marker: 'page-2'}
            return {Users: [{...user, UserName: 'bob'}], IsTruncated: false}
        })

        const resources = await new AwsIamAdapter(client).list({filters: {kind: 'users'}})

        expect(resources.map((r) => r.name)).toEqual(['alice', 'bob'])
        expect((sent[1] as ListUsersCommand).input.Marker).toBe('page-2')
    })

    test('filters by search across name and arn', async () => {
        const {client} = runtimeStub()
        const adapter = new AwsIamAdapter(client)

        await expect(adapter.list({search: 'alic'})).resolves.toHaveLength(1)
        await expect(adapter.list({search: 'role/deployer'})).resolves.toHaveLength(1)
        await expect(adapter.list({search: 'nope'})).resolves.toHaveLength(0)
    })

    describe('inspect addresses a resource by kind and identifier', () => {
        const cases: Array<[string, unknown]> = [
            ['user/alice', GetUserCommand],
            ['role/deployer', GetRoleCommand],
            ['policy/arn:aws:iam::000000000000:policy/read-buckets', GetPolicyCommand],
        ]

        for (const [id, command] of cases) {
            test(`${id.split('/')[0]} uses ${(command as {name: string}).name}`, async () => {
                const {client, sent} = runtimeStub()
                const resource = await new AwsIamAdapter(client).get(id)

                expect(sent[0]).toBeInstanceOf(command as never)
                expect(resource).not.toBeNull()
            })
        }
    })

    describe('inspecting a policy loads its document', () => {
        const POLICY_ID = `policy/${policy.Arn}`

        test('fetches the default version and exposes the decoded document', async () => {
            // Roles surface a decoded trust policy, so a policy has to surface the
            // document it was created with — that is the thing being audited.
            const {client, sent} = stubIam((command) => {
                if (command instanceof GetPolicyCommand) return {Policy: policy}
                if (command instanceof GetPolicyVersionCommand) {
                    return {PolicyVersion: {VersionId: 'v1', Document: '%7B%22Statement%22%3A%5B%5D%7D'}}
                }
                return {}
            })
            const resource = await new AwsIamAdapter(client).get(POLICY_ID)

            const versionCall = sent.find((c) => c instanceof GetPolicyVersionCommand) as GetPolicyVersionCommand
            expect(versionCall.input.PolicyArn).toBe(policy.Arn)
            expect(versionCall.input.VersionId).toBe('v1')
            expect(resource?.metadata.policyDocument).toBe('{"Statement":[]}')
        })

        test('leaves a document the runtime did not encode untouched', async () => {
            // Real IAM percent-encodes the document; the local runtime returns it
            // literal, so decoding must be a no-op rather than a corruption.
            const {client} = stubIam((command) => {
                if (command instanceof GetPolicyCommand) return {Policy: policy}
                if (command instanceof GetPolicyVersionCommand) {
                    return {PolicyVersion: {VersionId: 'v1', Document: '{"Statement":[]}'}}
                }
                return {}
            })
            const resource = await new AwsIamAdapter(client).get(POLICY_ID)

            expect(resource?.metadata.policyDocument).toBe('{"Statement":[]}')
        })

        test('still inspects the policy when the version lookup fails', async () => {
            const {client} = stubIam((command) => {
                if (command instanceof GetPolicyCommand) return {Policy: policy}
                if (command instanceof GetPolicyVersionCommand) {
                    throw Object.assign(new Error('Rate exceeded'), {name: 'ThrottlingException'})
                }
                return {}
            })
            const resource = await new AwsIamAdapter(client).get(POLICY_ID)

            expect(resource?.name).toBe('read-buckets')
            expect(resource?.metadata.policyDocument).toBeUndefined()
            expect(resource?.metadata.policyDocumentUnavailable).toBe(true)
        })

        test('does not fetch the document while listing', async () => {
            // One GetPolicyVersion per row would turn a list into an N+1.
            const {client, sent} = runtimeStub()
            await new AwsIamAdapter(client).list({filters: {kind: 'policies'}})

            expect(sent.some((c) => c instanceof GetPolicyVersionCommand)).toBe(false)
        })
    })

    test('rejects an id that does not name a kind', async () => {
        const {client} = runtimeStub()

        await expect(new AwsIamAdapter(client).get('alice')).rejects.toThrow(ValidationError)
        await expect(new AwsIamAdapter(client).get('wizard/merlin')).rejects.toThrow(ValidationError)
    })

    test('returns null when an entity does not exist', async () => {
        const {client} = stubIam(() => {
            throw Object.assign(new Error('NoSuchEntity'), {
                name: 'NoSuchEntity',
                $metadata: {httpStatusCode: 404},
            })
        })
        await expect(new AwsIamAdapter(client).get('user/ghost')).resolves.toBeNull()
    })

    test('creates a user', async () => {
        const {client, sent} = runtimeStub()
        const resource = await new AwsIamAdapter(client).create({values: {kind: 'users', name: 'alice'}})

        expect(sent[0]).toBeInstanceOf(CreateUserCommand)
        expect((sent[0] as CreateUserCommand).input.UserName).toBe('alice')
        expect(resource.id).toBe('user/alice')
    })

    test('creates a role with its trust policy', async () => {
        const {client, sent} = runtimeStub()
        await new AwsIamAdapter(client).create({
            values: {kind: 'roles', name: 'deployer', assumeRolePolicyDocument: '{"Version":"2012-10-17"}'},
        })

        const command = sent[0] as CreateRoleCommand
        expect(command).toBeInstanceOf(CreateRoleCommand)
        expect(command.input.AssumeRolePolicyDocument).toBe('{"Version":"2012-10-17"}')
    })

    test('creates a policy with its document', async () => {
        const {client, sent} = runtimeStub()
        await new AwsIamAdapter(client).create({
            values: {kind: 'policies', name: 'read-buckets', policyDocument: '{"Statement":[]}'},
        })

        expect((sent[0] as CreatePolicyCommand).input.PolicyDocument).toBe('{"Statement":[]}')
    })

    test('requires the document each kind cannot be created without', async () => {
        // A role with no trust policy and a policy with no document are both
        // rejected by IAM, so they are rejected here with a message that says
        // which field is missing for the chosen kind.
        const {client} = runtimeStub()
        const adapter = new AwsIamAdapter(client)

        await expect(adapter.create({values: {kind: 'roles', name: 'r'}})).rejects.toThrow(
            new ValidationError('assumeRolePolicyDocument is required when kind is roles'),
        )
        await expect(adapter.create({values: {kind: 'policies', name: 'p'}})).rejects.toThrow(
            new ValidationError('policyDocument is required when kind is policies'),
        )
    })

    test('rejects a document that is not JSON', async () => {
        const {client} = runtimeStub()

        await expect(
            new AwsIamAdapter(client).create({values: {kind: 'policies', name: 'p', policyDocument: 'not json'}}),
        ).rejects.toThrow(ValidationError)
    })

    test('requires kind and name', async () => {
        const {client} = runtimeStub()
        const adapter = new AwsIamAdapter(client)

        await expect(adapter.create({values: {}})).rejects.toThrow(new ValidationError('kind is required'))
        await expect(adapter.create({values: {kind: 'users'}})).rejects.toThrow(
            new ValidationError('name is required'),
        )
    })

    describe('delete dispatches on the kind in the id', () => {
        const cases: Array<[string, unknown]> = [
            ['user/alice', DeleteUserCommand],
            ['role/deployer', DeleteRoleCommand],
            ['policy/arn:aws:iam::000000000000:policy/read-buckets', DeletePolicyCommand],
        ]

        for (const [id, command] of cases) {
            test(id.split('/')[0], async () => {
                const {client, sent} = runtimeStub()
                await new AwsIamAdapter(client).delete(id)

                expect(sent[0]).toBeInstanceOf(command as never)
            })
        }
    })
})
