import {Firestore} from '@google-cloud/firestore'
import {CloudError, httpStatusToCloudError} from './cloud-spi/errors'
import {gcpEndpoint, gcpProject} from './gcp'

/**
 * Firestore on Floci-GCP is gRPC only (`google.firestore.v1`); the REST surface
 * answers 404, so unlike the other GCP adapters this one goes through the
 * official SDK, the way the AWS adapters do. Pointing the SDK at a plain `host`
 * switches it to the emulator's plaintext channel.
 */
export function createFirestoreClient(endpoint: string = gcpEndpoint(), projectId: string = gcpProject()): Firestore {
    // google-auth-library probes the GCE metadata server before the first call,
    // a multi-second stall off GCE. The emulator does not authenticate.
    process.env.METADATA_SERVER_DETECTION ??= 'none'
    const url = new URL(endpoint)
    return new Firestore({projectId, host: url.host, ssl: url.protocol === 'https:'})
}

/** gRPC status code -> the HTTP status `httpStatusToCloudError` understands. */
const GRPC_TO_HTTP: Record<number, number> = {
    3: 400, // INVALID_ARGUMENT
    5: 404, // NOT_FOUND
    6: 409, // ALREADY_EXISTS
    7: 403, // PERMISSION_DENIED
    16: 403, // UNAUTHENTICATED
    8: 429, // RESOURCE_EXHAUSTED
    12: 501, // UNIMPLEMENTED
    14: 503, // UNAVAILABLE
}

/** SDK failures carry a numeric gRPC `code`; anything else is rethrown as is. */
export function toFirestoreCloudError(error: unknown): unknown {
    if (error instanceof CloudError) return error
    const code = (error as {code?: unknown} | null)?.code
    if (typeof code !== 'number' || !(code in GRPC_TO_HTTP)) return error
    const message = error instanceof Error ? error.message : 'Firestore request failed'
    return httpStatusToCloudError(GRPC_TO_HTTP[code], `Firestore: ${decodeMessage(message)}`, {cause: error})
}

/** The emulator percent-encodes its messages; a malformed escape keeps the raw text. */
function decodeMessage(message: string): string {
    try {
        return decodeURIComponent(message)
    } catch {
        return message
    }
}
