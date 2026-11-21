import {useState} from 'react'
import {Scale} from 'lucide-react'
import {useQueries} from '@tanstack/react-query'
import {listCollectionItems} from '@/api/cloudProxyClient'
import {EmptyState} from '@/components/EmptyState'
import {useAccountId} from '@/lib/accountStore'
import type {ChildItem, CloudResource} from '@/types/resource'

interface OciGovernancePanelProps {
    resource?: CloudResource
    runtimeReachable: boolean
}

const CRITERIA = 'inclusionCriteria'
const ATTACHMENTS = 'tenancyAttachments'

function text(value: unknown): string {
    return typeof value === 'string' ? value : ''
}

/**
 * Inclusion criteria and tenancy attachments of the selected governance rule, read
 * only, through the generic child collection store. Floci-OCI enforces only
 * ALLOWED_REGIONS, so a QUOTA or TAG rule says its attachments have no effect.
 */
export function OciGovernancePanel({resource, runtimeReachable}: OciGovernancePanelProps) {
    if (!resource || resource.cloud !== 'oci' || resource.service !== 'governance') return null
    // Keyed so another rule starts from its first page.
    return <RulePanel key={resource.id} rule={resource.id} name={resource.name} type={resource.type} runtimeReachable={runtimeReachable}/>
}

function RulePanel({rule, name, type, runtimeReachable}: {rule: string; name: string; type: string; runtimeReachable: boolean}) {
    return (
        <section className="table-panel">
            <div className="dynamic-stage-header">
                <div>
                    <p className="eyebrow">Governance rule</p>
                    <h2>{name}</h2>
                    <p className="muted compact-text">
                        {type === 'ALLOWED_REGIONS'
                            ? 'Inclusion criteria pick the child tenancies the rule applies to. Read only.'
                            : `Floci-OCI stores ${type} rules but does not enforce them, so attachments have no effect. Read only.`}
                    </p>
                </div>
            </div>
            <ChildTable rule={rule} collection={CRITERIA} title="Inclusion criteria" emptyTitle="No inclusion criteria"
                        emptyDescription="Without a criterion the rule applies to no child tenancy."
                        runtimeReachable={runtimeReachable}
                        header={['Applies to', 'State', 'Created']}
                        row={(item) => [
                            item.body.type === 'ALL' ? 'All child tenancies' : text(item.body.tenancyId) || text(item.body.type),
                            text(item.body.lifecycleState) || '-',
                            text(item.body.timeCreated) || '-',
                        ]}/>
            <ChildTable rule={rule} collection={ATTACHMENTS} title="Tenancy attachments" emptyTitle="No tenancy attachments"
                        emptyDescription="A child tenancy appears here once the rule applies to it."
                        runtimeReachable={runtimeReachable}
                        header={['Tenancy', 'State', 'Created']}
                        row={(item) => [text(item.body.tenancyId) || '-', text(item.body.lifecycleState) || '-', text(item.body.timeCreated) || '-']}/>
        </section>
    )
}

interface ChildTableProps {
    rule: string
    collection: string
    title: string
    emptyTitle: string
    emptyDescription: string
    runtimeReachable: boolean
    header: string[]
    row: (item: ChildItem) => string[]
}

function ChildTable({rule, collection, title, emptyTitle, emptyDescription, runtimeReachable, header, row}: ChildTableProps) {
    const accountId = useAccountId()
    const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])

    const pages = useQueries({
        queries: cursors.map((cursor) => ({
            queryKey: ['oci-governance', accountId, rule, collection, cursor],
            queryFn: ({signal}: {signal: AbortSignal}) => listCollectionItems('oci', 'governance', rule, collection, cursor, signal),
            enabled: runtimeReachable,
        })),
    })
    const first = pages[0]
    const last = pages[pages.length - 1]
    const items = pages.flatMap((page) => page.data?.items ?? [])
    const next = last?.data?.nextCursor ?? null
    const failed = pages.find((page) => page.error instanceof Error)

    return (
        <>
            <h3 className="compact-text">{title}</h3>
            {failed && failed.error instanceof Error && (
                <p className="error-text compact-text" role="alert">{failed.error.message}</p>
            )}
            {first?.isLoading && <div className="muted padded">Loading {title.toLowerCase()}</div>}

            {first?.isSuccess && items.length === 0 ? (
                <EmptyState icon={Scale} title={emptyTitle} description={emptyDescription} compact/>
            ) : items.length > 0 && (
                <>
                    <table className="table">
                        <thead>
                        <tr>{header.map((label) => <th key={label}>{label}</th>)}</tr>
                        </thead>
                        <tbody>
                        {items.map((item) => (
                            <tr key={item.id}>
                                {row(item).map((cell, index) => <td key={header[index]} className={index === 0 ? 'mono' : undefined}>{cell}</td>)}
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
        </>
    )
}
