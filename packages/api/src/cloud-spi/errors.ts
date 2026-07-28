/**
 * Typed errors for the cloud SPI.
 *
 * Adapters throw these instead of bare `Error`s so `routes/clouds.ts` can map a
 * failure to an HTTP status without pattern-matching on message text. The wire
 * shape is deliberately unchanged from the hand-rolled mapper it replaces:
 * `message` carries a generic label and `detail` carries the raw runtime text.
 */

export type CloudErrorCode =
    | 'invalid_request'
    | 'access_denied'
    | 'resource_not_found'
    | 'resource_conflict'
    | 'rate_limited'
    | 'operation_not_supported'
    | 'operation_not_implemented'
    | 'runtime_unavailable'
    | 'runtime_error'
    | 'cosmos_nosql_unavailable'

export type CloudErrorStatus = 400 | 403 | 404 | 409 | 429 | 501 | 502 | 503

export interface CloudErrorBody {
    /** Mirrors `message`; kept for clients that read `error`. */
    error: string
    code: string
    message: string
    detail?: string
}

export abstract class CloudError extends Error {
    abstract readonly status: CloudErrorStatus
    abstract readonly code: CloudErrorCode

    /**
     * Generic, user-facing label. `message` holds the raw runtime text and is
     * surfaced as `detail`, so a label change never leaks adapter internals.
     */
    protected abstract readonly label: string

    constructor(message: string, options?: {cause?: unknown}) {
        super(message, options?.cause === undefined ? undefined : {cause: options.cause})
        this.name = new.target.name
    }

    toBody(): CloudErrorBody {
        const message = this.label
        const detail = this.message
        return {
            error: message,
            code: this.code,
            message,
            ...(detail && detail !== message ? {detail} : {}),
        }
    }
}

/** 400 — the caller sent something unusable. The raw message is the label. */
export class ValidationError extends CloudError {
    readonly status = 400 as const
    readonly code = 'invalid_request' as const
    protected get label(): string {
        return this.message
    }
}

export class AccessDeniedError extends CloudError {
    readonly status = 403 as const
    readonly code = 'access_denied' as const
    protected readonly label = 'Access denied by the runtime'
}

export class NotFoundError extends CloudError {
    readonly status = 404 as const
    readonly code = 'resource_not_found' as const
    protected readonly label = 'Resource not found'
}

export class ConflictError extends CloudError {
    readonly status = 409 as const
    readonly code = 'resource_conflict' as const
    protected readonly label = 'Resource already exists or is in use'
}

export class RateLimitedError extends CloudError {
    readonly status = 429 as const
    readonly code = 'rate_limited' as const
    protected readonly label = 'Runtime is throttling requests'
}

/** 501 — this adapter does not implement the operation at all. */
export class NotSupportedError extends CloudError {
    readonly status = 501 as const
    readonly code = 'operation_not_supported' as const
    protected readonly label = 'Operation is not supported by this adapter'
}

/** 501 — the adapter supports it but the local runtime answered NotImplemented. */
export class NotImplementedByRuntimeError extends CloudError {
    readonly status = 501 as const
    readonly code = 'operation_not_implemented' as const
    protected readonly label = 'Operation is not implemented by the selected runtime'
}

export class RuntimeUnavailableError extends CloudError {
    readonly status = 503 as const
    readonly code = 'runtime_unavailable' as const
    protected readonly label = 'Runtime unavailable'
}

export class RuntimeError extends CloudError {
    readonly status = 502 as const
    readonly code = 'runtime_error' as const
    protected readonly label = 'Runtime request failed'
}

/** Transport-level failure codes that mean "nothing is listening over there". */
const UNREACHABLE_CAUSE_CODES = new Set([
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
])

/**
 * Map a runtime HTTP status onto the matching `CloudError`. Shared by the Azure
 * and GCP REST clients so both report a 404 or a 501 the same way.
 */
export function httpStatusToCloudError(status: number, message: string, options?: {cause?: unknown}): CloudError {
    if (status === 400) return new ValidationError(message, options)
    if (status === 401 || status === 403) return new AccessDeniedError(message, options)
    if (status === 404) return new NotFoundError(message, options)
    if (status === 409) return new ConflictError(message, options)
    if (status === 429) return new RateLimitedError(message, options)
    if (status === 501) return new NotImplementedByRuntimeError(message, options)
    if (status === 502 || status === 503 || status === 504) return new RuntimeUnavailableError(message, options)
    return new RuntimeError(message, options)
}

/** True when the failure is a transport error rather than an HTTP response. */
export function isUnreachableCause(err: unknown): boolean {
    if (!(err instanceof Error)) return false
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return true

    let cause: unknown = err
    for (let depth = 0; depth < 5 && cause instanceof Error; depth += 1) {
        const code = (cause as {code?: unknown}).code
        if (typeof code === 'string' && UNREACHABLE_CAUSE_CODES.has(code)) return true
        cause = (cause as {cause?: unknown}).cause
    }
    return false
}

/**
 * The single place adapter failures become HTTP responses.
 *
 * `mapVendorError` lets a provider contribute SDK-specific knowledge (see
 * `adapter-aws/awsErrors.ts`) without `cloud-spi` importing any vendor package.
 */
export function toHttpError(
    err: unknown,
    mapVendorError?: (err: unknown) => CloudError | null,
): {status: CloudErrorStatus; body: CloudErrorBody} {
    const mapped = resolveCloudError(err, mapVendorError)
    return {status: mapped.status, body: mapped.toBody()}
}

function resolveCloudError(err: unknown, mapVendorError?: (err: unknown) => CloudError | null): CloudError {
    if (err instanceof CloudError) return err

    const vendor = mapVendorError?.(err)
    if (vendor) return vendor

    const message = err instanceof Error ? err.message : 'Runtime request failed'
    if (isUnreachableCause(err)) return new RuntimeUnavailableError(message, {cause: err})

    return new RuntimeError(message, {cause: err})
}
