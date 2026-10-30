import {describe, expect, test} from 'bun:test'
import {createApiApp} from '../app'
import {azureEndpoint} from '../azure'
import {RuntimeUnavailableError} from '../cloud-spi/errors'
import type {CloudProvider} from '../cloud-spi/types'
import {CloudAdapterRegistry} from '../registry/CloudAdapterRegistry'
import {CloudProxyService} from '../service/CloudProxyService'
import type {RuntimeProbe} from '../service/runtimeProbe'
import {createCloudRoutes} from './clouds'
import {createHealthRoutes} from './health'

const HEALTH_URL = 'http://localhost/api/health'

function serviceWith(azureProbe: RuntimeProbe, scope: CloudProvider | null = 'azure') {
    const probes: Record<CloudProvider, RuntimeProbe> = {
        aws: async () => {},
        azure: azureProbe,
        gcp: async () => {},
        oci: async () => {},
    }
    return new CloudProxyService(new CloudAdapterRegistry([]), probes, scope)
}

function app(service: CloudProxyService, scope: CloudProvider | null) {
    return createApiApp(createCloudRoutes(service), scope, createHealthRoutes(() => service, scope))
}

describe('GET /api/health', () => {
    test("reports ok when the scoped cloud's emulator answers", async () => {
        const res = await app(serviceWith(async () => {}), 'azure').request(HEALTH_URL)

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({
            status: 'ok',
            endpoint: azureEndpoint(),
            error: null,
            console: {name: 'floci-ui'},
        })
    })

    test('reports unavailable with the reason when it does not, still with a 200', async () => {
        const down = async () => {
            throw new RuntimeUnavailableError('Cannot reach Floci-AZ at http://localhost:4577: connection refused')
        }
        const res = await app(serviceWith(down), 'azure').request(HEALTH_URL)

        expect(res.status).toBe(200)
        const body = await res.json() as {status: string; error: string}
        expect(body.status).toBe('unavailable')
        expect(body.error).toContain('connection refused')
    })

    test('reports a standalone console as ok without probing anything', async () => {
        let probed = false
        const service = serviceWith(async () => {
            probed = true
        }, null)
        const res = await app(service, null).request(HEALTH_URL)

        expect(await res.json()).toEqual({status: 'ok', endpoint: null, error: null, console: {name: 'floci-ui'}})
        expect(probed).toBe(false)
    })

    test('reuses the cached probe, so polling adds no load', async () => {
        let probes = 0
        const health = app(serviceWith(async () => {
            probes += 1
        }), 'azure')
        for (let i = 0; i < 3; i++) await health.request(HEALTH_URL)

        expect(probes).toBe(1)
    })

    test('is served as JSON, not as the frontend', async () => {
        const res = await app(serviceWith(async () => {}), 'azure').request(HEALTH_URL)
        expect(res.headers.get('content-type')).toContain('application/json')
    })
})
