import {describe, expect, test} from 'bun:test'
import {Hono} from 'hono'
import type {AwsClients} from '../aws'
import {defaultAccountId} from '../aws'
import {scopedAwsRoutes} from './scoped'

/** A router that reports which account it was built for and the path it served. */
function scopes() {
    const built: string[] = []
    const clientsFor = (accountId: string) => ({accountId}) as unknown as AwsClients
    const app = new Hono().route('/api/ec2', scopedAwsRoutes('/api/ec2', (clients) => {
        const {accountId} = clients as unknown as {accountId: string}
        built.push(accountId)
        return new Hono().get('/vpcs/:id', (c) => c.json({accountId, id: c.req.param('id')}))
    }, clientsFor))
    return {app, built}
}

describe('scopedAwsRoutes', () => {
    test('serves the account in the header, keeping the request path', async () => {
        const {app} = scopes()

        const res = await app.request('/api/ec2/vpcs/vpc-1', {headers: {'x-floci-account-id': '128260126056'}})

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({accountId: '128260126056', id: 'vpc-1'})
    })

    test('falls back to the query parameter, then to the default account', async () => {
        const {app} = scopes()

        const fromQuery = await (await app.request('/api/ec2/vpcs/v?account=222222222222')).json()
        const fromDefault = await (await app.request('/api/ec2/vpcs/v', {headers: {'x-floci-account-id': 'not-an-account'}})).json()

        expect(fromQuery).toMatchObject({accountId: '222222222222'})
        expect(fromDefault).toMatchObject({accountId: defaultAccountId()})
    })

    test('builds one router per account and reuses it', async () => {
        const {app, built} = scopes()
        const dev = {'x-floci-account-id': '128260126056'}

        await app.request('/api/ec2/vpcs/a', {headers: dev})
        await app.request('/api/ec2/vpcs/b', {headers: dev})
        await app.request('/api/ec2/vpcs/c', {headers: {'x-floci-account-id': '222222222222'}})

        expect(built).toEqual(['128260126056', '222222222222'])
    })
})
