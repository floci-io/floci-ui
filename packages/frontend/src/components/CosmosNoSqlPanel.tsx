import {FormEvent, useEffect, useMemo, useState} from 'react'
import {Code2, Database, Play, Plus, RefreshCw, Table2, Trash2, type LucideIcon} from 'lucide-react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {JsonRecordModal} from '@/components/JsonRecordModal'
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

interface CosmosNoSqlPanelProps {
    cloud: CloudProvider
    resource?: CloudResource
    runtimeReachable: boolean
}

export function CosmosNoSqlPanel({cloud, resource, runtimeReachable}: CosmosNoSqlPanelProps) {
    const qc = useQueryClient()
    const databaseId = resource?.id
    const [selectedContainerId, setSelectedContainerId] = useState<string | undefined>()
    const [containerName, setContainerName] = useState('')
    const [partitionKeyPath, setPartitionKeyPath] = useState('/id')
    const [documentText, setDocumentText] = useState('{\n  "id": ""\n}')
    const [documentError, setDocumentError] = useState<string | null>(null)
    const [selectedItem, setSelectedItem] = useState<CosmosItem | undefined>()
    const [addRecordOpen, setAddRecordOpen] = useState(false)
    const [sql, setSql] = useState('SELECT * FROM c')
    const [confirmContainer, setConfirmContainer] = useState<string | null>(null)
    const [confirmItem, setConfirmItem] = useState<string | null>(null)

    const containersKey = useMemo(() => ['cosmos-containers', cloud, databaseId], [cloud, databaseId])
    const itemsKey = useMemo(() => ['cosmos-items', cloud, databaseId, selectedContainerId], [cloud, databaseId, selectedContainerId])

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
        enabled: Boolean(databaseId && selectedContainerId) && runtimeReachable,
    })

    const createContainerMut = useMutation({
        mutationFn: () => createCosmosContainer(cloud, databaseId ?? '', {containerName, partitionKeyPath}),
        onSuccess: (container) => {
            setSelectedContainerId(container.id)
            setContainerName('')
            setPartitionKeyPath('/id')
            void qc.invalidateQueries({queryKey: containersKey})
        },
    })

    const deleteContainerMut = useMutation({
        mutationFn: (containerId: string) => deleteCosmosContainer(cloud, databaseId ?? '', containerId),
        onSuccess: (_, containerId) => {
            if (selectedContainerId === containerId) setSelectedContainerId(undefined)
            setConfirmContainer(null)
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
        setSelectedContainerId(undefined)
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
                <div className="empty compact">
                    <h3>Select a Cosmos database</h3>
                    <p>Containers, documents, and SQL queries are loaded after a database is selected.</p>
                </div>
            </section>
        )
    }

    function submitContainer(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!containerName.trim()) return
        createContainerMut.mutate()
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
                    <input className="input" value={containerName} onChange={(event) => setContainerName(event.target.value)} placeholder="Container name" disabled={!runtimeReachable}/>
                    <input className="input" value={partitionKeyPath} onChange={(event) => setPartitionKeyPath(event.target.value)} placeholder="/id" disabled={!runtimeReachable}/>
                    <button className="button" type="submit" disabled={!runtimeReachable || createContainerMut.isPending || !containerName.trim()}>
                        <Plus size={14}/>
                        {createContainerMut.isPending ? 'Creating' : 'Create'}
                    </button>
                </form>
                {createContainerMut.error instanceof Error && <div className="form-error">{createContainerMut.error.message}</div>}
                {containersQuery.error instanceof Error && <div className="form-error">{containersQuery.error.message}</div>}
                <div className="cosmos-list">
                    {containersQuery.isLoading && <div className="muted padded">Loading containers</div>}
                    {!containersQuery.isLoading && containers.length === 0 && <div className="muted padded">No containers</div>}
                    {containers.map((container) => (
                        <button
                            key={container.id}
                            className={`cosmos-list-row ${selectedContainerId === container.id ? 'selected' : ''}`}
                            type="button"
                            onClick={() => setSelectedContainerId(container.id)}
                        >
                            <span>
                                <strong>{container.name}</strong>
                                <small>Partition key {container.partitionKeyPath}</small>
                            </span>
                            {confirmContainer === container.id ? (
                                <em
                                    role="button"
                                    tabIndex={0}
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        deleteContainerMut.mutate(container.id)
                                    }}
                                >
                                    Confirm
                                </em>
                            ) : (
                                <Trash2
                                    size={13}
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        setConfirmContainer(container.id)
                                    }}
                                />
                            )}
                        </button>
                    ))}
                </div>
            </div>

            <div className="cosmos-column cosmos-column--wide">
                <PanelHeader icon={Table2} eyebrow="Documents" title={selectedContainer?.name ?? 'Select container'} detail={`${itemsQuery.data?.length ?? 0} items`}/>
                <div className="cosmos-toolbar">
                    <button
                        className="button primary"
                        type="button"
                        disabled={!selectedContainerId || !runtimeReachable}
                        onClick={() => {
                            upsertItemMut.reset()
                            setAddRecordOpen(true)
                        }}
                    >
                        <Plus size={14}/>
                        Add record
                    </button>
                    <button className="button" type="button" disabled={!selectedContainerId || itemsQuery.isFetching} onClick={() => itemsQuery.refetch()}>
                        <RefreshCw size={14}/>
                        Refresh
                    </button>
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
                                            <button className="button danger compact" type="button" onClick={() => deleteItemMut.mutate(item)}>Confirm</button>
                                        ) : (
                                            <button className="icon-btn danger" type="button" title={`Delete ${item.id}`} onClick={() => setConfirmItem(item.id)}>
                                                <Trash2 size={13}/>
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!selectedContainerId && <div className="empty compact"><h3>Select a container</h3><p>Documents are scoped to a Cosmos container.</p></div>}
                    {selectedContainerId && !itemsQuery.isLoading && (itemsQuery.data ?? []).length === 0 && <div className="empty compact"><h3>No documents</h3><p>Create a JSON document or run a query after data exists.</p></div>}
                </div>
            </div>

            <div className="cosmos-column">
                <PanelHeader icon={Code2} eyebrow="Document editor" title={selectedItem ? `Update ${selectedItem.id}` : 'Select document'} detail={selectedItem ? 'Edits replace the selected document' : 'Choose a document to inspect or update'}/>
                {selectedItem ? (
                    <form className="cosmos-editor" onSubmit={submitDocument}>
                        <textarea className="textarea code-textarea" value={documentText} onChange={(event) => setDocumentText(event.target.value)} spellCheck={false}/>
                        <button className="button primary" type="submit" disabled={!selectedContainerId || upsertItemMut.isPending}>
                            {upsertItemMut.isPending ? 'Saving' : 'Update document'}
                        </button>
                        {saveError && <div className="form-error">{saveError}</div>}
                    </form>
                ) : (
                    <div className="empty compact"><h3>Select a document</h3><p>Its JSON contents appear here.</p></div>
                )}

                <PanelHeader icon={Play} eyebrow="SQL query" title="Cosmos SQL" detail="Runs against selected container"/>
                <div className="cosmos-query">
                    <textarea className="textarea code-textarea small" value={sql} onChange={(event) => setSql(event.target.value)} spellCheck={false}/>
                    <button
                        className="button"
                        type="button"
                        disabled={!selectedContainerId || queryMut.isPending}
                        onClick={() => selectedContainerId && queryMut.mutate({containerId: selectedContainerId, query: sql})}
                    >
                        <Play size={14}/>
                        {queryMut.isPending ? 'Running' : 'Run query'}
                    </button>
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
