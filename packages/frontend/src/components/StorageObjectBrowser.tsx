import {useEffect, useRef, useState} from 'react'
import {Icon, ChevronLeft, ChevronRight, Copy, Download, EyeSquared as Eye, File, Folder, Loader2, RefreshCwSquared as RefreshCw, Search, Trash2, Upload, XSquared as X} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import {OptionSelect} from '@/components/OptionSelect'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {
    copyStorageObject,
    createCloudResource,
    deleteStorageObject,
    listCloudResources,
    listStorageObjects,
    storageObjectDownloadUrl,
    uploadStorageObject,
} from '@/api/cloudProxyClient'
import {capabilityEnabled, capabilityFor, normalizeCapabilities, withRuntimeState} from '@/lib/capabilities'
import type {CloudProvider} from '@/types/cloud'
import type {CloudResource, StorageObject} from '@/types/resource'
import type {CapabilitySchema, ObjectActionName} from '@/types/schema'
import {formatBytes, objectIconKind, objectPreviewKind} from '@/lib/format'
import {useAccountId} from '@/lib/accountStore'
import {storageObjectsKey, storageObjectWriteKey, storageTargetKey, type StorageTarget} from '@/lib/storageQueryKeys'
import {ImagePreviewModal} from '@/components/ImagePreviewModal'
import {ObjectThumbnail} from '@/components/ObjectThumbnail'
import {ModalOverlay} from './ModalOverlay'
import {Checkbox} from '@/components/sodium/ui/checkbox'
import {EmptyState} from '@/components/EmptyState'
import {RowsSkeleton} from '@/components/PageSkeleton'
import {Hint} from '@/components/Hint'

interface StorageObjectBrowserProps {
    cloud: CloudProvider
    resource?: CloudResource
    capabilities?: Array<CapabilitySchema<ObjectActionName> | ObjectActionName>
    runtimeReachable?: boolean
    selectedObjectKey?: string
    onSelectObject: (object?: StorageObject) => void
    /** True while Empty bucket runs on this bucket: a write now would spoil its final check. */
    writesBlocked?: boolean
}

const WRITE_ACTIONS: ObjectActionName[] = ['upload', 'delete', 'createFolder', 'copy']

export function StorageObjectBrowser({cloud, resource, capabilities = [], runtimeReachable = false, selectedObjectKey, onSelectObject, writesBlocked = false}: StorageObjectBrowserProps) {
    const qc = useQueryClient()
    const accountId = useAccountId()
    // Captured into each mutation, so a write that settles after the account or
    // bucket changed still refreshes the listing it wrote to.
    const target: StorageTarget | undefined = resource ? {accountId, cloud, bucketId: resource.id} : undefined
    // What is on screen now, read by settle callbacks: a write for another target
    // refreshes its own listing but leaves this view's selection and dialogs alone.
    const currentTargetKey = useRef('')
    useEffect(() => {
        currentTargetKey.current = target ? storageTargetKey(target) : ''
    })
    const isCurrent = (written: StorageTarget) => currentTargetKey.current === storageTargetKey(written)
    const fileRef = useRef<HTMLInputElement | null>(null)
    const [prefix, setPrefix] = useState('')
    const [uploadPrefix, setUploadPrefix] = useState('')
    const [folderName, setFolderName] = useState('')
    const [createFolderOpen, setCreateFolderOpen] = useState(false)
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
    const [copyObject, setCopyObject] = useState<StorageObject | null>(null)
    const [search, setSearch] = useState('')
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
    const [bulkDeleting, setBulkDeleting] = useState(false)
    const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null)
    const [previewObject, setPreviewObject] = useState<StorageObject | null>(null)

    const resolvedCapabilities = withRuntimeState(normalizeCapabilities(capabilities), runtimeReachable).map((capability) =>
        writesBlocked && WRITE_ACTIONS.includes(capability.name)
            ? {...capability, enabled: false, status: 'blocked' as const, reason: 'Empty bucket is running on this bucket.'}
            : capability)
    const uploadCapability = capabilityFor(resolvedCapabilities, 'upload')
    const downloadCapability = capabilityFor(resolvedCapabilities, 'download')
    const deleteCapability = capabilityFor(resolvedCapabilities, 'delete')
    const createFolderCapability = capabilityFor(resolvedCapabilities, 'createFolder')
    const copyCapability = capabilityFor(resolvedCapabilities, 'copy')
    const canUpload = capabilityEnabled(uploadCapability)
    const canDownload = capabilityEnabled(downloadCapability)
    const canDelete = capabilityEnabled(deleteCapability)
    const canCreateFolder = capabilityEnabled(createFolderCapability)
    const canCopy = capabilityEnabled(copyCapability)

    // Runtime reachability can flip while a preview is already open (it's polled
    // independently of this component). Re-checking canDownload only at the
    // moment the Eye button is clicked isn't enough — close an already-open
    // preview the instant download capability is revoked, so its modal can't
    // keep serving object content (img/video/audio src, the Download link,
    // an in-flight text fetch) after the gate that allowed it closes.
    useEffect(() => {
        if (!canDownload) setPreviewObject(null)
    }, [canDownload])

    useEffect(() => {
        setPrefix('')
        setUploadPrefix('')
        setFolderName('')
        setCreateFolderOpen(false)
        setDeleteConfirm(null)
        setCopyObject(null)
        setSearch('')
        setSelectedKeys(new Set())
        setBulkDeleteError(null)
        setPreviewObject(null)
        onSelectObject(undefined)
    }, [accountId, cloud, resource?.id, onSelectObject])

    const query = useQuery({
        queryKey: target ? storageObjectsKey(target, prefix) : ['storage-objects', accountId, cloud, undefined, prefix],
        queryFn: ({signal}) => listStorageObjects(accountId, cloud, resource?.id ?? '', prefix, signal),
        enabled: !!resource,
    })

    // Keys can vanish without this view deleting them (Empty bucket, another
    // tab), and a delete of a key that is gone would add a delete marker.
    useEffect(() => {
        const present = new Set((query.data?.objects ?? []).map((object) => object.key))
        setSelectedKeys((prev) => {
            const next = new Set([...prev].filter((key) => present.has(key)))
            return next.size === prev.size ? prev : next
        })
    }, [query.data])

    const uploadMut = useMutation({
        mutationKey: storageObjectWriteKey,
        mutationFn: async ({file, target}: {file: File; target: StorageTarget}) => {
            const key = `${uploadPrefix || prefix}${file.name}`
            await uploadStorageObject(target.accountId, target.cloud, target.bucketId, key, file)
        },
        onSuccess: (_, {target}) => qc.invalidateQueries({queryKey: storageObjectsKey(target)}),
    })

    const createFolderMut = useMutation({
        mutationKey: storageObjectWriteKey,
        mutationFn: async ({name, target}: {name: string; target: StorageTarget}) => {
            const folderKey = `${prefix}${normalizeFolderName(name)}`
            await uploadStorageObject(target.accountId, target.cloud, target.bucketId, folderKey, new Blob([], {type: 'application/x-directory'}))
        },
        onSuccess: (_, {target}) => {
            if (isCurrent(target)) {
                setFolderName('')
                setCreateFolderOpen(false)
            }
            void qc.invalidateQueries({queryKey: storageObjectsKey(target)})
        },
    })

    const deleteMut = useMutation({
        mutationKey: storageObjectWriteKey,
        mutationFn: async ({object, target}: {object: StorageObject; target: StorageTarget}) => {
            await deleteStorageObject(target.accountId, target.cloud, target.bucketId, object.key)
        },
        onSuccess: (_, {object, target}) => {
            if (isCurrent(target) && selectedObjectKey === object.key) onSelectObject(undefined)
            void qc.invalidateQueries({queryKey: storageObjectsKey(target)})
        },
    })

    // A mutation rather than a bare promise so Empty bucket can see it pending.
    // allSettled never rejects, so the caller reads every outcome.
    const bulkDeleteMut = useMutation({
        mutationKey: storageObjectWriteKey,
        mutationFn: ({keys, target}: {keys: string[]; target: StorageTarget}) =>
            Promise.allSettled(keys.map((key) => deleteStorageObject(target.accountId, target.cloud, target.bucketId, key))),
    })

    const moveCopyMut = useMutation({
        mutationKey: storageObjectWriteKey,
        mutationFn: async ({srcKey, destKey, destResourceId, mode, target}: {
            srcKey: string; destKey: string; destResourceId?: string; mode: 'move' | 'copy'; target: StorageTarget
        }) => {
            await copyStorageObject(target.accountId, target.cloud, target.bucketId, srcKey, destKey, destResourceId)
            if (mode === 'move') await deleteStorageObject(target.accountId, target.cloud, target.bucketId, srcKey)
        },
        onSuccess: (_, vars) => {
            if (isCurrent(vars.target)) {
                setCopyObject(null)
                if (vars.mode === 'move') onSelectObject(undefined)
            }
            void qc.invalidateQueries({queryKey: storageObjectsKey(vars.target)})
            if (vars.destResourceId) void qc.invalidateQueries({queryKey: storageObjectsKey({...vars.target, bucketId: vars.destResourceId})})
        },
    })

    // ── Navigation helpers ──
    function navigate(nextPrefix: string) {
        setPrefix(nextPrefix)
        setSearch('')
        setSelectedKeys(new Set())
        setDeleteConfirm(null)
        setPreviewObject(null)
        onSelectObject(undefined)
    }

    // ── Bulk delete ──
    // Every delete settles before anything is reported, and the listing is always
    // refreshed: keys that did go are dropped from the selection, so retrying the
    // rest cannot send a delete for an object that is already gone.
    async function handleBulkDelete() {
        if (!target || selectedKeys.size === 0) return
        const bulkTarget = target
        const keys = [...selectedKeys]
        setBulkDeleting(true)
        setBulkDeleteError(null)
        const results = await bulkDeleteMut.mutateAsync({keys, target: bulkTarget})
        const deleted = new Set(keys.filter((_, index) => results[index].status === 'fulfilled'))
        const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (isCurrent(bulkTarget)) {
            if (selectedObjectKey && deleted.has(selectedObjectKey)) onSelectObject(undefined)
            setSelectedKeys((prev) => new Set([...prev].filter((key) => !deleted.has(key))))
            setBulkDeleteError(failure
                ? `Could not delete ${keys.length - deleted.size} of ${keys.length} selected. ${failure.reason instanceof Error ? failure.reason.message : ''}`.trim()
                : null)
        }
        setBulkDeleting(false)
        void qc.invalidateQueries({queryKey: storageObjectsKey(bulkTarget)})
    }

    if (!resource) {
        return (
            <section className="object-browser empty compact">
                <h2>Select a storage resource</h2>
                <p>Choose a bucket or container to browse objects and blobs.</p>
            </section>
        )
    }

    const objects = query.data?.objects ?? []
    const objectLabel = cloud === 'azure' ? 'blobs' : 'objects'

    // ── Filtered data ──
    const q = search.toLowerCase()
    const filteredObjects = q
        ? objects.filter((o) => o.name.toLowerCase().includes(q) || o.key.toLowerCase().includes(q))
        : objects
    const filteredFolders = filteredObjects.filter((o) => o.type === 'folder')
    const filteredFiles = filteredObjects.filter((o) => o.type === 'object')
    const totalFolders = objects.filter((o) => o.type === 'folder').length
    const totalFiles = objects.filter((o) => o.type === 'object').length

    // ── Bulk select state ──
    const allSelected = filteredFiles.length > 0 && filteredFiles.every((f) => selectedKeys.has(f.key))
    const someSelected = !allSelected && filteredFiles.some((f) => selectedKeys.has(f.key))

    const error = query.error ?? uploadMut.error ?? createFolderMut.error ?? deleteMut.error ?? moveCopyMut.error

    return (
        <section className="object-browser">
            {previewObject && resource && objectPreviewKind(previewObject.name) && (
                <ImagePreviewModal
                    kind={objectPreviewKind(previewObject.name)!}
                    name={previewObject.name}
                    src={storageObjectDownloadUrl(cloud, resource.id, previewObject.key)}
                    onClose={() => setPreviewObject(null)}
                />
            )}

            {copyObject && resource && (
                <MoveOrCopyModal
                    cloud={cloud}
                    resource={resource}
                    srcObject={copyObject}
                    canCopy={canCopy}
                    isPending={moveCopyMut.isPending}
                    error={moveCopyMut.error instanceof Error ? moveCopyMut.error.message : null}
                    onClose={() => { setCopyObject(null); moveCopyMut.reset() }}
                    onConfirm={(destKey, destResourceId, mode) => { if (target) moveCopyMut.mutate({srcKey: copyObject.key, destKey, destResourceId, mode, target}) }}
                />
            )}

            {/* ── Header ── */}
            <div className="object-browser-header">
                <div>
                    <p className="eyebrow">Objects</p>
                    <h2>{resource.name}</h2>
                    <div className="object-browser-subtitle">
                        <ObjectBreadcrumb prefix={prefix} onNavigate={navigate}/>
                        <span>{totalFolders} folders, {totalFiles} {objectLabel}</span>
                    </div>
                </div>
                <div className="object-browser-actions">
                    {prefix && (
                        <Button variant="secondary" type="button" onClick={() => navigate(parentPrefix(prefix))}>
                            <Icon icon={ChevronLeft} size={14}/>
                            Back
                        </Button>
                    )}
                    {createFolderCapability && (
                        <Button title={createFolderCapability.reason} variant="secondary" type="button" disabled={!canCreateFolder} onClick={() => setCreateFolderOpen((open) => !open)}>
                            <Icon icon={Folder} size={14}/>
                            New folder
                        </Button>
                    )}
                    {uploadCapability && (
                        <>
                            <Input aria-label="Upload prefix" className="object-prefix-input" value={uploadPrefix} onChange={(event) => setUploadPrefix(normalizePrefix(event.target.value))} placeholder={prefix ? `Upload to ${prefix}` : 'Upload prefix'}/>
                            <Input aria-label="Choose file to upload" ref={fileRef} type="file" className="hidden" onChange={(event) => {
                                const file = event.target.files?.[0]
                                if (file && target) uploadMut.mutate({file, target})
                                event.currentTarget.value = ''
                            }}/>
                            <Button title={uploadCapability.reason} variant="secondary" type="button" disabled={!canUpload} onClick={() => fileRef.current?.click()}>
                                <Icon icon={Upload} size={14}/>
                                {uploadMut.isPending ? 'Uploading' : 'Upload'}
                            </Button>
                        </>
                    )}
                    <Button variant="secondary" type="button" disabled={query.isFetching} onClick={() => query.refetch()}>
                        <Icon icon={RefreshCw} size={14}/>
                        {query.isFetching ? 'Loading' : 'Refresh'}
                    </Button>
                </div>
            </div>

            {/* ── Create folder ── */}
            {createFolderOpen && (
                <form className="object-create-folder" onSubmit={(event) => {
                    event.preventDefault()
                    if (folderName.trim() && target) createFolderMut.mutate({name: folderName, target})
                }}>
                    <label>
                        <span>Folder name</span>
                        <Input aria-label="Folder name" value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder={prefix ? `${prefix}new-folder/` : 'new-folder/'}/>
                    </label>
                    <Button type="submit" disabled={createFolderMut.isPending || !folderName.trim()}>
                        <Icon icon={Folder} size={14}/>
                        {createFolderMut.isPending ? 'Creating' : 'Create folder'}
                    </Button>
                </form>
            )}

            {/* ── Error ── */}
            {bulkDeleteError && <div className="inline-error">{bulkDeleteError}</div>}
            {error && (
                <div className="inline-error">
                    {error instanceof Error ? error.message : 'Storage operation failed'}
                </div>
            )}

            {/* ── Search bar ── */}
            {!query.isLoading && objects.length > 0 && (
                <div className="object-search-bar">
                    <Icon icon={Search} size={14}/>
                    <Input aria-label={`Search ${objectLabel} and folders`}
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setSelectedKeys(new Set()) }}
                        placeholder={`Search ${objectLabel} and folders…`}
                    />
                    {search && (
                        <Hint label="Clear search"><Button variant="ghost" size="icon-sm" type="button" onClick={() => setSearch('')} aria-label="Clear search">
                            <Icon icon={X} size={14} aria-hidden="true"/>
                        </Button></Hint>
                    )}
                    {search && (
                        <span className="type-caption text-text-3 whitespace-nowrap">
                            {filteredObjects.length} / {objects.length}
                        </span>
                    )}
                </div>
            )}

            {/* ── Table ── */}
            {query.isLoading ? (
                <RowsSkeleton label="Loading objects"/>
            ) : objects.length === 0 ? (
                <EmptyState compact title={<>No {objectLabel}</>} description={<>{prefix ? `The ${prefix} prefix is empty.` : `This ${resource.type} has no ${objectLabel} yet.`}</>}/>
            ) : filteredObjects.length === 0 ? (
                <EmptyState compact title="No results" description={<>Nothing matches &ldquo;{search}&rdquo;.</>}/>
            ) : (
                <table className="table object-table">
                    <thead>
                        <tr>
                            <th className="w-8 text-center">
                                <Checkbox
                                    indeterminate={someSelected}
                                    checked={allSelected}
                                    aria-label={allSelected ? 'Deselect all' : 'Select all files'}
                                    onCheckedChange={() => {
                                        if (allSelected) setSelectedKeys(new Set())
                                        else setSelectedKeys(new Set(filteredFiles.map((f) => f.key)))
                                    }}
                                />
                            </th>
                            <th>Name</th>
                            <th>Type</th>
                            <th>Size</th>
                            <th>Last Modified</th>
                            <th aria-label="Actions"/>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredFolders.map((object) => (
                            <tr key={object.key}>
                                <td/>
                                <td className="cursor-pointer" onClick={() => navigate(object.key)}>
                                    <span className="object-name">
                                        <Icon icon={Folder} size={14}/>
                                        {object.name}
                                        <Icon icon={ChevronRight} size={14}/>
                                    </span>
                                </td>
                                <td>{object.type}</td>
                                <td>, </td>
                                <td>{object.lastModified ?? ', '}</td>
                                <td/>
                            </tr>
                        ))}
                        {filteredFiles.map((object) => {
                            const isSelected = selectedKeys.has(object.key)
                            const iconKind = objectIconKind(object.name)
                            const previewKind = objectPreviewKind(object.name)
                            return (
                                <tr
                                    key={object.key}
                                    className={[
                                        selectedObjectKey === object.key ? 'selected' : '',
                                        isSelected ? 'bulk-selected' : '',
                                    ].filter(Boolean).join(' ')}
                                >
                                    <td className="text-center">
                                        <Checkbox aria-label={`Select ${object.name}`}
                                            checked={isSelected}
                                            onClick={(e) => e.stopPropagation()}
                                            onCheckedChange={(checked) => {
                                                const next = new Set(selectedKeys)
                                                if (checked) next.add(object.key)
                                                else next.delete(object.key)
                                                setSelectedKeys(next)
                                            }}
                                        />
                                    </td>
                                    <td className="cursor-pointer" onClick={() => onSelectObject(object)}>
                                        <span className="object-name">
                                            {iconKind ? (
                                                <ObjectThumbnail kind={iconKind} src={storageObjectDownloadUrl(cloud, resource.id, object.key)} name={object.name} canLoad={canDownload}/>
                                            ) : (
                                                <Icon icon={File} size={14}/>
                                            )}
                                            {object.name}
                                        </span>
                                    </td>
                                    <td>{object.type}</td>
                                    <td>{object.size === null ? ', ' : formatBytes(object.size)}</td>
                                    <td>{object.lastModified ?? ', '}</td>
                                    <td className="table-actions">
                                        {previewKind && (
                                            <Button title={canDownload ? `Preview ${object.name}` : (downloadCapability?.reason ?? `Preview ${object.name}`)} variant="ghost" size="icon-sm"
                                                type="button"
                                                disabled={!canDownload} aria-label={canDownload ? `Preview ${object.name}` : (downloadCapability?.reason ?? `Preview ${object.name}`)}
                                                onClick={(e) => { e.stopPropagation(); if (canDownload) setPreviewObject(object) }}
                                            >
                                                <Icon icon={Eye} size={14}/>
                                            </Button>
                                        )}
                                        {downloadCapability && (
                                            <a className={`icon-btn ${canDownload ? '' : 'disabled'}`} href={canDownload ? storageObjectDownloadUrl(cloud, resource.id, object.key) : undefined} title={downloadCapability.reason ?? `Download ${object.name}`}>
                                                <Icon icon={Download} size={14}/>
                                            </a>
                                        )}
                                        {copyCapability && (
                                            <Button title={copyCapability.reason ?? `Move / Copy ${object.name}`} variant="ghost" size="icon-sm" disabled={!canCopy} aria-label={copyCapability.reason ?? `Move / Copy ${object.name}`} onClick={() => setCopyObject(object)}>
                                                <Icon icon={Copy} size={14}/>
                                            </Button>
                                        )}
                                        {canDelete && deleteConfirm === object.key ? (
                                            <Button variant="destructive" size="sm" disabled={deleteMut.isPending} onClick={() => {
                                                if (target) deleteMut.mutate({object, target})
                                                setDeleteConfirm(null)
                                            }}>
                                                Confirm
                                            </Button>
                                        ) : (
                                            deleteCapability && (
                                                <Button title={deleteCapability.reason ?? `Delete ${object.name}`} variant="ghost" size="icon-sm" disabled={!canDelete} aria-label={deleteCapability.reason ?? `Delete ${object.name}`} onClick={() => setDeleteConfirm(object.key)}>
                                                    <Icon icon={Trash2} size={14}/>
                                                </Button>
                                            )
                                        )}
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            )}

            {/* ── Bulk action bar ── */}
            {selectedKeys.size > 0 && (
                <div className="bulk-bar">
                    <span className="bulk-count">
                        {selectedKeys.size} {objectLabel.replace(/s$/, '')}{selectedKeys.size !== 1 ? 's' : ''} selected
                    </span>
                    <span className="bulk-spacer"/>
                    <Button variant="secondary"
                        onClick={() => setSelectedKeys(new Set())}
                        disabled={bulkDeleting}
                    >
                        Deselect all
                    </Button>
                    {deleteCapability && (
                        <Button title={deleteCapability.reason} variant="destructive"
                            disabled={!canDelete || bulkDeleting}
                            onClick={() => void handleBulkDelete()}
                        >
                            {bulkDeleting ? <Icon icon={Loader2} size={14}/> : <Icon icon={Trash2} size={14}/>}
                            Delete {selectedKeys.size}
                        </Button>
                    )}
                </div>
            )}
        </section>
    )
}

// ─── Move / Copy modal ────────────────────────────────────────────────────────

const NEW_RESOURCE_SENTINEL = '__new__'

function MoveOrCopyModal({
    cloud,
    resource,
    srcObject,
    canCopy,
    isPending,
    error,
    onClose,
    onConfirm,
}: {
    cloud: CloudProvider
    resource: CloudResource
    srcObject: StorageObject
    canCopy: boolean
    isPending: boolean
    error: string | null
    onClose: () => void
    onConfirm: (destKey: string, destResourceId: string | undefined, mode: 'move' | 'copy') => void
}) {
    const qc = useQueryClient()
    const resourceLabel = cloud === 'azure' ? 'container' : 'bucket'
    const [mode, setMode] = useState<'move' | 'copy'>('move')
    const [destKey, setDestKey] = useState(() => {
        const parts = srcObject.key.split('/')
        const filename = parts.pop() ?? srcObject.key
        const dir = parts.join('/')
        return dir ? `${dir}/copy-of-${filename}` : `copy-of-${filename}`
    })
    const [destResourceId, setDestResourceId] = useState(resource.id)
    const [newResourceName, setNewResourceName] = useState('')

    const resourcesQuery = useQuery({
        queryKey: ['cloud-resources', cloud, 'storage'],
        queryFn: ({signal}) => listCloudResources(cloud, 'storage', undefined, signal),
    })

    const createResourceMut = useMutation({
        mutationFn: () => {
            const nameField = cloud === 'azure' ? 'containerName' : 'bucketName'
            return createCloudResource(cloud, 'storage', {[nameField]: newResourceName.trim()})
        },
        onSuccess: (created) => {
            setDestResourceId(created.id)
            setNewResourceName('')
            void qc.invalidateQueries({queryKey: ['cloud-resources', cloud, 'storage']})
        },
    })

    const isCreatingNew = destResourceId === NEW_RESOURCE_SENTINEL
    const resources = resourcesQuery.data ?? []
    const resolvedDestId = isCreatingNew ? undefined : (destResourceId !== resource.id ? destResourceId : undefined)

    return (
        <ModalOverlay className="copy-modal-overlay" onClose={onClose} aria-label={`${mode === 'move' ? 'Move' : 'Copy'} ${srcObject.key}`}>
            <div className="copy-modal">
                <div className="drawer-tabs mb-3.5">
                    <Button variant={mode === 'move' ? 'secondary' : 'ghost'} onClick={() => setMode('move')}>Move</Button>
                    <Button variant={mode === 'copy' ? 'secondary' : 'ghost'} onClick={() => setMode('copy')}>Copy</Button>
                </div>

                <div className="type-caption text-text-3 mb-3">
                    Source: <span className="mono text-text-2">{resource.name}/{srcObject.key}</span>
                </div>

                <div className="form-row">
                    <label>Destination {resourceLabel}</label>
                    {resourcesQuery.isLoading ? (
                        <div className="flex items-center gap-1.5 type-caption text-text-3">
                            <Icon icon={Loader2} size={14}/> Loading {resourceLabel}s…
                        </div>
                    ) : (
                        <OptionSelect aria-label={`Destination ${resourceLabel}`} value={destResourceId} onValueChange={(value) => setDestResourceId(value)}>
                            {resources.map((r) => (
                                <option key={r.id} value={r.id}>
                                    {r.name}{r.id === resource.id ? ' (current)' : ''}
                                </option>
                            ))}
                            <option value={NEW_RESOURCE_SENTINEL}>+ New {resourceLabel}…</option>
                        </OptionSelect>
                    )}
                </div>

                {isCreatingNew && (
                    <div className="flex gap-1.5 items-center -mt-1.5 mb-1">
                        <Input aria-label={`New ${resourceLabel} name`}
                            autoFocus
                            value={newResourceName}
                            onChange={(e) => setNewResourceName(e.target.value.toLowerCase().replace(cloud === 'azure' ? /[^a-z0-9-]/g : /[^a-z0-9.-]/g, ''))}
                            placeholder={`new-${resourceLabel}-name`}
                            onKeyDown={(e) => { if (e.key === 'Enter' && newResourceName.trim().length >= 3) createResourceMut.mutate() }}
                        />
                        <Button
                            disabled={newResourceName.trim().length < 3 || createResourceMut.isPending}
                            onClick={() => createResourceMut.mutate()}
                        >
                            {createResourceMut.isPending ? <Icon icon={Loader2} size={14}/> : 'Create'}
                        </Button>
                    </div>
                )}
                {createResourceMut.isError && (
                    <p className="type-caption text-fail-text mt-0 mx-0 mb-1.5">
                        {createResourceMut.error instanceof Error ? createResourceMut.error.message : 'Create failed'}
                    </p>
                )}

                <div className="form-row">
                    <label>Destination key</label>
                    <Input aria-label="Destination key" value={destKey} onChange={(e) => setDestKey(e.target.value)}/>
                </div>

                {error && <p className="type-caption text-fail-text mt-0 mx-0 mb-1">{error}</p>}

                <div className="copy-modal-footer">
                    <Button variant="secondary" onClick={onClose} disabled={isPending}>Cancel</Button>
                    <Button
                        disabled={!destKey.trim() || isCreatingNew || !canCopy || isPending}
                        onClick={() => onConfirm(destKey, resolvedDestId, mode)}
                    >
                        {isPending ? <Icon icon={Loader2} size={14}/> : <Icon icon={Copy} size={14}/>}
                        {mode === 'move' ? 'Move' : 'Copy'}
                    </Button>
                </div>
            </div>
        </ModalOverlay>
    )
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function ObjectBreadcrumb({prefix, onNavigate}: {prefix: string; onNavigate: (prefix: string) => void}) {
    const segments = prefix ? prefix.replace(/\/$/, '').split('/') : []
    return (
        <div className="object-breadcrumb">
            <Button variant="ghost" type="button" onClick={() => onNavigate('')}>Root</Button>
            {segments.map((segment, index) => {
                const path = `${segments.slice(0, index + 1).join('/')}/`
                return (
                    <span key={path}>
                        <Icon icon={ChevronRight} size={14}/>
                        <Button variant="ghost" type="button" onClick={() => onNavigate(path)}>{segment}</Button>
                    </span>
                )
            })}
        </div>
    )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizePrefix(value: string): string {
    const trimmed = value.trim().replace(/^\/+/, '')
    return trimmed && !trimmed.endsWith('/') ? `${trimmed}/` : trimmed
}

function normalizeFolderName(value: string): string {
    const normalized = value.trim().replace(/^\/+/, '')
    return normalized.endsWith('/') ? normalized : `${normalized}/`
}

function parentPrefix(prefix: string): string {
    const segments = prefix.replace(/\/$/, '').split('/').filter(Boolean)
    segments.pop()
    return segments.length ? `${segments.join('/')}/` : ''
}

