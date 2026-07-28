import {CloudError, type CloudErrorStatus} from '../cloud-spi/errors'

/**
 * Raised when none of the known Cosmos NoSQL route shapes answered on the
 * Floci-AZ runtime. Keeps its own wire code so the frontend can keep telling
 * "Cosmos is not enabled on this runtime" apart from a generic runtime failure.
 */
export class CosmosNoSqlUnavailableError extends CloudError {
    readonly status: CloudErrorStatus = 502
    readonly code = 'cosmos_nosql_unavailable' as const
    protected readonly label = 'Cosmos NoSQL endpoint is not available on the selected Floci-AZ runtime'
}
