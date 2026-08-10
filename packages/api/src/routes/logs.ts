import {Hono} from 'hono'
import {DescribeLogGroupsCommand} from '@aws-sdk/client-cloudwatch-logs'
import {awsClientsForAccount} from '../aws'
import {ACCOUNT_HEADER} from './clouds'

const app = new Hono()

app.get('/groups', async (c) => {
    // Resolve the client set per request (never the ../aws singleton) so this
    // route follows the console's active account instead of always serving
    // the default account.
    const accountId = c.req.header(ACCOUNT_HEADER) ?? c.req.query('account')
    const {cloudWatchLogs} = awsClientsForAccount(accountId)

    const prefix = c.req.query('prefix')

    // floci implements no pagination on DescribeLogGroups: it reads only
    // logGroupNamePrefix and ignores limit/nextToken, always returning every
    // group in a single response. Real AWS paginates; a do/while NextToken
    // loop here would spin forever or mislead, so it is intentionally absent.
    const res = await cloudWatchLogs.send(new DescribeLogGroupsCommand({
        logGroupNamePrefix: prefix || undefined,
    }))

    const groups = (res.logGroups ?? []).flatMap((g) => {
        // logGroupName missing means malformed data from the producer, not a
        // legitimate "no name" state. Skip the entry rather than papering
        // over it with a `?? ''` fallback.
        if (!g.logGroupName) return []
        return [{
            name: g.logGroupName,
            arn: g.arn,
            creationTime: g.creationTime ? new Date(g.creationTime).toISOString() : undefined,
            retentionInDays: g.retentionInDays,
            kmsKeyId: g.kmsKeyId,
            // storedBytes and metricFilterCount are deliberately omitted:
            // floci hardcodes both to 0 at the group level, and surfacing a
            // hardcoded 0 would render in the UI as "every log group is
            // empty", which is false. (Stream-level storedBytes is real and
            // is used in a later phase.)
        }]
    })

    return c.json(groups)
})

export default app
