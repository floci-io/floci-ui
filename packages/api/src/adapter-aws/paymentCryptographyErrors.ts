/**
 * Whether an error says the resource is not there.
 *
 * <p>Payment Cryptography answers a missing key with `ResourceNotFoundException` and
 * HTTP **400**, the way KMS does, so the name is the signal and the status is only
 * a fallback for the emulator.
 */
export function isNotFound(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    if ((error as {name?: string}).name === 'ResourceNotFoundException') return true
    const metadata = (error as {$metadata?: {httpStatusCode?: number}}).$metadata
    return metadata?.httpStatusCode === 404
}
