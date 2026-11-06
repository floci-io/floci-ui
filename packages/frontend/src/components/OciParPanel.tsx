import {useState, type FormEvent} from 'react'
import {Copy, KeyRound, Loader2, Trash2} from 'lucide-react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {deleteFlatItem, listFlatItems, putFlatItem} from '@/api/cloudProxyClient'
import {EmptyState} from '@/components/EmptyState'
import {useAccountId} from '@/lib/accountStore'
import type {ChildItem, CloudResource} from '@/types/resource'

interface OciParPanelProps {
    resource?: CloudResource
    runtimeReachable: boolean
}

const ACCESS_TYPES = [
    'ObjectRead',
    'ObjectWrite',
    'ObjectReadWrite',
    'AnyObjectRead',
    'AnyObjectWrite',
    'AnyObjectReadWrite',
] as const

type AccessType = typeof ACCESS_TYPES[number]

const needsObject = (type: AccessType) => type.startsWith('Object')

/** A datetime-local value one day ahead, in the browser's own timezone. */
function defaultExpiry(): string {
    const date = new Date(Date.now() + 24 * 60 * 60 * 1000)
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
    return date.toISOString().slice(0, 16)
}

function text(value: unknown): string {
    return typeof value === 'string' ? value : ''
}

/**
 * Pre-authenticated requests of an OCI bucket, through the generic flat item
 * store. The access URI is returned by the create call only, as in the real
 * service, so it is shown once here and cannot be listed again.
 */
export function OciParPanel({resource, runtimeReachable}: OciParPanelProps) {
    if (!resource || resource.cloud !== 'oci' || resource.service !== 'storage') return null
    // Keyed so another bucket starts from an empty form and no leftover URI.
    return <ParPanel key={resource.id} bucket={resource.id} runtimeReachable={runtimeReachable}/>
}

function ParPanel({bucket, runtimeReachable}: {bucket: string; runtimeReachable: boolean}) {
    const accountId = useAccountId()
    const qc = useQueryClient()
    const queryKey = ['oci-pars', accountId, bucket]
    const [name, setName] = useState('')
    const [accessType, setAccessType] = useState<AccessType>('AnyObjectRead')
    const [objectName, setObjectName] = useState('')
    const [expires, setExpires] = useState(defaultExpiry)
    const [created, setCreated] = useState<ChildItem | null>(null)
    const [formError, setFormError] = useState<string | null>(null)

    const pars = useQuery({
        queryKey,
        queryFn: ({signal}) => listFlatItems('oci', 'storage', bucket, undefined, signal),
        enabled: runtimeReachable,
    })
    const createMut = useMutation({
        mutationFn: (body: Record<string, unknown>) => putFlatItem('oci', 'storage', bucket, body),
        onSuccess: (item) => {
            setCreated(item)
            setName('')
            setObjectName('')
            void qc.invalidateQueries({queryKey})
        },
    })
    const deleteMut = useMutation({
        mutationFn: (id: string) => deleteFlatItem('oci', 'storage', bucket, id),
        onSuccess: () => void qc.invalidateQueries({queryKey}),
    })

    const submit = (event: FormEvent) => {
        event.preventDefault()
        setCreated(null)
        const expiresAt = new Date(expires)
        if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
            setFormError('Expiry must be a date and time in the future.')
            return
        }
        setFormError(null)
        createMut.mutate({
            name: name.trim(),
            accessType,
            timeExpires: expiresAt.toISOString(),
            ...(needsObject(accessType) ? {objectName: objectName.trim()} : {}),
        })
    }

    const items = pars.data?.items ?? []
    const error = formError ?? (createMut.error as Error | null)?.message ?? null

    return (
        <section className="table-panel">
            <div className="dynamic-stage-header">
                <div>
                    <p className="eyebrow">Pre-authenticated requests</p>
                    <h2>{bucket}</h2>
                    <p className="muted compact-text">The access URI is shown once, when the request is created.</p>
                </div>
            </div>

            <form className="resource-create-inline" onSubmit={submit}>
                <label className="metric-label" htmlFor="oci-par-name">Name</label>
                <input id="oci-par-name" className="input" value={name} autoComplete="off" required
                       disabled={!runtimeReachable || createMut.isPending} onChange={(e) => setName(e.target.value)}/>
                <label className="metric-label" htmlFor="oci-par-access">Access type</label>
                <select id="oci-par-access" className="input" value={accessType}
                        disabled={!runtimeReachable || createMut.isPending}
                        onChange={(e) => setAccessType(e.target.value as AccessType)}>
                    {ACCESS_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                {needsObject(accessType) && (
                    <>
                        <label className="metric-label" htmlFor="oci-par-object">Object name</label>
                        <input id="oci-par-object" className="input" value={objectName} autoComplete="off" required
                               disabled={!runtimeReachable || createMut.isPending}
                               onChange={(e) => setObjectName(e.target.value)}/>
                    </>
                )}
                <label className="metric-label" htmlFor="oci-par-expiry">Expires</label>
                <input id="oci-par-expiry" className="input" type="datetime-local" value={expires} required
                       disabled={!runtimeReachable || createMut.isPending} onChange={(e) => setExpires(e.target.value)}/>
                <button className="button primary" type="submit" disabled={!runtimeReachable || createMut.isPending}>
                    {createMut.isPending ? <Loader2 size={13} className="spin"/> : <KeyRound size={13}/>} Create request
                </button>
                {error && <p className="error-text compact-text" role="alert">{error}</p>}
            </form>

            {created && (
                <div className="inspector-section">
                    <p className="metric-label">Access URI (shown once)</p>
                    <pre className="invoke-result success">{text(created.body.accessUri) || text(created.body.fullPath)}</pre>
                    <button className="button" type="button"
                            onClick={() => void navigator.clipboard.writeText(text(created.body.accessUri) || text(created.body.fullPath))}>
                        <Copy size={13}/> Copy
                    </button>
                </div>
            )}

            {pars.isError && <p className="error-text compact-text" role="alert">{(pars.error as Error).message}</p>}
            {deleteMut.isError && <p className="error-text compact-text" role="alert">{(deleteMut.error as Error).message}</p>}

            {pars.isSuccess && items.length === 0 ? (
                <EmptyState icon={KeyRound} title="No pre-authenticated requests"
                            description="Create one above to share a bucket or an object without credentials." compact/>
            ) : items.length > 0 && (
                <table className="table">
                    <thead>
                    <tr><th>Name</th><th>Access type</th><th>Object</th><th>Expires</th><th/></tr>
                    </thead>
                    <tbody>
                    {items.map((item) => (
                        <tr key={item.id}>
                            <td>{text(item.body.name)}</td>
                            <td>{text(item.body.accessType)}</td>
                            <td>{text(item.body.objectName) || 'All objects'}</td>
                            <td>{text(item.body.timeExpires)}</td>
                            <td>
                                <button className="button" type="button" aria-label={`Delete ${text(item.body.name)}`}
                                        disabled={!runtimeReachable || deleteMut.isPending}
                                        onClick={() => deleteMut.mutate(item.id)}>
                                    <Trash2 size={13}/>
                                </button>
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            )}
        </section>
    )
}
