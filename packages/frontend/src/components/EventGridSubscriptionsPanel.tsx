import {useState} from 'react'
import {Radio} from 'lucide-react'
import {useQueries} from '@tanstack/react-query'
import {listCollectionItems} from '@/api/cloudProxyClient'
import {EmptyState} from '@/components/EmptyState'
import {useAccountId} from '@/lib/accountStore'
import type {ChildItem, CloudResource} from '@/types/resource'

interface EventGridSubscriptionsPanelProps {
    resource?: CloudResource
    runtimeReachable: boolean
}

const COLLECTION = 'eventSubscriptions'

function text(value: unknown): string {
    return typeof value === 'string' ? value : ''
}

/** The subject and event type filters of a subscription, or `All events` when it has none. */
function filterSummary(item: ChildItem): string {
    const types = Array.isArray(item.body.includedEventTypes) ? item.body.includedEventTypes.map(String) : []
    const parts = [
        text(item.body.subjectBeginsWith) && `subject starts with ${text(item.body.subjectBeginsWith)}`,
        text(item.body.subjectEndsWith) && `subject ends with ${text(item.body.subjectEndsWith)}`,
        types.length > 0 && `types ${types.join(', ')}`,
    ].filter(Boolean)
    return parts.length > 0 ? parts.join('; ') : 'All events'
}

/**
 * Event subscriptions of the selected Event Grid topic, read only, through the
 * generic child collection store. The webhook URL arrives without its query
 * string, where keys live, so what is shown is what the API chose to expose.
 */
export function EventGridSubscriptionsPanel({resource, runtimeReachable}: EventGridSubscriptionsPanelProps) {
    if (!resource || resource.cloud !== 'azure' || resource.service !== 'events') return null
    // Keyed so another topic starts from its first page.
    return <SubscriptionsPanel key={resource.id} topic={resource.id} name={resource.name} runtimeReachable={runtimeReachable}/>
}

function SubscriptionsPanel({topic, name, runtimeReachable}: {topic: string; name: string; runtimeReachable: boolean}) {
    const accountId = useAccountId()
    const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])

    const pages = useQueries({
        queries: cursors.map((cursor) => ({
            queryKey: ['azure-event-subscriptions', accountId, topic, cursor],
            queryFn: ({signal}: {signal: AbortSignal}) => listCollectionItems('azure', 'events', topic, COLLECTION, cursor, signal),
            enabled: runtimeReachable,
        })),
    })
    const first = pages[0]
    const last = pages[pages.length - 1]
    const items = pages.flatMap((page) => page.data?.items ?? [])
    const next = last?.data?.nextCursor ?? null
    const failed = pages.find((page) => page.error instanceof Error)

    return (
        <section className="table-panel">
            <div className="dynamic-stage-header">
                <div>
                    <p className="eyebrow">Event subscriptions</p>
                    <h2>{name}</h2>
                    <p className="muted compact-text">Subscriptions are read only here. Topic access keys are never shown.</p>
                </div>
            </div>

            {failed && failed.error instanceof Error && (
                <p className="error-text compact-text" role="alert">{failed.error.message}</p>
            )}
            {first?.isLoading && <div className="muted padded">Loading event subscriptions</div>}

            {first?.isSuccess && items.length === 0 ? (
                <EmptyState icon={Radio} title="No event subscriptions"
                            description="Subscriptions created on this topic will appear here." compact/>
            ) : items.length > 0 && (
                <>
                    <table className="table">
                        <thead>
                        <tr><th>Name</th><th>Destination</th><th>Filter</th><th>State</th><th>Retries</th></tr>
                        </thead>
                        <tbody>
                        {items.map((item) => (
                            <tr key={item.id}>
                                <td>{text(item.body.name) || item.id}</td>
                                <td className="mono">
                                    {text(item.body.endpointType) || '-'}
                                    {text(item.body.endpointUrl) && <><br/>{text(item.body.endpointUrl)}</>}
                                </td>
                                <td>{filterSummary(item)}</td>
                                <td>{text(item.body.provisioningState) || '-'}</td>
                                <td>{typeof item.body.maxDeliveryAttempts === 'number' ? item.body.maxDeliveryAttempts : '-'}</td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                    {next && (
                        <div style={{display: 'flex', justifyContent: 'center', padding: '12px 0'}}>
                            <button className="button" type="button" disabled={Boolean(last?.isLoading)}
                                    onClick={() => setCursors((prev) => [...prev, next])}>
                                {last?.isLoading ? 'Loading…' : 'Load more'}
                            </button>
                        </div>
                    )}
                </>
            )}
        </section>
    )
}
