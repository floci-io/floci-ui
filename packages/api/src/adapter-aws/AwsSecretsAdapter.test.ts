import {describe, expect, test} from 'bun:test'
import {
    CreateSecretCommand,
    DeleteSecretCommand,
    DescribeSecretCommand,
    ListSecretsCommand,
    type SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import {AwsSecretsAdapter} from './AwsSecretsAdapter'
import {ValidationError} from '../cloud-spi/errors'

const CREATED = new Date('2026-07-01T10:00:00.000Z')

function stubSecrets(options: {pages?: Array<{SecretList: object[]; NextToken?: string}>; missing?: boolean} = {}) {
    const sent: object[] = []
    let page = 0
    const client = {
        async send(command: object) {
            sent.push(command)
            if (command instanceof ListSecretsCommand) {
                const pages = options.pages ?? [{
                    SecretList: [{
                        Name: 'db-password',
                        ARN: 'arn:aws:secretsmanager:::db-password',
                        CreatedDate: CREATED,
                        DeletedDate: new Date('2026-08-01T10:00:00.000Z'),
                        KmsKeyId: 'alias/floci',
                        Tags: [{Key: 'environment', Value: 'test'}],
                    }],
                }]
                return pages[page++] ?? {SecretList: []}
            }
            if (command instanceof DescribeSecretCommand) {
                if (options.missing) {
                    const err = new Error("Secrets Manager can't find the specified secret.")
                    err.name = 'ResourceNotFoundException'
                    throw err
                }
                return {Name: 'db-password', ARN: 'arn:aws:secretsmanager:::db-password', CreatedDate: CREATED, Description: 'primary db'}
            }
            if (command instanceof CreateSecretCommand) return {Name: command.input.Name, ARN: 'arn:new'}
            return {}
        },
    } as unknown as SecretsManagerClient
    return {client, sent}
}

describe('AwsSecretsAdapter', () => {
    test('identifies itself as the AWS secrets adapter', () => {
        const adapter = new AwsSecretsAdapter(stubSecrets().client)
        expect(adapter.cloud).toBe('aws')
        expect(adapter.service).toBe('secrets')
    })

    test('lists secret metadata and retains recovery state and KMS metadata', async () => {
        const [resource] = await new AwsSecretsAdapter(stubSecrets().client).list()

        expect(resource).toMatchObject({id: 'db-password', name: 'db-password', type: 'secret', service: 'secrets', status: 'deleted'})
        expect(resource?.createdAt).toBe(CREATED.toISOString())
        expect(resource?.metadata).toMatchObject({
            arn: 'arn:aws:secretsmanager:::db-password',
            kmsKeyId: 'alias/floci',
            tags: [{key: 'environment', value: 'test'}],
        })
    })

    test('never exposes a secret value', async () => {
        const {client, sent} = stubSecrets()
        const adapter = new AwsSecretsAdapter(client)
        const [listed] = await adapter.list()
        const inspected = await adapter.get('db-password')

        for (const resource of [listed, inspected]) {
            const serialized = JSON.stringify(resource)
            expect(serialized).not.toContain('SecretString')
            expect(serialized).not.toContain('SecretBinary')
            for (const key of Object.keys(resource?.metadata ?? {})) {
                expect(key.toLowerCase()).not.toContain('value')
            }
        }
        expect(sent.every((command) => command.constructor.name !== 'GetSecretValueCommand')).toBe(true)
    })

    test('follows pagination', async () => {
        const {client} = stubSecrets({
            pages: [
                {SecretList: [{Name: 'one'}], NextToken: 'next'},
                {SecretList: [{Name: 'two'}]},
            ],
        })
        await expect(new AwsSecretsAdapter(client).list()).resolves.toHaveLength(2)
    })

    test('filters the list by search term', async () => {
        const adapter = new AwsSecretsAdapter(stubSecrets().client)
        await expect(adapter.list({search: 'db'})).resolves.toHaveLength(1)
        await expect(adapter.list({search: 'nope'})).resolves.toHaveLength(0)
    })

    test('returns null for a missing secret', async () => {
        const {client} = stubSecrets({missing: true})
        await expect(new AwsSecretsAdapter(client).get('nope')).resolves.toBeNull()
    })

    test('requires a secret name', async () => {
        await expect(new AwsSecretsAdapter(stubSecrets().client).create({values: {}}))
            .rejects.toBeInstanceOf(ValidationError)
    })

    test('creates with an optional description', async () => {
        const {client, sent} = stubSecrets()
        await new AwsSecretsAdapter(client).create({values: {secretName: 'api-key', description: 'third party'}})

        const command = sent[0] as CreateSecretCommand
        expect(command.input.Name).toBe('api-key')
        expect(command.input.Description).toBe('third party')
    })

    test('forwards an initial value verbatim but never echoes it back', async () => {
        const {client, sent} = stubSecrets()
        const value = '  s3cr3t  '
        const resource = await new AwsSecretsAdapter(client).create({values: {secretName: 'api-key', secretValue: value}})

        expect((sent[0] as CreateSecretCommand).input.SecretString).toBe(value)
        expect(JSON.stringify(resource)).not.toContain(value)
    })

    test('omits SecretString when no value was supplied', async () => {
        const {client, sent} = stubSecrets()
        await new AwsSecretsAdapter(client).create({values: {secretName: 'api-key'}})

        expect((sent[0] as CreateSecretCommand).input.SecretString).toBeUndefined()
    })

    test('force-deletes so the secret does not linger in a recovery window', async () => {
        const {client, sent} = stubSecrets()
        await new AwsSecretsAdapter(client).delete('api-key')

        const command = sent[0] as DeleteSecretCommand
        expect(command.input.SecretId).toBe('api-key')
        expect(command.input.ForceDeleteWithoutRecovery).toBe(true)
    })
})
