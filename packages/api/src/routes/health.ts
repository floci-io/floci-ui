import {Hono} from 'hono'
import type {CloudProvider} from '../cloud-spi/types'
import {serviceForAccount} from '../cloudProxy'
import type {CloudProxyService} from '../service/CloudProxyService'
import {resolveScopedCloud} from '../service/defaultCloud'

/** The `/api/health` body of Console Contract v2 (v1's shape, which v2 keeps). */
export interface ConsoleHealth {
    status: 'ok' | 'unavailable'
    endpoint: string | null
    error: string | null
    console: {name: string}
}

/**
 * `GET /api/health`: what an emulator that started this console polls before it
 * sends the browser here.
 *
 * Scoped to an emulator's cloud, `ok` means that emulator answered, through the
 * same cached probe the sidebar uses, so a poll every second adds no load. A
 * standalone console has no one emulator to report on, so it reports itself.
 * Always 200: the status is in the body.
 */
export function createHealthRoutes(
    service: () => CloudProxyService = () => serviceForAccount(),
    scope: CloudProvider | null = resolveScopedCloud(),
) {
    const app = new Hono()

    app.get('/', async (c) => {
        if (scope === null) return c.json(health('ok', null, null))
        const status = await service().status(scope)
        return status.runtime === 'reachable'
            ? c.json(health('ok', status.endpoint, null))
            : c.json(health('unavailable', status.endpoint, status.error ?? 'The emulator did not answer'))
    })

    return app
}

function health(status: ConsoleHealth['status'], endpoint: string | null, error: string | null): ConsoleHealth {
    return {status, endpoint, error, console: {name: 'floci-ui'}}
}
