import {Hono} from 'hono'
import {type AwsClients, awsClientsForAccount, resolveAccountId} from '../aws'
import {ACCOUNT_HEADER} from './clouds'

/**
 * Serve a router built from AWS SDK clients for the account each request names, the same
 * `x-floci-account-id` header (or `account` query parameter) the Cloud Explorer reads. One
 * router per account is built on first use and reused, as the clients themselves are.
 *
 * The routes predating /api/clouds (EC2, EKS, Secrets Manager) were bound to the default
 * account's clients at import time, so whatever account the console had selected, their
 * reads and writes went to the default account.
 */
export function scopedAwsRoutes(
    basePath: string,
    build: (clients: AwsClients) => Hono,
    clientsFor: (accountId: string) => AwsClients = awsClientsForAccount,
): Hono {
    const routers = new Map<string, Hono>()
    const app = new Hono()

    app.all('*', (c) => {
        const accountId = resolveAccountId(c.req.header(ACCOUNT_HEADER) ?? c.req.query('account'))
        let router = routers.get(accountId)
        if (!router) {
            // Mounted under the same base path, so it sees the request path unchanged.
            router = new Hono().route(basePath, build(clientsFor(accountId)))
            routers.set(accountId, router)
        }
        return router.fetch(c.req.raw, c.env)
    })

    return app
}
