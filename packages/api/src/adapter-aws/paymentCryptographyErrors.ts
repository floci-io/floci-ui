import {isAwsSdkError, NOT_FOUND_NAMES, NOT_IMPLEMENTED_NAMES} from './awsErrors'

/**
 * Whether an error says the resource is not there.
 *
 * <p>Payment Cryptography answers a missing key with `ResourceNotFoundException`
 * and HTTP **400**, the way KMS does, so the name is the signal. The names are
 * the shared ones, so the rule lives in one table rather than in a narrower
 * copy of it.
 *
 * <p>The status is only a fallback for the emulator, and it is read through the
 * error envelope, so an error that does not carry one is not read at all. A
 * runtime that does not serve the operation at all answers 404 with a name of
 * its own, and that name keeps its own meaning: it is a gap in the runtime and
 * not a resource that is not there.
 */
export function isNotFound(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    const name = (error as {name?: string}).name ?? ''
    if (NOT_IMPLEMENTED_NAMES.has(name)) return false
    if (NOT_FOUND_NAMES.has(name) || /\.NotFound$/.test(name)) return true
    if (!isAwsSdkError(error)) return false
    const metadata = (error as {$metadata?: {httpStatusCode?: number}}).$metadata
    return metadata?.httpStatusCode === 404
}
