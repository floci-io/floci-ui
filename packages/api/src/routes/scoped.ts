import {Hono} from 'hono'
import {type AwsClients, awsClientsForAccount, resolveAccountId, resolveRegion} from '../aws'
import {ACCOUNT_HEADER, REGION_HEADER} from './clouds'

/**
 * Serve a router built from AWS SDK clients for the account and region each request names,
 * the same `x-floci-account-id` and `x-floci-region` headers (or `account` and `region`
 * query parameters) the Cloud Explorer reads. One router per account and region is built on
 * first use and reused, as the clients themselves are.
 *
 * The routes predating /api/clouds (EC2, EKS, Secrets Manager) were bound to the default
 * account's clients at import time, so whatever account the console had selected, their
 * reads and writes went to the default account.
 */
export function scopedAwsRoutes(
    basePath: string,
    build: (clients: AwsClients) => Hono,
    clientsFor: (accountId: string, region: string) => AwsClients = awsClientsForAccount,
): Hono {
    const routers = new Map<string, Hono>()
    const app = new Hono()

    app.all('*', (c) => {
        const accountId = resolveAccountId(c.req.header(ACCOUNT_HEADER) ?? c.req.query('account'))
        const region = resolveRegion(c.req.header(REGION_HEADER) ?? c.req.query('region'))
        const key = `${accountId}/${region}`
        let router = routers.get(key)
        if (!router) {
            // Mounted under the same base path, so it sees the request path unchanged.
            router = new Hono().route(basePath, build(clientsFor(accountId, region)))
            routers.set(key, router)
        }
        return router.fetch(c.req.raw, c.env)
    })

    return app
}
