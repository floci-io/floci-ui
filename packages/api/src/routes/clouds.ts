import {Hono} from 'hono'
import type {Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {
    CloudProvider,
    CloudServiceType,
    CreateDatabaseSnapshotInput,
    CreateLambdaTriggerInput,
    KmsEncryptionAlgorithm,
    KmsSigningAlgorithm,
    ServiceSchema,
    SqlConnectionInput,
} from '../cloud-spi/types'
import {COMPUTE_POWER_ACTIONS} from '../cloud-spi/types'
import {clampLimit, parseKeyQuery, type PageQuery} from '../cloud-spi/childCollections'
import {CloudError, NotFoundError, toHttpError, ValidationError} from '../cloud-spi/errors'
import {isServiceType} from '../cloud-spi/serviceCatalog'
import {mapAwsSdkError} from '../adapter-aws/awsErrors'
import type {ApiBindings} from '../app'
import {serviceForAccount} from '../cloudProxy'
import {CloudProxyService} from '../service/CloudProxyService'
import {withDeadline} from '../service/deadline'
import {resolveScopedCloud} from '../service/defaultCloud'

// Header (and query-param fallback for direct links such as object downloads)
// used by the frontend to scope every request to an AWS account.
export const ACCOUNT_HEADER = 'x-floci-account-id'

interface KmsEncryptRequest {
    plaintextBase64?: unknown
    encryptionAlgorithm?: unknown
    encryptionContext?: unknown
}

interface KmsDecryptRequest {
    ciphertextBlobBase64?: unknown
    encryptionAlgorithm?: unknown
    encryptionContext?: unknown
}

interface KmsSignRequest {
    messageBase64?: unknown
    signingAlgorithm?: unknown
}

interface KmsVerifyRequest extends KmsSignRequest {
    signatureBase64?: unknown
    keyVersionId?: unknown
}

const KMS_ENCRYPTION_ALGORITHMS = new Set<KmsEncryptionAlgorithm>([
    'SYMMETRIC_DEFAULT',
    'RSAES_OAEP_SHA_1',
    'RSAES_OAEP_SHA_256',
])
const KMS_SIGNING_ALGORITHMS = new Set<KmsSigningAlgorithm>([
    'SHA_256_RSA_PKCS1_V1_5',
    'SHA_384_RSA_PKCS1_V1_5',
    'SHA_512_RSA_PKCS1_V1_5',
    'ECDSA_SHA_256',
    'ECDSA_SHA_384',
    'ECDSA_SHA_512',
])
const MAX_PLAINTEXT_BASE64_LENGTH = 5_464
const MAX_CIPHERTEXT_BASE64_LENGTH = 8_192
/** Real StartQuery's own limit — matched here so the error surfaces before the runtime round-trip. */
const MAX_QUERY_LOG_GROUPS = 50
/**
 * Emptying a bucket lists and deletes every version, so it can outlast Bun's
 * 10-second idle default. The operation stops starting new requests at the
 * deadline; a delete batch already sent gets up to 25 seconds more (the
 * adapter's own bound), inside the connection budget, and the browser waits
 * longer than both.
 */
export const EMPTY_BUCKET_DEADLINE_MS = 120_000
export const EMPTY_BUCKET_IDLE_TIMEOUT_SECONDS = 150

export function createCloudRoutes(
    injectedService?: CloudProxyService,
    accountService: (accountId?: string | null) => CloudProxyService = serviceForAccount,
) {
    const app = new Hono()

    // Bad input and unknown targets throw typed errors like adapter failures do,
    // so every error response leaves through `toHttpError`.
    app.onError((err, c) => {
        if (err instanceof CloudError) {
            const {status, body} = toHttpError(err)
            return c.json(body, status)
        }
        if (err instanceof HTTPException) return err.getResponse()
        console.error(err)
        return c.text('Internal Server Error', 500)
    })

    // Resolve the account-scoped service per request. An explicitly injected
    // service (used by tests) always wins and ignores the account header.
    const svc = (c: Context): CloudProxyService =>
        injectedService ?? accountService(c.req.header(ACCOUNT_HEADER) ?? c.req.query('account'))

    // A console an emulator started serves only that emulator's cloud; the
    // others have nothing behind them, so they are unknown here. The scope is
    // the process's, not an account's, so it is read once rather than per request.
    const scope = injectedService ? injectedService.scopedCloud() : resolveScopedCloud()
    app.use('/:cloud/*', async (c, next) => {
        const cloud = c.req.param('cloud')
        if (scope !== null && isCloudProvider(cloud) && cloud !== scope) throw new NotFoundError('Unknown cloud')
        await next()
    })

    app.get('/', (c) => c.json(svc(c).clouds()))

    app.get('/:cloud/services', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')
        return c.json(await svc(c).services(cloud))
    })

    app.get('/:cloud/status', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')
        // Per-service detail is opt-in; the connection indicator polls this often.
        const includeServices = c.req.query('services') === 'all'
        return c.json(await svc(c).status(cloud, {includeServices}))
    })

    app.get('/:cloud/services/:service/status', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) throw new NotFoundError('Unknown cloud or service')
        return c.json(await svc(c).serviceStatus(cloud, serviceType))
    })

    app.get('/:cloud/services/:service/schema', (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) throw new NotFoundError('Unknown cloud or service')

        const schema = svc(c).schema(cloud, serviceType)
        if (!schema) {
            throw new NotFoundError('Schema not available')
        }

        return c.json(schema)
    })

    app.get('/:cloud/services/database/snapshots', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const snapshots = await svc(c).listDatabaseSnapshots(cloud, c.req.query('instanceIdentifier'))
            return c.json(snapshots)
        })
    })

    app.post('/:cloud/services/database/snapshots', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const input = await c.req.json<CreateDatabaseSnapshotInput>()
            const snapshot = await svc(c).createDatabaseSnapshot(cloud, input)
            return c.json(snapshot, 201)
        })
    })

    app.get('/:cloud/services/database/orderable-classes', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const classes = await svc(c).listDatabaseOrderableInstanceClasses(cloud, c.req.query('engine'))
            return c.json(classes)
        })
    })

    // Literal storage route, registered ahead of the parameterized resource routes.
    app.post('/:cloud/services/storage/resources/:id/empty', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        extendRequestTimeout(c, EMPTY_BUCKET_IDLE_TIMEOUT_SECONDS)
        return withRuntime(c, () => withDeadline(EMPTY_BUCKET_DEADLINE_MS, c.req.raw.signal, async (signal) =>
            c.json(await svc(c).emptyBucket(cloud, c.req.param('id'), {signal}))))
    })

    app.get('/:cloud/services/:service/resources', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            const service = svc(c)
            const resources = await service.listResources(cloud, serviceType, {
                search: c.req.query('search'),
                filters: declaredFilters(service.schema(cloud, serviceType), (name) => c.req.query(name)),
            })
            return c.json(resources)
        })
    })

    app.get('/:cloud/services/nosql/resources/:id/containers', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const containers = await svc(c).listCosmosContainers(cloud, c.req.param('id'))
            return c.json(containers)
        })
    })

    app.post('/:cloud/services/nosql/resources/:id/containers', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const values = await c.req.json<Record<string, unknown>>()
            const container = await svc(c).createCosmosContainer(cloud, c.req.param('id'), {values})
            return c.json(container, 201)
        })
    })

    app.delete('/:cloud/services/nosql/resources/:id/containers/:containerId', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            await svc(c).deleteCosmosContainer(cloud, c.req.param('id'), c.req.param('containerId'))
            return c.json({ok: true})
        })
    })

    app.get('/:cloud/services/nosql/resources/:id/containers/:containerId/items', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const items = await svc(c).listCosmosItems(cloud, c.req.param('id'), c.req.param('containerId'))
            return c.json(items)
        })
    })

    app.post('/:cloud/services/nosql/resources/:id/containers/:containerId/items', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const document = await c.req.json<Record<string, unknown>>()
            const item = await svc(c).upsertCosmosItem(cloud, c.req.param('id'), c.req.param('containerId'), document)
            return c.json(item, 201)
        })
    })

    app.delete('/:cloud/services/nosql/resources/:id/containers/:containerId/items/:itemId', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            await svc(c).deleteCosmosItem(cloud, c.req.param('id'), c.req.param('containerId'), c.req.param('itemId'), c.req.query('partitionKey') ?? null)
            return c.json({ok: true})
        })
    })

    app.post('/:cloud/services/nosql/resources/:id/containers/:containerId/query', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const body = await c.req.json<{query?: string}>()
            const result = await svc(c).queryCosmosItems(cloud, c.req.param('id'), c.req.param('containerId'), body.query ?? '')
            return c.json(result)
        })
    })

    // The SQL explorer works for every service whose adapter browses SQL data:
    // relational databases, and Aurora DSQL's clusters.
    app.post('/:cloud/services/:service/resources/:id/sql/databases', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            const connection = await c.req.json<SqlConnectionInput>()
            const databases = await svc(c).listSqlDatabases(cloud, serviceType, c.req.param('id'), connection)
            return c.json(databases)
        })
    })

    app.post('/:cloud/services/:service/resources/:id/sql/tables', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            const connection = await c.req.json<SqlConnectionInput>()
            const tables = await svc(c).listSqlTables(cloud, serviceType, c.req.param('id'), connection)
            return c.json(tables)
        })
    })

    app.post('/:cloud/services/:service/resources/:id/sql/query', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            const body = await c.req.json<SqlConnectionInput & {query?: string}>()
            const {query = '', ...connection} = body
            const result = await svc(c).querySql(cloud, serviceType, c.req.param('id'), connection, query)
            return c.json(result)
        })
    })

    app.post('/:cloud/services/logs/resources/:id/query', async (c, next) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')
        if (cloud !== 'aws') return next()

        return withRuntime(c, async () => {
            const body = await c.req.json<{queryString?: unknown; startTime?: unknown; endTime?: unknown; limit?: unknown}>()
            if (typeof body.queryString !== 'string') throw new ValidationError('queryString must be a string.')
            if (typeof body.startTime !== 'number') throw new ValidationError('startTime must be a number (epoch seconds).')
            if (typeof body.endTime !== 'number') throw new ValidationError('endTime must be a number (epoch seconds).')
            if (body.limit !== undefined && typeof body.limit !== 'number') throw new ValidationError('limit must be a number.')

            const result = await svc(c).queryLogs(cloud, c.req.param('id'), {
                queryString: body.queryString,
                startTime: body.startTime,
                endTime: body.endTime,
                limit: body.limit,
            })
            return c.json(result)
        })
    })

    // Service-level (not resource-id-scoped) so a query can span multiple log
    // groups at once — the per-row route above stays a single log group,
    // matching the resource inspector's one-group-at-a-time context.
    app.post('/:cloud/services/logs/query', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const body = await c.req.json<{logGroupNames?: unknown; queryString?: unknown; startTime?: unknown; endTime?: unknown; limit?: unknown}>()
            if (!Array.isArray(body.logGroupNames) || body.logGroupNames.length === 0 || !body.logGroupNames.every((name) => typeof name === 'string')) {
                throw new ValidationError('logGroupNames must be a non-empty array of strings.')
            }
            if (body.logGroupNames.length > MAX_QUERY_LOG_GROUPS) {
                throw new ValidationError(`logGroupNames must include at most ${MAX_QUERY_LOG_GROUPS} log groups.`)
            }
            if (typeof body.queryString !== 'string') throw new ValidationError('queryString must be a string.')
            if (typeof body.startTime !== 'number') throw new ValidationError('startTime must be a number (epoch seconds).')
            if (typeof body.endTime !== 'number') throw new ValidationError('endTime must be a number (epoch seconds).')
            if (body.limit !== undefined && typeof body.limit !== 'number') throw new ValidationError('limit must be a number.')

            const result = await svc(c).queryLogs(cloud, body.logGroupNames, {
                queryString: body.queryString,
                startTime: body.startTime,
                endTime: body.endTime,
                limit: body.limit,
            })
            return c.json(result)
        })
    })

    app.delete('/:cloud/services/email/inbox', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            await svc(c).clearEmailInbox(cloud)
            return c.json({ok: true})
        })
    })

    app.get('/:cloud/services/k8s/resources/:id/nodegroups', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const nodegroups = await svc(c).listKubernetesNodegroups(cloud, c.req.param('id'))
            return c.json(nodegroups)
        })
    })

    app.post('/:cloud/services/k8s/resources/:id/nodegroups', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const nodegroup = await svc(c).createKubernetesNodegroup(cloud, c.req.param('id'), await c.req.json())
            return c.json(nodegroup, 201)
        })
    })

    app.delete('/:cloud/services/k8s/resources/:id/nodegroups/:nodegroupId', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            await svc(c).deleteKubernetesNodegroup(cloud, c.req.param('id'), c.req.param('nodegroupId'))
            return c.json({ok: true})
        })
    })

    app.get('/:cloud/services/k8s/resources/:id/fargate-profiles', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const profiles = await svc(c).listKubernetesFargateProfiles(cloud, c.req.param('id'))
            return c.json(profiles)
        })
    })

    app.post('/:cloud/services/k8s/resources/:id/fargate-profiles', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const profile = await svc(c).createKubernetesFargateProfile(cloud, c.req.param('id'), await c.req.json())
            return c.json(profile, 201)
        })
    })

    app.delete('/:cloud/services/k8s/resources/:id/fargate-profiles/:profileId', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            await svc(c).deleteKubernetesFargateProfile(cloud, c.req.param('id'), c.req.param('profileId'))
            return c.json({ok: true})
        })
    })

    app.get('/:cloud/services/configuration/resources/:id/environments', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            return c.json(await svc(c).listAppConfigEnvironments(cloud, c.req.param('id')))
        })
    })

    app.post('/:cloud/services/configuration/resources/:id/environments', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const values = await c.req.json<Record<string, unknown>>()
            return c.json(await svc(c).createAppConfigEnvironment(cloud, c.req.param('id'), {values}), 201)
        })
    })

    app.delete('/:cloud/services/configuration/resources/:id/environments/:environmentId', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            await svc(c).deleteAppConfigEnvironment(cloud, c.req.param('id'), c.req.param('environmentId'))
            return c.json({ok: true})
        })
    })

    app.get('/:cloud/services/configuration/resources/:id/configuration-profiles', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            return c.json(await svc(c).listAppConfigConfigurationProfiles(cloud, c.req.param('id')))
        })
    })

    app.post('/:cloud/services/configuration/resources/:id/configuration-profiles', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const values = await c.req.json<Record<string, unknown>>()
            return c.json(await svc(c).createAppConfigConfigurationProfile(cloud, c.req.param('id'), {values}), 201)
        })
    })

    app.delete('/:cloud/services/configuration/resources/:id/configuration-profiles/:profileId', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            await svc(c).deleteAppConfigConfigurationProfile(cloud, c.req.param('id'), c.req.param('profileId'))
            return c.json({ok: true})
        })
    })

    app.get('/:cloud/services/configuration/resources/:id/configuration-profiles/:profileId/hosted-configuration-versions', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            return c.json(await svc(c).listAppConfigHostedConfigurationVersions(cloud, c.req.param('id'), c.req.param('profileId')))
        })
    })

    app.post('/:cloud/services/configuration/resources/:id/configuration-profiles/:profileId/hosted-configuration-versions', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const values = await c.req.json<Record<string, unknown>>()
            return c.json(await svc(c).createAppConfigHostedConfigurationVersion(cloud, c.req.param('id'), c.req.param('profileId'), {values}), 201)
        })
    })

    const hostedVersionNumber = (raw: string): number | null => {
        const value = Number(raw)
        return Number.isInteger(value) && value > 0 ? value : null
    }

    app.get('/:cloud/services/configuration/resources/:id/configuration-profiles/:profileId/hosted-configuration-versions/:versionNumber', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const versionNumber = hostedVersionNumber(c.req.param('versionNumber'))
        if (!isCloudProvider(cloud) || versionNumber === null) throw new NotFoundError('Unknown cloud or version')

        return withRuntime(c, async () => {
            const version = await svc(c).getAppConfigHostedConfigurationVersion(cloud, c.req.param('id'), c.req.param('profileId'), versionNumber)
            if (!version) throw new NotFoundError('Hosted configuration version not found')
            return c.json(version)
        })
    })

    app.delete('/:cloud/services/configuration/resources/:id/configuration-profiles/:profileId/hosted-configuration-versions/:versionNumber', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const versionNumber = hostedVersionNumber(c.req.param('versionNumber'))
        if (!isCloudProvider(cloud) || versionNumber === null) throw new NotFoundError('Unknown cloud or version')

        return withRuntime(c, async () => {
            await svc(c).deleteAppConfigHostedConfigurationVersion(cloud, c.req.param('id'), c.req.param('profileId'), versionNumber)
            return c.json({ok: true})
        })
    })

    app.get('/:cloud/services/configuration/deployment-strategies', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            return c.json(await svc(c).listAppConfigDeploymentStrategies(cloud))
        })
    })

    app.post('/:cloud/services/configuration/deployment-strategies', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const values = await c.req.json<Record<string, unknown>>()
            return c.json(await svc(c).createAppConfigDeploymentStrategy(cloud, {values}), 201)
        })
    })

    app.delete('/:cloud/services/configuration/deployment-strategies/:strategyId', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            await svc(c).deleteAppConfigDeploymentStrategy(cloud, c.req.param('strategyId'))
            return c.json({ok: true})
        })
    })

    app.post('/:cloud/services/configuration/resources/:id/environments/:environmentId/deployments', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const values = await c.req.json<Record<string, unknown>>()
            return c.json(await svc(c).startAppConfigDeployment(cloud, c.req.param('id'), c.req.param('environmentId'), {values}), 201)
        })
    })

    app.get('/:cloud/services/configuration/resources/:id/environments/:environmentId/deployments/:deploymentNumber', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const deploymentNumber = Number(c.req.param('deploymentNumber'))
        if (!isCloudProvider(cloud) || !Number.isInteger(deploymentNumber) || deploymentNumber <= 0) {
            throw new NotFoundError('Unknown cloud or deployment')
        }

        return withRuntime(c, async () => {
            const deployment = await svc(c).getAppConfigDeployment(cloud, c.req.param('id'), c.req.param('environmentId'), deploymentNumber)
            if (!deployment) throw new NotFoundError('Deployment not found')
            return c.json(deployment)
        })
    })

    app.get('/:cloud/services/serverless/resources/:id/triggers', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const triggers = await svc(c).listLambdaTriggers(cloud, c.req.param('id'))
            return c.json(triggers)
        })
    })

    app.post('/:cloud/services/serverless/resources/:id/triggers', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const input = await c.req.json<CreateLambdaTriggerInput>()
            const trigger = await svc(c).createLambdaTrigger(cloud, c.req.param('id'), input)
            return c.json(trigger, 201)
        })
    })

    app.delete('/:cloud/services/serverless/resources/:id/triggers/:triggerId', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withRuntime(c, async () => {
            const options = {
                type: c.req.query('type') ?? undefined,
                bucket: c.req.query('bucket') ?? undefined,
            }
            await svc(c).deleteLambdaTrigger(cloud, c.req.param('id'), c.req.param('triggerId'), options)
            return c.json({ok: true})
        })
    })

    // Child collections, parameterised by service. All the literal-segment
    // routes above (Cosmos containers, SQL, NoSQL items, email inbox, k8s
    // nodegroups/fargate profiles) must stay registered before these, or the
    // `:service` param below would swallow their requests first.

    app.get('/:cloud/services/:service/resources/:id/collections', async (c) => {
        const target = childTarget(c)
        if (!target) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            const page = await svc(c).listChildCollections(target.cloud, target.service, c.req.param('id'), pageQuery(c))
            return c.json(page)
        })
    })

    app.post('/:cloud/services/:service/resources/:id/collections', async (c) => {
        const target = childTarget(c)
        if (!target) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            const values = await c.req.json<Record<string, unknown>>()
            const collection = await svc(c).createChildCollection(target.cloud, target.service, c.req.param('id'), {values})
            return c.json(collection, 201)
        })
    })

    app.delete('/:cloud/services/:service/resources/:id/collections/:cid', async (c) => {
        const target = childTarget(c)
        if (!target) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            await svc(c).deleteChildCollection(target.cloud, target.service, c.req.param('id'), c.req.param('cid'))
            return c.json({ok: true})
        })
    })

    app.get('/:cloud/services/:service/resources/:id/collections/:cid/items', async (c) => {
        const target = childTarget(c)
        if (!target) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            const page = await svc(c).listCollectionItems(target.cloud, target.service, c.req.param('id'), c.req.param('cid'), pageQuery(c))
            return c.json(page)
        })
    })

    app.post('/:cloud/services/:service/resources/:id/collections/:cid/items', async (c) => {
        const target = childTarget(c)
        if (!target) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            const body = await c.req.json<Record<string, unknown>>()
            const item = await svc(c).putCollectionItem(target.cloud, target.service, c.req.param('id'), c.req.param('cid'), body)
            return c.json(item, 201)
        })
    })

    app.delete('/:cloud/services/:service/resources/:id/collections/:cid/items/:itemId', async (c) => {
        const target = childTarget(c)
        if (!target) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            await svc(c).deleteCollectionItem(target.cloud, target.service, c.req.param('id'), c.req.param('cid'), c.req.param('itemId'), c.req.query('partitionKey') ?? null)
            return c.json({ok: true})
        })
    })

    app.post('/:cloud/services/:service/resources/:id/collections/:cid/query', async (c) => {
        const target = childTarget(c)
        if (!target) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            const body = await c.req.json<QueryBody>()
            const page = await svc(c).queryCollectionItems(target.cloud, target.service, c.req.param('id'), c.req.param('cid'), body.query ?? '', bodyPageQuery(body))
            return c.json(page)
        })
    })

    app.get('/:cloud/services/:service/resources/:id/items', async (c) => {
        const target = childTarget(c)
        if (!target) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            const page = await svc(c).listFlatItems(target.cloud, target.service, c.req.param('id'), pageQuery(c))
            return c.json(page)
        })
    })

    app.post('/:cloud/services/:service/resources/:id/items', async (c) => {
        const target = childTarget(c)
        if (!target) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            const body = await c.req.json<Record<string, unknown>>()
            const item = await svc(c).putFlatItem(target.cloud, target.service, c.req.param('id'), body)
            return c.json(item, 201)
        })
    })

    app.delete('/:cloud/services/:service/resources/:id/items/:itemId', async (c) => {
        const target = childTarget(c)
        if (!target) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            await svc(c).deleteFlatItem(target.cloud, target.service, c.req.param('id'), c.req.param('itemId'), c.req.query('partitionKey') ?? null)
            return c.json({ok: true})
        })
    })

    app.post('/:cloud/services/:service/resources/:id/query', async (c) => {
        const target = childTarget(c)
        if (!target) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            const body = await c.req.json<QueryBody>()
            const page = await svc(c).queryFlatItems(target.cloud, target.service, c.req.param('id'), body.query ?? '', bodyPageQuery(body))
            return c.json(page)
        })
    })

    app.post('/:cloud/services/:service/resources/:id/key-query', async (c) => {
        const target = childTarget(c)
        if (!target) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            const body = await c.req.json<PageBody>()
            const page = await svc(c).queryFlatItemsByKey(target.cloud, target.service, c.req.param('id'), parseKeyQuery(body), bodyPageQuery(body))
            return c.json(page)
        })
    })

    app.get('/:cloud/services/:service/resources/:id', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            const resource = await svc(c).getResource(cloud, serviceType, c.req.param('id'))
            if (!resource) throw new NotFoundError('Resource not found')
            return c.json(resource)
        })
    })

    app.get('/:cloud/services/:service/resources/:id/objects', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            const objects = await svc(c).listObjects(cloud, serviceType, c.req.param('id'), c.req.query('prefix') ?? '')
            return c.json(objects)
        })
    })

    app.put('/:cloud/services/:service/resources/:id/object', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) throw new NotFoundError('Unknown cloud or service')

        const key = c.req.query('key') ?? ''
        if (!key) throw new ValidationError('Object key is required')
        const body = new Uint8Array(await c.req.arrayBuffer())
        const contentType = c.req.header('content-type') ?? 'application/octet-stream'
        return withRuntime(c, async () => {
            await svc(c).putObject(cloud, serviceType, c.req.param('id'), key, body, contentType)
            return c.json({ok: true})
        })
    })

    app.get('/:cloud/services/:service/resources/:id/object', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) throw new NotFoundError('Unknown cloud or service')

        const key = c.req.query('key') ?? ''
        if (!key) throw new ValidationError('Object key is required')
        return withRuntime(c, async () => {
            const object = await svc(c).getObject(cloud, serviceType, c.req.param('id'), key)
            return new Response(object.body, {
                headers: {
                    'content-type': object.contentType,
                    ...(object.contentLength === null ? {} : {'content-length': String(object.contentLength)}),
                    'content-disposition': `attachment; filename="${key.split('/').pop() ?? key}"`,
                },
            })
        })
    })

    app.delete('/:cloud/services/:service/resources/:id/object', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) throw new NotFoundError('Unknown cloud or service')

        const key = c.req.query('key') ?? ''
        if (!key) throw new ValidationError('Object key is required')
        return withRuntime(c, async () => {
            await svc(c).deleteObject(cloud, serviceType, c.req.param('id'), key)
            return c.json({ok: true})
        })
    })

    app.post('/:cloud/services/:service/resources/:id/object/copy', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) throw new NotFoundError('Unknown cloud or service')

        const {srcKey, destKey, destResourceId} = await c.req.json<{srcKey: string; destKey: string; destResourceId?: string}>()
        if (!srcKey || !destKey) throw new ValidationError('srcKey and destKey are required')

        return withRuntime(c, async () => {
            await svc(c).copyObject(cloud, serviceType, c.req.param('id'), srcKey, destKey, destResourceId)
            return c.json({ok: true})
        })
    })

    app.post('/:cloud/services/:service/resources/:id/invoke', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) {
            throw new NotFoundError('Unknown cloud or service')
        }

        return withRuntime(c, async () => {
            const body: {payload?: string} = await c.req.json<{payload?: string}>().catch(() => ({}))
            const result = await svc(c).invokeResource(
                cloud,
                serviceType,
                c.req.param('id'),
                body.payload ?? '{}',
            )
            return c.json(result)
        })
    })

    app.post('/:cloud/services/:service/resources/:id/messages', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) {
            throw new NotFoundError('Unknown cloud or service')
        }

        return withRuntime(c, async () => {
            const body = await jsonBody<{body?: unknown; attributes?: unknown}>(c)
            if (typeof body.body !== 'string' || body.body.length === 0) {
                throw new ValidationError('body is required')
            }
            let attributes: Record<string, string> | undefined
            if (body.attributes !== undefined) {
                if (!body.attributes || typeof body.attributes !== 'object' || Array.isArray(body.attributes)) {
                    throw new ValidationError('attributes must be an object of string values')
                }
                const entries = Object.entries(body.attributes)
                if (entries.some(([, v]) => typeof v !== 'string')) {
                    throw new ValidationError('attributes must be an object of string values')
                }
                attributes = body.attributes as Record<string, string>
            }
            const result = await svc(c).sendQueueMessage(cloud, serviceType, c.req.param('id'), body.body, attributes)
            return c.json(result)
        })
    })

    app.get('/:cloud/services/:service/resources/:id/messages', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) {
            throw new NotFoundError('Unknown cloud or service')
        }

        const maxMessagesParam = c.req.query('maxMessages')
        const maxMessages = maxMessagesParam ? Number(maxMessagesParam) : undefined
        if (maxMessagesParam !== undefined && (!Number.isInteger(maxMessages) || maxMessages! < 1 || maxMessages! > 10)) {
            throw new ValidationError('maxMessages must be an integer between 1 and 10')
        }

        return withRuntime(c, async () => {
            const messages = await svc(c).receiveQueueMessages(cloud, serviceType, c.req.param('id'), maxMessages)
            return c.json({messages})
        })
    })

    app.delete('/:cloud/services/:service/resources/:id/messages', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) {
            throw new NotFoundError('Unknown cloud or service')
        }

        const receiptHandle = c.req.query('receiptHandle') ?? ''
        if (!receiptHandle) throw new ValidationError('receiptHandle is required')
        return withRuntime(c, async () => {
            await svc(c).deleteQueueMessage(cloud, serviceType, c.req.param('id'), receiptHandle)
            return c.json({ok: true})
        })
    })

    app.post('/:cloud/services/:service/resources/:id/purge', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) {
            throw new NotFoundError('Unknown cloud or service')
        }

        return withRuntime(c, async () => {
            await svc(c).purgeQueue(cloud, serviceType, c.req.param('id'))
            return c.json({ok: true})
        })
    })

    app.post('/:cloud/services/kms/resources/:id/encrypt', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withSensitiveRuntime(c, async () => {
            const body = await kmsJsonBody<KmsEncryptRequest>(c)
            const result = await svc(c).encryptKms(cloud, c.req.param('id'), {
                plaintext: decodeBase64(body.plaintextBase64, 'plaintextBase64', MAX_PLAINTEXT_BASE64_LENGTH),
                encryptionAlgorithm: encryptionAlgorithm(body.encryptionAlgorithm),
                encryptionContext: encryptionContext(body.encryptionContext),
            })
            return c.json({
                ciphertextBlobBase64: Buffer.from(result.ciphertextBlob).toString('base64'),
                keyId: result.keyId,
                encryptionAlgorithm: result.encryptionAlgorithm,
            })
        })
    })

    app.post('/:cloud/services/kms/resources/:id/decrypt', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')

        return withSensitiveRuntime(c, async () => {
            const body = await kmsJsonBody<KmsDecryptRequest>(c)
            const result = await svc(c).decryptKms(cloud, c.req.param('id'), {
                ciphertextBlob: decodeBase64(
                    body.ciphertextBlobBase64,
                    'ciphertextBlobBase64',
                    MAX_CIPHERTEXT_BASE64_LENGTH,
                ),
                encryptionAlgorithm: encryptionAlgorithm(body.encryptionAlgorithm),
                encryptionContext: encryptionContext(body.encryptionContext),
            })
            return c.json({
                plaintextBase64: Buffer.from(result.plaintext).toString('base64'),
                keyId: result.keyId,
                encryptionAlgorithm: result.encryptionAlgorithm,
            })
        })
    })

    for (const action of COMPUTE_POWER_ACTIONS) {
        app.post(`/:cloud/services/compute/resources/:id/${action}`, async (c) => {
            const cloud = c.req.param('cloud') as CloudProvider
            if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')
            return withRuntime(c, async () => c.json(await svc(c).powerCompute(cloud, c.req.param('id'), action)))
        })
    }

    app.post('/:cloud/services/kms/resources/:id/rotate', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')
        return withRuntime(c, async () => c.json(await svc(c).rotateKms(cloud, c.req.param('id'))))
    })

    app.post('/:cloud/services/kms/resources/:id/sign', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')
        return withSensitiveRuntime(c, async () => {
            const body = await kmsJsonBody<KmsSignRequest>(c)
            const result = await svc(c).signKms(cloud, c.req.param('id'), {
                message: decodeBase64(body.messageBase64, 'messageBase64', MAX_PLAINTEXT_BASE64_LENGTH),
                signingAlgorithm: signingAlgorithm(body.signingAlgorithm),
            })
            return c.json({
                signatureBase64: Buffer.from(result.signature).toString('base64'),
                keyId: result.keyId,
                keyVersionId: result.keyVersionId,
                signingAlgorithm: result.signingAlgorithm,
            })
        })
    })

    app.post('/:cloud/services/kms/resources/:id/verify', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')
        return withSensitiveRuntime(c, async () => {
            const body = await kmsJsonBody<KmsVerifyRequest>(c)
            const result = await svc(c).verifyKms(cloud, c.req.param('id'), {
                message: decodeBase64(body.messageBase64, 'messageBase64', MAX_PLAINTEXT_BASE64_LENGTH),
                signature: decodeBase64(body.signatureBase64, 'signatureBase64', MAX_CIPHERTEXT_BASE64_LENGTH),
                keyVersionId: requiredKmsString(body.keyVersionId, 'keyVersionId'),
                signingAlgorithm: signingAlgorithm(body.signingAlgorithm),
            })
            return c.json(result)
        })
    })

    app.post('/:cloud/services/kms/resources/:id/cancel-deletion', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')
        return withRuntime(c, async () => c.json(await svc(c).cancelKmsDeletion(cloud, c.req.param('id'))))
    })

    app.post('/:cloud/services/kms/resources/:id/recover', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')
        return withRuntime(c, async () => c.json(await svc(c).recoverKms(cloud, c.req.param('id'))))
    })

    app.post('/:cloud/services/kms/resources/:id/purge-deleted', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')
        return withRuntime(c, async () => {
            await svc(c).purgeDeletedKms(cloud, c.req.param('id'))
            return c.json({ok: true})
        })
    })

    app.post('/:cloud/services/secrets/resources/:id/recover', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')
        return withRuntime(c, async () => c.json(await svc(c).recoverSecret(cloud, c.req.param('id'))))
    })

    app.post('/:cloud/services/secrets/resources/:id/purge-deleted', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')
        return withRuntime(c, async () => {
            await svc(c).purgeDeletedSecret(cloud, c.req.param('id'))
            return c.json({ok: true})
        })
    })

    app.post('/:cloud/services/certificates/resources/:id/recover', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')
        return withRuntime(c, async () => c.json(await svc(c).recoverCertificate(cloud, c.req.param('id'))))
    })

    app.post('/:cloud/services/certificates/resources/:id/purge-deleted', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) throw new NotFoundError('Unknown cloud')
        return withRuntime(c, async () => {
            await svc(c).purgeDeletedCertificate(cloud, c.req.param('id'))
            return c.json({ok: true})
        })
    })

    app.post('/:cloud/services/:service/resources', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            const values = await jsonBody<Record<string, unknown>>(c)
            const resource = await svc(c).createResource(cloud, serviceType, {values})
            return c.json(resource, 201)
        })
    })

    app.patch('/:cloud/services/:service/resources/:id', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            const values = await c.req.json<Record<string, unknown>>()
            const resource = await svc(c).updateResource(cloud, serviceType, c.req.param('id'), {values})
            return c.json(resource, 200)
        })
    })

    app.delete('/:cloud/services/:service/resources/:id', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) throw new NotFoundError('Unknown cloud or service')

        return withRuntime(c, async () => {
            await svc(c).deleteResource(cloud, serviceType, c.req.param('id'))
            return c.json({ok: true})
        })
    })

    return app
}

function isCloudProvider(value: string): value is CloudProvider {
    return value === 'aws' || value === 'azure' || value === 'gcp' || value === 'oci'
}

async function jsonBody<T>(c: Context): Promise<T> {
    try {
        const body = await c.req.json<unknown>()
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new ValidationError('Request body must be a JSON object')
        }
        return body as T
    } catch (error) {
        if (error instanceof ValidationError) throw error
        throw new ValidationError('Request body must be valid JSON')
    }
}

/** Only errors from these route-owned checks may retain their specific message. */
class KmsRequestValidationError extends ValidationError {}

async function kmsJsonBody<T>(c: Context): Promise<T> {
    try {
        return await jsonBody<T>(c)
    } catch (error) {
        if (error instanceof ValidationError) throw new KmsRequestValidationError(error.message)
        throw error
    }
}

function encryptionAlgorithm(value: unknown): KmsEncryptionAlgorithm {
    if (typeof value !== 'string' || !KMS_ENCRYPTION_ALGORITHMS.has(value as KmsEncryptionAlgorithm)) {
        throw new KmsRequestValidationError('encryptionAlgorithm must be a supported KMS encryption algorithm')
    }
    return value as KmsEncryptionAlgorithm
}

function signingAlgorithm(value: unknown): KmsSigningAlgorithm {
    if (typeof value !== 'string' || !KMS_SIGNING_ALGORITHMS.has(value as KmsSigningAlgorithm)) {
        throw new KmsRequestValidationError('signingAlgorithm must be a supported KMS signing algorithm')
    }
    return value as KmsSigningAlgorithm
}

function requiredKmsString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 512) {
        throw new KmsRequestValidationError(`${field} must be a non-empty string of at most 512 characters`)
    }
    return value.trim()
}

function encryptionContext(value: unknown): Record<string, string> | undefined {
    if (value === undefined) return undefined
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new KmsRequestValidationError('encryptionContext must be an object of string values')
    }

    const entries = Object.entries(value)
    if (entries.some(([, entryValue]) => typeof entryValue !== 'string')) {
        throw new KmsRequestValidationError('encryptionContext must be an object of string values')
    }
    return entries.length === 0 ? undefined : Object.fromEntries(entries) as Record<string, string>
}

function decodeBase64(value: unknown, field: string, maxLength: number): Uint8Array {
    if (typeof value !== 'string') throw new KmsRequestValidationError(`${field} must be a base64 string`)
    if (value.length > maxLength) throw new KmsRequestValidationError(`${field} is too large`)
    if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        throw new KmsRequestValidationError(`${field} must be canonical base64`)
    }

    const decoded = Buffer.from(value, 'base64')
    if (decoded.toString('base64') !== value) throw new KmsRequestValidationError(`${field} must be canonical base64`)
    return decoded
}

/**
 * Resolve and validate the cloud/service pair for a child-collection route.
 * Returns null when either is unknown, which the caller turns into a 404.
 */
function childTarget(c: Context): {cloud: CloudProvider; service: CloudServiceType} | null {
    const cloud = c.req.param('cloud') as CloudProvider
    const service = c.req.param('service') as CloudServiceType
    if (!isCloudProvider(cloud) || !isServiceType(service)) return null
    return {cloud, service}
}

/** Parse paging params. An out-of-range limit raises and becomes a 400. */
function pageQuery(c: Context): PageQuery {
    return {cursor: c.req.query('cursor'), limit: clampLimit(c.req.query('limit'))}
}

interface PageBody {
    cursor?: unknown
    limit?: unknown
}

interface QueryBody extends PageBody {
    query?: string
}

// A query travels in the body, so its continuation does too: a cursor in the
// URL would sit next to a statement it is not valid for.
function bodyPageQuery(body: PageBody): PageQuery {
    if (body.cursor !== undefined && body.cursor !== null && typeof body.cursor !== 'string') {
        throw new ValidationError('cursor must be a string.')
    }
    if (body.limit !== undefined && body.limit !== null && typeof body.limit !== 'number') {
        throw new ValidationError('limit must be a number.')
    }
    return {cursor: body.cursor || undefined, limit: clampLimit(typeof body.limit === 'number' ? String(body.limit) : undefined)}
}

/**
 * Bun closes a connection that has sent nothing for its idle timeout, even while
 * the handler is still awaiting, so a route that can run longer raises the limit
 * for its own request. Without the server binding the route refuses to start.
 */
function extendRequestTimeout(c: Context, seconds: number): void {
    const server = (c.env as ApiBindings | undefined)?.server
    if (typeof server?.timeout !== 'function') {
        throw new Error('The Bun server binding is missing; serve the API through createBunFetch.')
    }
    server.timeout(c.req.raw, seconds)
}

async function withRuntime(c: Context, handler: () => Promise<Response>): Promise<Response> {
    try {
        return await handler()
    } catch (err) {
        const {status, body} = toHttpError(err, mapAwsSdkError)
        return c.json(body, status)
    }
}

async function withSensitiveRuntime(c: Context, handler: () => Promise<Response>): Promise<Response> {
    c.header('cache-control', 'no-store')
    try {
        return await handler()
    } catch (err) {
        const {status, body} = toHttpError(err, mapAwsSdkError)
        if (err instanceof KmsRequestValidationError) return c.json(body, status)
        const message = body.code === 'invalid_request' ? 'KMS rejected the request' : body.error
        return c.json({error: message, code: body.code, message}, status)
    }
}

/**
 * Collect values for the facets a service's schema actually declares.
 *
 * Driven by the schema rather than by "every query param that is not `search`",
 * so a stray or stale param never reaches an adapter that did not ask for it,
 * the same reason the service catalog gates unknown service slugs. `search` is
 * excluded because it is carried separately on `ResourceQuery`.
 */
function declaredFilters(
    schema: ServiceSchema | null,
    valueFor: (name: string) => string | undefined,
): Record<string, string> | undefined {
    const filters: Record<string, string> = {}

    for (const filter of schema?.filters ?? []) {
        if (filter.name === 'search') continue
        const value = valueFor(filter.name)
        if (value !== undefined && value !== '') filters[filter.name] = value
    }

    return Object.keys(filters).length > 0 ? filters : undefined
}

export default createCloudRoutes()
