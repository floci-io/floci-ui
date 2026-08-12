import {Hono} from 'hono'
import {DescribeLogGroupsCommand, DescribeLogStreamsCommand, GetLogEventsCommand} from '@aws-sdk/client-cloudwatch-logs'
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

app.get('/streams', async (c) => {
    const accountId = c.req.header(ACCOUNT_HEADER) ?? c.req.query('account')
    const {cloudWatchLogs} = awsClientsForAccount(accountId)

    const group = c.req.query('group')
    if (!group) return c.json({error: 'group is required'}, 400)

    const res = await cloudWatchLogs.send(new DescribeLogStreamsCommand({
        logGroupName: group,
    }))

    const streams = (res.logStreams ?? []).flatMap((s) => {
        if (!s.logStreamName) return []
        return [{
            name: s.logStreamName,
            arn: s.arn,
            creationTime: s.creationTime ? new Date(s.creationTime).toISOString() : undefined,
            firstEventTimestamp: s.firstEventTimestamp ? new Date(s.firstEventTimestamp).toISOString() : undefined,
            lastEventTimestamp: s.lastEventTimestamp ? new Date(s.lastEventTimestamp).toISOString() : undefined,
            storedBytes: s.storedBytes,
        }]
    })

    // An envelope, not a bare array like /groups: /events needs to carry a
    // pagination token alongside its list, and this stays shaped the same way
    // for consistency even though floci does not paginate DescribeLogStreams
    // any more than it does DescribeLogGroups.
    return c.json({streams})
})

app.get('/events', async (c) => {
    const accountId = c.req.header(ACCOUNT_HEADER) ?? c.req.query('account')
    const {cloudWatchLogs} = awsClientsForAccount(accountId)

    const group = c.req.query('group')
    if (!group) return c.json({error: 'group is required'}, 400)
    const stream = c.req.query('stream')
    if (!stream) return c.json({error: 'stream is required'}, 400)

    const nextToken = c.req.query('nextToken')

    const res = await cloudWatchLogs.send(new GetLogEventsCommand({
        logGroupName: group,
        logStreamName: stream,
        nextToken: nextToken || undefined,
        startFromHead: true,
    }))

    const events = (res.events ?? []).flatMap((e) => {
        if (e.message === undefined) return []
        return [{
            timestamp: e.timestamp ? new Date(e.timestamp).toISOString() : undefined,
            message: e.message,
        }]
    })

    // GetLogEvents always echoes a forward token, even at the end of the
    // stream -- when there is nothing new it just hands back the token you
    // sent instead of signalling "done". Collapse that echo (and the
    // no-events case) to undefined so a "load more" UI stops instead of
    // refetching the same page forever.
    const nextForwardToken = res.nextForwardToken
    const hasMore = events.length > 0 && nextForwardToken !== undefined && nextForwardToken !== nextToken

    return c.json({events, nextToken: hasMore ? nextForwardToken : undefined})
})

export default app
