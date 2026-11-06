import {FormEvent, useEffect, useMemo, useRef, useState} from 'react'
import {Icon, Code2, DatabaseSquared as Database, Play, PlusSquared as Plus, RefreshCwSquared as RefreshCw, Table2, Trash2, type SodiumIcon as LucideIcon} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import {Textarea} from '@/components/sodium/ui/textarea'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {JsonRecordModal} from '@/components/JsonRecordModal'
import {useAccountId} from '@/lib/accountStore'
import {
    createCosmosContainer,
    deleteCosmosContainer,
    deleteCosmosItem,
    listCosmosContainers,
    listCosmosItems,
    queryCosmosItems,
    upsertCosmosItem,
} from '@/api/cloudProxyClient'
import type {CloudProvider} from '@/types/cloud'
import type {CloudResource, CosmosItem} from '@/types/resource'
import {EmptyState} from '@/components/EmptyState'
import {RowsSkeleton} from '@/components/PageSkeleton'
import {Hint} from '@/components/Hint'

interface CosmosNoSqlPanelProps {
    cloud: CloudProvider
    resource?: CloudResource
    runtimeReachable: boolean
    selectedContainerId?: string
    onSelectContainer: (id: string | undefined) => void
}

export function CosmosNoSqlPanel({cloud, resource, runtimeReachable, selectedContainerId, onSelectContainer}: CosmosNoSqlPanelProps) {
    const qc = useQueryClient()
    const accountId = useAccountId()
    const selectionChanged = useRef(false)
    const databaseId = resource?.id
    const [containerName, setContainerName] = useState('')
    const [partitionKeyPath, setPartitionKeyPath] = useState('/id')
    const [documentText, setDocumentText] = useState('{\n  "id": ""\n}')
    const [documentError, setDocumentError] = useState<string | null>(null)
    const [selectedItem, setSelectedItem] = useState<CosmosItem | undefined>()
    const [addRecordOpen, setAddRecordOpen] = useState(false)
    const [sql, setSql] = useState('SELECT * FROM c')
    const [confirmContainer, setConfirmContainer] = useState<string | null>(null)
    const [confirmItem, setConfirmItem] = useState<string | null>(null)

    const containersKey = useMemo(() => ['cosmos-containers', accountId, cloud, databaseId], [accountId, cloud, databaseId])
    const itemsKey = useMemo(() => ['cosmos-items', accountId, cloud, databaseId, selectedContainerId], [accountId, cloud, databaseId, selectedContainerId])

    const containersQuery = useQuery({
        queryKey: containersKey,
        queryFn: ({signal}) => listCosmosContainers(cloud, databaseId ?? '', signal),
        enabled: Boolean(databaseId) && runtimeReachable,
    })

    const containers = containersQuery.data ?? []
    const selectedContainer = containers.find((container) => container.id === selectedContainerId)

    const itemsQuery = useQuery({
        queryKey: itemsKey,
        queryFn: ({signal}) => listCosmosItems(cloud, databaseId ?? '', selectedContainerId ?? '', signal),
        enabled: Boolean(databaseId && selectedContainer) && runtimeReachable,
    })

    const createContainerMut = useMutation({
        mutationFn: () => createCosmosContainer(cloud, databaseId ?? '', {containerName, partitionKeyPath}),
        onSuccess: () => {
            void qc.invalidateQueries({queryKey: containersKey})
        },
    })

    const deleteContainerMut = useMutation({
        mutationFn: (containerId: string) => deleteCosmosContainer(cloud, databaseId ?? '', containerId),
        onSuccess: () => {
            void qc.invalidateQueries({queryKey: containersKey})
        },
    })

    const upsertItemMut = useMutation({
        mutationFn: (document: Record<string, unknown>) => upsertCosmosItem(cloud, databaseId ?? '', selectedContainerId ?? '', document),
        onSuccess: (item) => {
            setAddRecordOpen(false)
            setSelectedItem(item)
            setDocumentError(null)
            setDocumentText(JSON.stringify(item.document, null, 2))
            void qc.invalidateQueries({queryKey: itemsKey})
        },
    })

    const deleteItemMut = useMutation({
        mutationFn: (item: CosmosItem) => deleteCosmosItem(cloud, databaseId ?? '', selectedContainerId ?? '', item.id, item.partitionKey),
        onSuccess: (_, item) => {
            if (selectedItem?.id === item.id) resetDocumentEditor()
            setConfirmItem(null)
            void qc.invalidateQueries({queryKey: itemsKey})
        },
    })

    const queryMut = useMutation({
        mutationFn: (input: {containerId: string; query: string}) => queryCosmosItems(cloud, databaseId ?? '', input.containerId, input.query),
    })
    const saveError = documentError ?? (upsertItemMut.error instanceof Error ? upsertItemMut.error.message : null)
    const activeQueryResult = queryMut.variables?.containerId === selectedContainerId ? queryMut.data : undefined

    useEffect(() => {
        setSelectedItem(undefined)
        setAddRecordOpen(false)
        setDocumentText('{\n  "id": ""\n}')
        setDocumentError(null)
        setSql('SELECT * FROM c')
    }, [cloud, databaseId])

    useEffect(() => {
        setSelectedItem(undefined)
        setAddRecordOpen(false)
        setDocumentText('{\n  "id": ""\n}')
        setDocumentError(null)
    }, [selectedContainerId])

    if (cloud !== 'azure') return null

    if (!databaseId) {
        return (
            <section className="cosmos-panel">
                <EmptyState compact title="Select a Cosmos database" description="Containers, documents, and SQL queries are loaded after a database is selected."/>
            </section>
        )
    }

    function submitContainer(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!containerName.trim()) return
        createContainerMut.mutate(undefined, {
            onSuccess: (container) => {
                if (selectionChanged.current) return
                onSelectContainer(container.id)
                setContainerName('')
                setPartitionKeyPath('/id')
            },
        })
    }

    function submitDocument(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        try {
            const parsed = JSON.parse(documentText) as unknown
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                setDocumentError('Document must be a JSON object.')
                return
            }
            if (!('id' in parsed) || !String((parsed as Record<string, unknown>).id ?? '').trim()) {
                setDocumentError('Document id is required.')
                return
            }
            setDocumentError(null)
            upsertItemMut.mutate(parsed as Record<string, unknown>)
        } catch (error) {
            setDocumentError(error instanceof Error ? error.message : 'Invalid JSON document.')
        }
    }

    return (
        <section className="cosmos-panel">
            <div className="cosmos-column">
                <PanelHeader icon={Database} eyebrow="Containers" title={databaseId} detail={`${containers.length} containers`}/>
                <form className="cosmos-inline-form" onSubmit={submitContainer}>
                    <Input aria-label="Container name" value={containerName} onChange={(event) => setContainerName(event.target.value)} placeholder="Container name" disabled={!runtimeReachable}/>
                    <Input aria-label="Partition key path" value={partitionKeyPath} onChange={(event) => setPartitionKeyPath(event.target.value)} placeholder="/id" disabled={!runtimeReachable}/>
                    <Button variant="secondary" type="submit" disabled={!runtimeReachable || createContainerMut.isPending || !containerName.trim()}>
                        <Icon icon={Plus} size={14}/>
                        {createContainerMut.isPending ? 'Creating' : 'Create'}
                    </Button>
                </form>
                {createContainerMut.error instanceof Error && <div className="form-error">{createContainerMut.error.message}</div>}
                {containersQuery.error instanceof Error && <div className="form-error">{containersQuery.error.message}</div>}
                <div className="cosmos-list">
                    {containersQuery.isLoading && <RowsSkeleton rows={3} label="Loading containers"/>}
                    {containersQuery.isSuccess && containers.length === 0 && <div className="muted padded">No containers</div>}
                    {containersQuery.isSuccess && selectedContainerId && !selectedContainer && <div className="form-error">Container not found: {selectedContainerId}</div>}
                    {containers.map((container) => (
                        <div
                            key={container.id}
                            className={`cosmos-list-row ${selectedContainerId === container.id ? 'selected' : ''}`}
                        >
                            <Button
                                variant="ghost"
                                type="button"
                                className="grow justify-start"
                                onClick={() => {
                                    if (container.id === selectedContainerId) return
                                    selectionChanged.current = true
                                    onSelectContainer(container.id)
                                }}
                            >
                                <span>
                                    <strong>{container.name}</strong>
                                    <small>Partition key {container.partitionKeyPath}</small>
                                </span>
                            </Button>
                            {confirmContainer === container.id ? (
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    type="button"
                                    onClick={() => {
                                        deleteContainerMut.mutate(container.id, {
                                            onSuccess: () => {
                                                if (selectionChanged.current) return
                                                if (selectedContainerId === container.id) onSelectContainer(undefined)
                                                setConfirmContainer(null)
                                            },
                                        })
                                    }}
                                >
                                    Confirm
                                </Button>
                            ) : (
                                <Hint label={`Delete ${container.name}`}><Button
                                    variant="ghost"
                                    size="icon-sm"
                                    type="button"
                                    aria-label={`Delete ${container.name}`}
                                    onClick={() => setConfirmContainer(container.id)}
                                >
                                    <Icon icon={Trash2} size={14}/>
                                </Button></Hint>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <div className="cosmos-column cosmos-column--wide">
                <PanelHeader icon={Table2} eyebrow="Documents" title={selectedContainer?.name ?? selectedContainerId ?? 'Select container'} detail={`${itemsQuery.data?.length ?? 0} items`}/>
                <div className="cosmos-toolbar">
                    <Button
                        type="button"
                        disabled={!selectedContainer || !runtimeReachable}
                        onClick={() => {
                            upsertItemMut.reset()
                            setAddRecordOpen(true)
                        }}
                    >
                        <Icon icon={Plus} size={14}/>
                        Add record
                    </Button>
                    <Button variant="secondary" type="button" disabled={!selectedContainer || !runtimeReachable || itemsQuery.isFetching} onClick={() => itemsQuery.refetch()}>
                        <Icon icon={RefreshCw} size={14}/>
                        Refresh
                    </Button>
                </div>
                {itemsQuery.error instanceof Error && <div className="form-error">{itemsQuery.error.message}</div>}
                {deleteItemMut.error instanceof Error && <div className="form-error">{deleteItemMut.error.message}</div>}
                <div className="cosmos-items-table">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Id</th>
                                <th>Updated</th>
                                <th>ETag</th>
                                <th aria-label="Actions"/>
                            </tr>
                        </thead>
                        <tbody>
                            {(itemsQuery.data ?? []).map((item) => (
                                <tr key={item.id} className={selectedItem?.id === item.id ? 'selected' : ''}>
                                    <td onClick={() => selectItem(item)}>{item.id}</td>
                                    <td onClick={() => selectItem(item)}>{formatValue(item.timestamp)}</td>
                                    <td onClick={() => selectItem(item)}><code>{formatShort(item.etag)}</code></td>
                                    <td className="table-actions">
                                        {confirmItem === item.id ? (
                                            <Button variant="destructive" size="sm" type="button" onClick={() => deleteItemMut.mutate(item)}>Confirm</Button>
                                        ) : (
                                            <Hint label={`Delete ${item.id}`}><Button variant="ghost" size="icon-sm" type="button" aria-label={`Delete ${item.id}`} onClick={() => setConfirmItem(item.id)}>
                                                <Icon icon={Trash2} size={14}/>
                                            </Button></Hint>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!selectedContainerId && <EmptyState compact title="Select a container" description="Documents are scoped to a Cosmos container."/>}
                    {itemsQuery.isLoading && <RowsSkeleton rows={4} label="Loading documents"/>}
                    {selectedContainerId && itemsQuery.isSuccess && itemsQuery.data.length === 0 && <EmptyState compact title="No documents" description="Create a JSON document or run a query after data exists."/>}
                </div>
            </div>

            <div className="cosmos-column">
                <PanelHeader icon={Code2} eyebrow="Document editor" title={selectedItem ? `Update ${selectedItem.id}` : 'Select document'} detail={selectedItem ? 'Edits replace the selected document' : 'Choose a document to inspect or update'}/>
                {selectedItem ? (
                    <form className="cosmos-editor" onSubmit={submitDocument}>
                        <Textarea aria-label="Document JSON" className="code-textarea" value={documentText} onChange={(event) => setDocumentText(event.target.value)} spellCheck={false}/>
                        <Button type="submit" disabled={!selectedContainer || !runtimeReachable || upsertItemMut.isPending}>
                            {upsertItemMut.isPending ? 'Saving' : 'Update document'}
                        </Button>
                        {saveError && <div className="form-error">{saveError}</div>}
                    </form>
                ) : (
                    <EmptyState compact title="Select a document" description="Its JSON contents appear here."/>
                )}

                <PanelHeader icon={Play} eyebrow="SQL query" title="Cosmos SQL" detail="Runs against selected container"/>
                <div className="cosmos-query">
                    <Textarea aria-label="SQL query" className="code-textarea small" value={sql} onChange={(event) => setSql(event.target.value)} spellCheck={false}/>
                    <Button variant="secondary"
                        type="button"
                        disabled={!selectedContainer || !runtimeReachable || queryMut.isPending}
                        onClick={() => selectedContainerId && queryMut.mutate({containerId: selectedContainerId, query: sql})}
                    >
                        <Icon icon={Play} size={14}/>
                        {queryMut.isPending ? 'Running' : 'Run query'}
                    </Button>
                    {queryMut.error instanceof Error && <div className="form-error">{queryMut.error.message}</div>}
                    {activeQueryResult && (
                        <>
                            <div className="muted">{activeQueryResult.count} query results</div>
                            <pre className="cosmos-query-result">{JSON.stringify(activeQueryResult.items, null, 2)}</pre>
                        </>
                    )}
                </div>
            </div>

            <JsonRecordModal
                open={addRecordOpen}
                title={`Add record to ${selectedContainer?.name ?? 'container'}`}
                description={cosmosModalDescription(selectedContainer?.partitionKeyPath)}
                initialValue={JSON.stringify(cosmosRecordTemplate(selectedContainer?.partitionKeyPath), null, 2)}
                isPending={upsertItemMut.isPending}
                submitError={upsertItemMut.error instanceof Error ? upsertItemMut.error.message : undefined}
                onClose={() => setAddRecordOpen(false)}
                onSubmit={(document) => upsertItemMut.mutate(document)}
            />
        </section>
    )

    function selectItem(item: CosmosItem) {
        setSelectedItem(item)
        setDocumentText(JSON.stringify(item.document, null, 2))
        setDocumentError(null)
    }

    function resetDocumentEditor() {
        setSelectedItem(undefined)
        setDocumentText('{\n  "id": ""\n}')
        setDocumentError(null)
        setConfirmItem(null)
    }
}

function cosmosRecordTemplate(partitionKeyPath = '/id'): Record<string, unknown> {
    const document: Record<string, unknown> = {id: ''}
    const segments = partitionKeyPath.replace(/^\//, '').split('/').filter(Boolean)
    if (segments.length === 0 || segments.length === 1 && segments[0] === 'id') return document

    let target = document
    for (const segment of segments.slice(0, -1)) {
        const child: Record<string, unknown> = {}
        target[segment] = child
        target = child
    }
    target[segments[segments.length - 1] ?? 'id'] = ''
    return document
}

function cosmosModalDescription(partitionKeyPath = '/id'): string {
    const required = partitionKeyPath === '/id' ? 'Include id.' : `Include id and partition key ${partitionKeyPath}.`
    return `${required} A matching id and partition key replaces the existing record.`
}

function PanelHeader({icon, eyebrow, title, detail}: {icon: LucideIcon; eyebrow: string; title: string; detail: string}) {
    const Icon = icon
    return (
        <div className="cosmos-panel-header">
            <Icon size={15}/>
            <span>
                <small>{eyebrow}</small>
                <strong>{title}</strong>
                <em>{detail}</em>
            </span>
        </div>
    )
}

function formatValue(value: string | null): string {
    return value || '-'
}

function formatShort(value: string | null): string {
    if (!value) return '-'
    return value.length > 16 ? `${value.slice(0, 16)}...` : value
}
