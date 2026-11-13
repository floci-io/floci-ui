import {Hono} from 'hono'
import {
    CreateSecretCommand,
    DeleteSecretCommand,
    DescribeSecretCommand,
    GetSecretValueCommand,
    ListSecretsCommand,
    PutSecretValueCommand,
    type SecretListEntry,
} from '@aws-sdk/client-secrets-manager'
import {secretsManager} from '../aws'

function iso(date?: Date): string | undefined {
    return date ? date.toISOString() : undefined
}

/** Secrets Manager routes bound to one client, i.e. one account. */
export function createSecretsManagerRouter(client?: Pick<typeof secretsManager, 'send'>) {
    // Without a client, resolve the default one per call rather than once, so the module binding
    // stays live (the route tests replace it).
    const sm = () => client ?? secretsManager
    const app = new Hono()

    app.get('/secrets', async (c) => {
        // ListSecrets is paginated; follow NextToken so environments with many
        // secrets do not silently return only the first page.
        const secrets: SecretListEntry[] = []
        let nextToken: string | undefined
        do {
            const res = await sm().send(new ListSecretsCommand({NextToken: nextToken}))
            secrets.push(...(res.SecretList ?? []))
            nextToken = res.NextToken
        } while (nextToken)
        return c.json(secrets.map(s => ({
            name: s.Name ?? '',
            arn: s.ARN,
            description: s.Description,
            rotationEnabled: s.RotationEnabled ?? false,
            kmsKeyId: s.KmsKeyId,
            lastChangedDate: iso(s.LastChangedDate),
            lastAccessedDate: iso(s.LastAccessedDate),
            createdDate: iso(s.CreatedDate),
            tags: (s.Tags ?? []).map(t => ({key: t.Key ?? '', value: t.Value ?? ''})),
        })))
    })

    app.get('/secret', async (c) => {
        const id = c.req.query('id') ?? ''
        if (!id) return c.json({error: 'id is required'}, 400)
        const res = await sm().send(new DescribeSecretCommand({SecretId: id}))
        return c.json({
            name: res.Name ?? '',
            arn: res.ARN,
            description: res.Description,
            rotationEnabled: res.RotationEnabled ?? false,
            kmsKeyId: res.KmsKeyId,
            lastChangedDate: iso(res.LastChangedDate),
            lastAccessedDate: iso(res.LastAccessedDate),
            createdDate: iso(res.CreatedDate),
            deletedDate: iso(res.DeletedDate),
            versionIds: Object.keys(res.VersionIdsToStages ?? {}),
            tags: (res.Tags ?? []).map(t => ({key: t.Key ?? '', value: t.Value ?? ''})),
        })
    })

    app.get('/secret/value', async (c) => {
        const id = c.req.query('id') ?? ''
        if (!id) return c.json({error: 'id is required'}, 400)
        const res = await sm().send(new GetSecretValueCommand({SecretId: id}))
        // The body carries plaintext secret material; mark it no-store so browsers,
        // disk caches and intermediary proxies never retain a copy.
        c.header('Cache-Control', 'no-store')
        return c.json({
            name: res.Name ?? '',
            arn: res.ARN,
            versionId: res.VersionId,
            secretString: res.SecretString,
            // SecretBinary is a Uint8Array; expose it as base64 so binary secrets survive JSON transport.
            secretBinary: res.SecretBinary ? Buffer.from(res.SecretBinary).toString('base64') : undefined,
            createdDate: iso(res.CreatedDate),
        })
    })

    app.post('/secrets', async (c) => {
        let body: {name?: string; description?: string; secretString?: string}
        try {
            body = await c.req.json()
        } catch {
            return c.json({error: 'invalid JSON body'}, 400)
        }
        const {name, description, secretString} = body
        if (!name) return c.json({error: 'name is required'}, 400)
        if (typeof secretString !== 'string') return c.json({error: 'secretString is required'}, 400)
        const res = await sm().send(new CreateSecretCommand({
            Name: name,
            Description: description,
            SecretString: secretString,
        }))
        return c.json({name: res.Name ?? name, arn: res.ARN, versionId: res.VersionId})
    })

    app.put('/secret/value', async (c) => {
        let body: {id?: string; secretString?: string}
        try {
            body = await c.req.json()
        } catch {
            return c.json({error: 'invalid JSON body'}, 400)
        }
        const {id, secretString} = body
        if (!id) return c.json({error: 'id is required'}, 400)
        if (typeof secretString !== 'string') return c.json({error: 'secretString is required'}, 400)
        const res = await sm().send(new PutSecretValueCommand({
            SecretId: id,
            SecretString: secretString,
        }))
        return c.json({arn: res.ARN, versionId: res.VersionId})
    })

    app.delete('/secret', async (c) => {
        const id = c.req.query('id') ?? ''
        if (!id) return c.json({error: 'id is required'}, 400)
        // Local development favours immediate removal over AWS's recovery window.
        const force = c.req.query('force') === 'true'
        await sm().send(new DeleteSecretCommand({
            SecretId: id,
            ...(force ? {ForceDeleteWithoutRecovery: true} : {RecoveryWindowInDays: 7}),
        }))
        return c.json({ok: true})
    })

    return app
}

export default createSecretsManagerRouter()
