import {describe, expect, test} from 'bun:test'
import {Hono} from 'hono'
import type {AwsClients} from '../aws'
import {defaultAccountId, defaultRegion} from '../aws'
import {scopedAwsRoutes} from './scoped'

/** A router that reports which account and region it was built for and the path it served. */
function scopes() {
    const built: string[] = []
    const clientsFor = (accountId: string, region: string) => ({accountId, region}) as unknown as AwsClients
    const app = new Hono().route('/api/ec2', scopedAwsRoutes('/api/ec2', (clients) => {
        const {accountId, region} = clients as unknown as {accountId: string, region: string}
        built.push(`${accountId}/${region}`)
        return new Hono().get('/vpcs/:id', (c) => c.json({accountId, region, id: c.req.param('id')}))
    }, clientsFor))
    return {app, built}
}

describe('scopedAwsRoutes', () => {
    test('serves the account and region in the headers, keeping the request path', async () => {
        const {app} = scopes()

        const res = await app.request('/api/ec2/vpcs/vpc-1', {
            headers: {'x-floci-account-id': '128260126056', 'x-floci-region': 'eu-central-1'},
        })

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({accountId: '128260126056', region: 'eu-central-1', id: 'vpc-1'})
    })

    test('falls back to the query parameters, then to the default account and region', async () => {
        const {app} = scopes()

        const fromQuery = await (await app.request('/api/ec2/vpcs/v?account=222222222222&region=eu-west-1')).json()
        const fromDefault = await (await app.request('/api/ec2/vpcs/v', {
            headers: {'x-floci-account-id': 'not-an-account', 'x-floci-region': 'not-a-region'},
        })).json()

        expect(fromQuery).toMatchObject({accountId: '222222222222', region: 'eu-west-1'})
        expect(fromDefault).toMatchObject({accountId: defaultAccountId(), region: defaultRegion()})
    })

    test('builds one router per account and region and reuses it', async () => {
        const {app, built} = scopes()
        const dev = {'x-floci-account-id': '128260126056', 'x-floci-region': 'eu-central-1'}

        await app.request('/api/ec2/vpcs/a', {headers: dev})
        await app.request('/api/ec2/vpcs/b', {headers: dev})
        await app.request('/api/ec2/vpcs/c', {headers: {...dev, 'x-floci-region': 'eu-west-1'}})
        await app.request('/api/ec2/vpcs/d', {headers: {'x-floci-account-id': '222222222222', 'x-floci-region': 'eu-central-1'}})

        expect(built).toEqual(['128260126056/eu-central-1', '128260126056/eu-west-1', '222222222222/eu-central-1'])
    })
})
