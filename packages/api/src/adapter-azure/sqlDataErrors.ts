import {
    type CloudError,
    isUnreachableCause,
    RuntimeError,
    RuntimeUnavailableError,
    ValidationError,
} from '../cloud-spi/errors'

export type SqlDataPhase = 'connect' | 'query' | 'result'

export function mapSqlDataError(service: string, phase: SqlDataPhase, error: unknown): CloudError {
    const detail = error instanceof Error ? error.message : `Unknown ${service} error`
    const message = `${service} data request failed: ${detail}`
    const options = {cause: error}

    if (phase === 'connect' || isUnreachableCause(error)) {
        return new RuntimeUnavailableError(message, options)
    }
    if (phase === 'query' && error instanceof Error) {
        return new ValidationError(message, options)
    }
    return new RuntimeError(message, options)
}
