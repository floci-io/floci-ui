import {describe, expect, test} from 'bun:test'
import {AwsSecretsAdapter} from './AwsSecretsAdapter'

function clientReturning(...pages: {SecretList?: unknown[]; NextToken?: string}[]) {
    let call = 0
    return {
        send: async () => pages[call++] ?? {},
    } as never
}

describe('AwsSecretsAdapter', () => {
    test('lists secrets as resources so the console can count them', async () => {
        const adapter = new AwsSecretsAdapter(clientReturning({
            SecretList: [
                {Name: 'a-secret', ARN: 'arn:aws:secretsmanager:eu-west-2:000000000000:secret:a-secret-AbCdEf'},
                {Name: 'b-secret'},
            ],
        }))

        const resources = await adapter.list()

        expect(resources).toHaveLength(2)
        expect(resources[0]).toMatchObject({name: 'a-secret', service: 'secrets', type: 'secret', status: 'active'})
    })

    test('never exposes a secret value', async () => {
        // The guarantee is structural (GetSecretValue is not imported), but a value
        // leaking in through metadata would be just as bad, so assert on the shape.
        const adapter = new AwsSecretsAdapter(clientReturning({
            SecretList: [{Name: 'a-secret', ARN: 'arn:x'}],
        }))

        const serialized = JSON.stringify(await adapter.list())

        expect(serialized).not.toContain('SecretString')
        expect(serialized).not.toContain('secretString')
        expect(serialized).not.toContain('SecretBinary')
    })

    test('paginates, so a count past one page is not silently short', async () => {
        const adapter = new AwsSecretsAdapter(clientReturning(
            {SecretList: [{Name: 'one'}], NextToken: 'next'},
            {SecretList: [{Name: 'two'}]},
        ))

        expect(await adapter.list()).toHaveLength(2)
    })

    test('marks a secret pending deletion rather than reporting it healthy', async () => {
        const adapter = new AwsSecretsAdapter(clientReturning({
            SecretList: [{Name: 'gone', DeletedDate: new Date('2026-01-01T00:00:00Z')}],
        }))

        expect((await adapter.list())[0]?.status).toBe('deleted')
    })
})
