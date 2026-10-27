import {describe, expect, it} from 'bun:test'
import {CloudAdapterRegistry} from '../registry/CloudAdapterRegistry'
import {createCloudRoutes} from '../routes/clouds'
import {CloudProxyService} from './CloudProxyService'
import {resolveDefaultCloud, resolveScopedCloud} from './defaultCloud'
import {createApiApp} from '../app'

function service(scope: 'aws' | 'azure' | 'gcp' | 'oci' | null) {
    return new CloudProxyService(new CloudAdapterRegistry([]), undefined, scope)
}

describe('resolveScopedCloud', () => {
    it('serves every cloud when no emulator names its own', () => {
        expect(resolveScopedCloud({})).toBeNull()
        expect(resolveScopedCloud({FLOCI_CLOUD: ''})).toBeNull()
        expect(resolveScopedCloud({FLOCI_CLOUD: '  '})).toBeNull()
    })

    it('ignores a value no emulator uses rather than locking the console', () => {
        expect(resolveScopedCloud({FLOCI_CLOUD: 'ibm'})).toBeNull()
    })

    it('does not read a value off the prototype of its id table', () => {
        for (const value of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
            expect(resolveScopedCloud({FLOCI_CLOUD: value})).toBeNull()
        }
    })

    it('maps the emulator id az to the azure cloud', () => {
        expect(resolveScopedCloud({FLOCI_CLOUD: 'az'})).toBe('azure')
        expect(resolveScopedCloud({FLOCI_CLOUD: 'azure'})).toBe('azure')
        expect(resolveScopedCloud({FLOCI_CLOUD: ' AZ '})).toBe('azure')
    })

    it('accepts every other emulator id as it is', () => {
        expect(resolveScopedCloud({FLOCI_CLOUD: 'aws'})).toBe('aws')
        expect(resolveScopedCloud({FLOCI_CLOUD: 'gcp'})).toBe('gcp')
        expect(resolveScopedCloud({FLOCI_CLOUD: 'oci'})).toBe('oci')
    })
})

describe('resolveDefaultCloud', () => {
    it('opens on the scoped cloud, else AWS', () => {
        expect(resolveDefaultCloud({FLOCI_CLOUD: 'az'})).toBe('azure')
        expect(resolveDefaultCloud({})).toBe('aws')
        expect(resolveDefaultCloud({FLOCI_CLOUD: 'ibm'})).toBe('aws')
    })
})

describe('CloudProxyService.clouds', () => {
    it('lists only the scoped cloud, as the default, when an emulator started the console', () => {
        expect(service('azure').clouds()).toEqual([
            {id: 'azure', displayName: 'Azure', availability: 'available', default: true},
        ])
    })

    it('lists all four clouds with AWS as the default when standalone', () => {
        const clouds = service(null).clouds()

        expect(clouds.map((cloud) => cloud.id)).toEqual(['aws', 'azure', 'gcp', 'oci'])
        expect(clouds.filter((cloud) => cloud.default).map((cloud) => cloud.id)).toEqual(['aws'])
    })
})

describe('cloud routes', () => {
    it('treat a cloud outside the scope as unknown', async () => {
        const app = createCloudRoutes(service('azure'))

        expect((await app.request('/aws/services')).status).toBe(404)
        expect((await app.request('/gcp/services/storage/resources')).status).toBe(404)
        expect((await app.request('/azure/services')).status).toBe(200)
    })

    it('serve every cloud when standalone', async () => {
        const app = createCloudRoutes(service(null))

        expect((await app.request('/aws/services')).status).toBe(200)
        expect((await app.request('/oci/services')).status).toBe(200)
    })
})

describe('the AWS-only routes', () => {
    const cloudRoutes = createCloudRoutes(service('azure'))

    it('are not served by a console scoped to another cloud', async () => {
        const app = createApiApp(cloudRoutes, 'azure')
        for (const path of ['/api/secretsmanager/secrets', '/api/ec2/instances', '/api/eks/clusters', '/api/eks']) {
            const res = await app.fetch(new Request(`http://localhost${path}`))
            expect(res.status).toBe(404)
            expect(await res.json()).toMatchObject({code: 'resource_not_found'})
        }
    })

    it('stay with a console scoped to AWS or a standalone one', async () => {
        for (const scope of ['aws', null] as const) {
            const res = await createApiApp(cloudRoutes, scope).fetch(new Request('http://localhost/api/eks/nope/nope/nope'))
            expect(await res.text()).not.toContain('Unknown cloud')
        }
    })
})
