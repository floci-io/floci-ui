/**
 * Maps AWS SDK v3 errors onto cloud-SPI errors.
 *
 * Vendor knowledge lives here rather than in `cloud-spi/` so the generic mapper
 * stays provider-neutral. Match order matters: throttling first, then the name
 * tables, and `$metadata.httpStatusCode` only as a last resort — local emulators
 * are less consistent about status codes than they are about error names.
 */

import {
    AccessDeniedError,
    type CloudError,
    ConflictError,
    NotFoundError,
    NotImplementedByRuntimeError,
    RateLimitedError,
    RuntimeError,
    RuntimeUnavailableError,
    ValidationError,
    isUnreachableCause,
} from '../cloud-spi/errors'

interface AwsSdkErrorShape {
    name?: string
    message?: string
    $fault?: 'client' | 'server'
    $retryable?: {throttling?: boolean}
    $metadata?: {httpStatusCode?: number}
}

const THROTTLING_NAMES = new Set([
    'ThrottlingException',
    'Throttling',
    'ThrottledException',
    'TooManyRequestsException',
    'RequestLimitExceeded',
    'ProvisionedThroughputExceededException',
    'RequestThrottled',
    'RequestThrottledException',
    'SlowDown',
    'LimitExceededException',
])

const CONFLICT_NAMES = new Set([
    'BucketAlreadyExists',
    'BucketAlreadyOwnedByYou',
    'EntityAlreadyExists',
    'EntityAlreadyExistsException',
    'ResourceInUseException',
    'ResourceConflictException',
    'ConditionalCheckFailedException',
    'QueueNameExists',
    'QueueDeletedRecently',
    'InvalidChangeBatch',
    'DBInstanceAlreadyExists',
    'DBInstanceAlreadyExistsFault',
    'ConcurrentModificationException',
    'IncorrectState',
])

const ACCESS_DENIED_NAMES = new Set([
    'AccessDenied',
    'AccessDeniedException',
    'UnauthorizedOperation',
    'AuthFailure',
    'InvalidClientTokenId',
    'SignatureDoesNotMatch',
    'Forbidden',
    'MissingAuthenticationToken',
    'InvalidAccessKeyId',
])

const VALIDATION_NAMES = new Set([
    'ValidationException',
    'ValidationError',
    'InvalidParameterValue',
    'InvalidParameterValueException',
    'InvalidParameterCombination',
    'InvalidRequestException',
    'InvalidInput',
    'InvalidInputException',
    'MissingParameter',
    'MissingRequiredParameter',
    'SerializationException',
    'MalformedPolicyDocument',
    'MalformedPolicyDocumentException',
    'InvalidArgsException',
    'InvalidBucketName',
    'InvalidArgumentException',
    'InvalidParameterException',
])

const NOT_FOUND_NAMES = new Set([
    'NoSuchBucket',
    'NoSuchKey',
    'NoSuchEntity',
    'NotFound',
    'NotFoundException',
    'ResourceNotFoundException',
    'ResourceNotFoundFault',
    'DBInstanceNotFound',
    'DBInstanceNotFoundFault',
    'ParameterNotFound',
    'QueueDoesNotExist',
    'SecretNotFoundException',
    'NoSuchLogGroup',
    'NoSuchResourceException',
    'InvalidInstanceID.NotFound',
    'InvalidVpcID.NotFound',
    'InvalidSubnetID.NotFound',
    'InvalidGroupId.NotFound',
    'InvalidAMIID.NotFound',
])

const NOT_IMPLEMENTED_NAMES = new Set([
    'NotImplemented',
    'UnsupportedOperation',
    'UnsupportedOperationException',
])

const UNAVAILABLE_NAMES = new Set([
    'NetworkingError',
    'TimeoutError',
    'ServiceUnavailable',
    'ServiceUnavailableException',
    'RequestTimeout',
    'InternalFailure',
    'InternalError',
])

/** True when the value carries the AWS SDK v3 error envelope. */
export function isAwsSdkError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false
    return '$metadata' in err || '$fault' in err || '$retryable' in err
}

/**
 * Translate an AWS SDK error, or return `null` when it is not one so the caller
 * can fall through to the generic mapping.
 */
export function mapAwsSdkError(err: unknown): CloudError | null {
    if (!isAwsSdkError(err)) return null

    const sdkError = err as AwsSdkErrorShape
    const name = sdkError.name ?? ''
    const message = sdkError.message ?? name ?? 'AWS request failed'
    const options = {cause: err}

    if (sdkError.$retryable?.throttling === true || THROTTLING_NAMES.has(name)) {
        return new RateLimitedError(message, options)
    }
    if (CONFLICT_NAMES.has(name) || /AlreadyExists(Exception|Fault)?$/.test(name)) {
        return new ConflictError(message, options)
    }
    if (ACCESS_DENIED_NAMES.has(name)) return new AccessDeniedError(message, options)
    if (VALIDATION_NAMES.has(name)) return new ValidationError(message, options)
    if (NOT_FOUND_NAMES.has(name) || /\.NotFound$/.test(name)) return new NotFoundError(message, options)
    if (NOT_IMPLEMENTED_NAMES.has(name)) return new NotImplementedByRuntimeError(message, options)
    if (UNAVAILABLE_NAMES.has(name) || isUnreachableCause(err)) {
        return new RuntimeUnavailableError(message, options)
    }

    // Emulator status codes are less reliable than names, so this is the floor.
    const status = sdkError.$metadata?.httpStatusCode
    if (status === 400) return new ValidationError(message, options)
    if (status === 401 || status === 403) return new AccessDeniedError(message, options)
    if (status === 404) return new NotFoundError(message, options)
    if (status === 409) return new ConflictError(message, options)
    if (status === 429) return new RateLimitedError(message, options)
    if (status === 501) return new NotImplementedByRuntimeError(message, options)
    if (status === 503 || status === 504) return new RuntimeUnavailableError(message, options)

    return new RuntimeError(message, options)
}
