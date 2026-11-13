import {Hono} from 'hono'
import type {MiddlewareHandler} from 'hono'
import {clampLimit} from '../cloud-spi/childCollections'
import {CloudError, toHttpError, ValidationError} from '../cloud-spi/errors'
import type {CloudProvider} from '../cloud-spi/types'
import {
    activityLog,
    ActivityLog,
    type ActivityFilter,
    type ActivityStatus,
} from '../service/activityLog'

/**
 * The activity feed records what the console API *changes*, so only mutating
 * methods are interesting: reads would bury the feed in list calls. Everything
 * the console does passes through here (generic SPI routes and the legacy
 * AWS-only routes alike), which is also why one mounted middleware is enough
 * rather than a call site in every adapter.
 */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const BROWSER_USER_AGENT = /mozilla|chrome|firefox|safari|electron|webkit/i

/**
 * Legacy per-service routes predate `/api/clouds` and are AWS only. The feed
 * stores the catalog key so one service filter covers both shapes.
 */
const LEGACY_SERVICES: Record<string, string> = {
    ec2: 'compute',
    eks: 'k8s',
    secretsmanager: 'secrets',
}

/** POST actions that mean something other than "created a resource". */
const ACTION_LABELS: Record<string, string> = {
    messages: 'Send',
    'stream-messages': 'Send',
    tags: 'Tag',
    object: 'Copy',
}

/** POST actions that are operations on an existing resource, not a create. */
const ACTION_VERBS = new Set([
    'start', 'stop', 'reboot', 'invoke',
    'encrypt', 'decrypt', 'sign', 'verify', 'rotate',
    'recover', 'purge', 'purge-deleted', 'cancel-deletion', 'empty',
    'attach', 'detach', 'associate', 'disassociate',
    'authorize', 'authorize-egress', 'revoke', 'revoke-egress',
    'modify-attribute', 'release', 'deregister',
])

const CLOUD_PROVIDERS = new Set(['aws', 'azure', 'gcp', 'oci'])

export interface ResourceRequest {
    cloud: CloudProvider | null
    service: string | null
    operation: string
    resourceId: string | null
    action: string | null
}

/**
 * Maps a console path to the facts the feed shows. Returns null for anything
 * that is not a resource operation: reads, non-resource endpoints, and paths
 * the console does not serve.
 *
 * Notably, some reads are POSTs (credentials travel in the body: SQL queries,
 * Cosmos queries, Logs Insights). Recording them would label a query as a
 * create, so they are skipped rather than mislabelled.
 */
export function describeRequest(method: string, path: string): ResourceRequest | null {
    if (!MUTATING_METHODS.has(method)) return null

    const parts = path.split('/').filter(Boolean)
    let service: string
    let cloud: CloudProvider | null = null
    let rest: string[]

    if (parts[0] === 'api' && parts[1] === 'clouds' && parts[3] === 'services') {
        cloud = isCloudProvider(parts[2]) ? (parts[2] as CloudProvider) : null
        service = parts[4]
        rest = parts.slice(5)
        if (!service) return null
    } else if (parts[0] === 'api' && LEGACY_SERVICES[parts[1]]) {
        cloud = 'aws'
        service = LEGACY_SERVICES[parts[1]]
        rest = parts.slice(2)
    } else {
        return null
    }

    if (isReadPost(rest)) return null

    let resourceId: string | null = null
    let action: string | null = null
    if (rest[0] === 'resources') {
        resourceId = rest[1] ?? null
        action = rest[2] ?? null
    } else if (rest.length >= 2) {
        // Legacy shape: /instances/:id[/action], or a child route without a
        // `resources` segment. With one segment there is no resource yet.
        resourceId = rest[1]
        action = rest[2] ?? null
    } else if (rest.length === 1) {
        action = rest[0]
    }

    return {
        cloud,
        service,
        operation: operationFor(method, action, resourceId !== null),
        resourceId,
        action,
    }
}

function isCloudProvider(value: string | undefined): boolean {
    return typeof value === 'string' && CLOUD_PROVIDERS.has(value)
}

/** `POST .../sql/databases` and any `.../query` read state; they do not change it. */
function isReadPost(rest: string[]): boolean {
    const last = rest[rest.length - 1]
    if (!last) return false
    if (last.endsWith('query')) return true
    return rest[rest.length - 2] === 'sql' && (last === 'databases' || last === 'tables')
}

function operationFor(method: string, action: string | null, hasResourceId: boolean): string {
    if (method === 'DELETE') return action === 'inbox' ? 'Clear' : 'Delete'
    if (method === 'PUT' || method === 'PATCH') return 'Update'
    // POST from here on.
    if (!action) return hasResourceId ? 'Update' : 'Create'
    if (action.startsWith('create')) return 'Create'
    const labeled = ACTION_LABELS[action]
    if (labeled) return labeled
    if (ACTION_VERBS.has(action)) return humanize(action)
    // A trailing segment that is not a known verb is the plural child being
    // created: environments, triggers, nodegroups, snapshots, and friends.
    return 'Create'
}

function humanize(action: string): string {
    const words = action.replace(/-/g, ' ')
    return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Source of the call, best effort from the caller's user agent. Everything
 * reaching this middleware came in over HTTP, so the console's own browser
 * requests and a script talking to the API are distinguishable; traffic that
 * goes straight to the emulator never reaches the console at all (see the
 * issue thread for why a durable cross-client feed lives with CloudTrail).
 */
function sourceFor(userAgent: string): string {
    const ua = userAgent.toLowerCase()
    if (ua.includes('aws-cli')) return 'AWS CLI'
    if (ua.includes('terraform') || ua.includes('opentofu')) return 'Terraform/OpenTofu'
    if (BROWSER_USER_AGENT.test(ua)) return 'Floci UI'
    return 'API client'
}

/**
 * Records every mutating request the console API serves into the shared feed.
 * Mounted once under `/api/*` so the generic SPI routes and the legacy routes
 * are both covered without touching either.
 */
export function activityRecorder(log: ActivityLog = activityLog): MiddlewareHandler {
    return async (c, next) => {
        if (!MUTATING_METHODS.has(c.req.method)) return next()

        // A handler failure may surface as a thrown error (mapped by an app-level
        // `onError` outside this middleware) or already as a response, depending
        // on where the error handler sits. Record both shapes as one failure.
        let thrown: {error: unknown} | null = null
        try {
            await next()
        } catch (error) {
            thrown = {error}
        }

        const described = describeRequest(c.req.method, c.req.path)
        if (described) {
            const response = thrown === null ? c.res : null
            const statusCode = thrown !== null
                ? (thrown.error instanceof CloudError ? toHttpError(thrown.error).status : 500)
                : c.res.status
            const body = response ? await readJsonObject(response) : null
            log.record({
                cloud: described.cloud,
                service: described.service,
                operation: described.operation,
                resourceType: stringField(body, 'type'),
                resourceName: resourceNameFor(described, c.req.query(), body),
                status: statusCode < 400 ? 'success' : 'failed',
                statusCode,
                source: sourceFor(c.req.header('user-agent') ?? ''),
                httpMethod: c.req.method,
                path: c.req.path,
                detail: failureDetail(thrown?.error, statusCode, body),
            })
        }

        if (thrown !== null) throw thrown.error
    }
}

function resourceNameFor(
    described: ResourceRequest,
    query: Record<string, string>,
    body: Record<string, unknown> | null,
): string | null {
    if (described.action === 'object') {
        // Object writes name their target in the query string, not the body.
        const key = query.key ?? query.destKey
        if (key) return key
    }
    const named = stringField(body, 'name') ?? stringField(body, 'id')
    return named ?? described.resourceId
}

function failureDetail(error: unknown, statusCode: number, body: Record<string, unknown> | null): string | null {
    if (error instanceof CloudError) {
        const {body: errorBody} = toHttpError(error)
        return errorBody.detail ?? errorBody.message ?? null
    }
    if (error instanceof Error && error.message) return error.message
    if (statusCode >= 400) return bodyDetail(body)
    return null
}

function bodyDetail(body: Record<string, unknown> | null): string | null {
    return stringField(body, 'detail') ?? stringField(body, 'message') ?? stringField(body, 'error')
}

function stringField(body: Record<string, unknown> | null, field: string): string | null {
    const value = body?.[field]
    return typeof value === 'string' && value ? value : null
}

async function readJsonObject(response: Response): Promise<Record<string, unknown> | null> {
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('json')) return null
    try {
        // Clone: the client's copy of the stream must stay untouched.
        const parsed: unknown = await response.clone().json()
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
        return parsed as Record<string, unknown>
    } catch {
        return null
    }
}

/**
 * `GET /api/activity`: the recorded feed, newest first, with the facet values
 * each filter offers. Deliberately a console endpoint rather than a cloud one:
 * it aggregates what this console did, across every cloud it serves.
 */
export function createActivityRoutes(log: ActivityLog = activityLog): Hono {
    const app = new Hono()

    app.onError((err, c) => {
        if (err instanceof CloudError) {
            const {status, body} = toHttpError(err)
            return c.json(body, status)
        }
        console.error(err)
        return c.text('Internal Server Error', 500)
    })

    app.get('/', (c) => c.json(log.query(parseFilter(c.req.query()))))

    return app
}

function parseFilter(query: Record<string, string | undefined>): ActivityFilter {
    const filter: ActivityFilter = {limit: clampLimit(query.limit)}

    if (query.cloud) filter.cloud = query.cloud
    if (query.service) filter.service = query.service
    if (query.operation) filter.operation = query.operation
    if (query.resourceType) filter.resourceType = query.resourceType
    if (query.search) filter.search = query.search
    if (query.cursor) filter.cursor = query.cursor

    if (query.status) {
        if (query.status !== 'success' && query.status !== 'failed') {
            throw new ValidationError('status must be success or failed.')
        }
        filter.status = query.status as ActivityStatus
    }
    if (query.from) filter.from = parseInstant(query.from, 'from')
    if (query.to) filter.to = parseInstant(query.to, 'to')

    return filter
}

/** Epoch seconds or milliseconds, or anything else `Date.parse` accepts. */
function parseInstant(raw: string, field: string): number {
    if (/^\d+$/.test(raw)) {
        const value = Number(raw)
        return value < 1e12 ? value * 1000 : value
    }
    const parsed = Date.parse(raw)
    if (Number.isNaN(parsed)) throw new ValidationError(`${field} must be a date or an epoch timestamp.`)
    return parsed
}
