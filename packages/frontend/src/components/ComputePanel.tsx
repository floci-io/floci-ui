import { type FormEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
    AlertTriangle,
    HardDrive,
    Loader2,
    Play,
    Plus,
    Power,
    RefreshCw,
    RotateCcw,
    Save,
    Terminal,
    Trash2,
    X,
} from 'lucide-react'
import {
    authorizeEc2SecurityGroupIngress,
    createEc2Ami,
    createEc2SecurityGroup,
    deregisterEc2Ami,
    describeEc2Instance,
    getEc2ConsoleOutput,
    listEc2Amis,
    listEc2KeyPairs,
    listEc2SecurityGroups,
    listEc2Subnets,
    listEc2Vpcs,
    rebootEc2Instance,
    startEc2Instance,
    stopEc2Instance,
    terminateEc2Instance,
    updateEc2InstanceTags,
    type Ec2Image,
    type Ec2KeyPair,
    type Ec2SecurityGroup,
    type Ec2Subnet,
    type Ec2Tag,
    type Ec2Vpc,
    type IpPermissionInput,
} from '@/api/aws/ec2.api'
import { createCloudResource } from '@/api/cloudProxyClient'
import type { CloudProvider } from '@/types/cloud'
import type { CloudResource } from '@/types/resource'

// ─── Props ────────────────────────────────────────────────────────────────────

interface ComputePanelProps {
    cloud: CloudProvider
    resource?: CloudResource
    runtimeReachable?: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stateClass(state?: string): string {
    switch (state) {
        case 'running': return 'healthy'
        case 'stopped': return 'inactive'
        case 'pending':
        case 'stopping': return 'pending'
        case 'terminated':
        case 'shutting-down': return 'error'
        default: return 'unknown'
    }
}

// ─── Tag editor (inline) ──────────────────────────────────────────────────────

function InlineTagEditor({ instanceId, initialTags }: { instanceId: string; initialTags: Ec2Tag[] }) {
    const qc = useQueryClient()
    const [rows, setRows] = useState<Ec2Tag[]>(initialTags)
    const [err, setErr] = useState('')

    const mutation = useMutation({
        mutationFn: ({ toAdd, toRemove }: { toAdd: Ec2Tag[]; toRemove: string[] }) =>
            updateEc2InstanceTags(instanceId, toAdd, toRemove),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['ec2', 'instance', instanceId] })
            void qc.invalidateQueries({ queryKey: ['ec2', 'instances'] })
        },
        onError: (e) => setErr(e instanceof Error ? e.message : 'Save failed'),
    })

    function addRow() { setRows((prev) => [...prev, { key: '', value: '' }]) }
    function removeRow(idx: number) { setRows((prev) => prev.filter((_, i) => i !== idx)) }
    function setKey(idx: number, key: string) { setRows((prev) => prev.map((r, i) => i === idx ? { ...r, key } : r)) }
    function setValue(idx: number, value: string) { setRows((prev) => prev.map((r, i) => i === idx ? { ...r, value } : r)) }

    function handleSave() {
        const newTags = rows.filter((r) => r.key.trim())
        const newKeys = new Set(newTags.map((t) => t.key))
        const oldKeys = new Set(initialTags.map((t) => t.key))
        const toAdd = newTags.filter((t) => !oldKeys.has(t.key) || initialTags.find((ot) => ot.key === t.key)?.value !== t.value)
        const toRemove = initialTags.map((t) => t.key).filter((k) => !newKeys.has(k))
        setErr('')
        mutation.mutate({ toAdd, toRemove })
    }

    return (
        <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                {rows.map((tag, idx) => (
                    <div key={idx} className="field-row" style={{ gap: 4 }}>
                        <input
                            className="input"
                            placeholder="Key"
                            value={tag.key}
                            onChange={(e) => setKey(idx, e.target.value)}
                            style={{ flex: 1 }}
                        />
                        <input
                            className="input"
                            placeholder="Value"
                            value={tag.value}
                            onChange={(e) => setValue(idx, e.target.value)}
                            style={{ flex: 2 }}
                        />
                        <button className="icon-btn danger" onClick={() => removeRow(idx)} title="Remove">
                            <Trash2 size={12} />
                        </button>
                    </div>
                ))}
            </div>
            {err && <p style={{ fontSize: 11, color: 'var(--status-error)', margin: '0 0 6px' }}>{err}</p>}
            <div style={{ display: 'flex', gap: 6 }}>
                <button className="button compact" onClick={addRow}>
                    <Plus size={12} />
                    Add tag
                </button>
                <button className="button compact primary" onClick={handleSave} disabled={mutation.isPending}>
                    {mutation.isPending ? <Loader2 size={12} /> : <Save size={12} />}
                    Save tags
                </button>
            </div>
        </div>
    )
}

// ─── Create AMI modal (inline) ────────────────────────────────────────────────

function CreateAmiModal({ instanceId, instanceName, onClose, onCreated }: {
    instanceId: string
    instanceName: string
    onClose: () => void
    onCreated: () => void
}) {
    const [name, setName] = useState(`${instanceName}-ami`)
    const [description, setDescription] = useState('')
    const [noReboot, setNoReboot] = useState(false)
    const [err, setErr] = useState('')

    const qc = useQueryClient()
    const mutation = useMutation({
        mutationFn: () => createEc2Ami(instanceId, {
            name: name.trim(),
            description: description || undefined,
            noReboot,
        }),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['ec2', 'amis'] })
            onCreated()
            onClose()
        },
        onError: (e) => setErr(e instanceof Error ? e.message : 'AMI creation failed'),
    })

    function handleSubmit() {
        if (!name.trim()) { setErr('Name is required.'); return }
        setErr('')
        mutation.mutate()
    }

    return (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
            <div className="create-table-modal" style={{ maxWidth: 420 }}>
                <h3>Create AMI</h3>

                <div className="modal-section">
                    <p className="modal-section-title">Image name</p>
                    <input
                        className="input"
                        style={{ width: '100%', minWidth: 'unset' }}
                        autoFocus
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Escape' && onClose()}
                    />
                </div>

                <div className="modal-section">
                    <p className="modal-section-title">Description — optional</p>
                    <input
                        className="input"
                        style={{ width: '100%', minWidth: 'unset' }}
                        placeholder="e.g. production snapshot"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />
                </div>

                <div className="modal-section">
                    <div className="field-row" style={{ alignItems: 'center' }}>
                        <label className="toggle-switch" style={{ width: 32, height: 18 }}>
                            <input type="checkbox" checked={noReboot} onChange={(e) => setNoReboot(e.target.checked)} />
                            <span className="toggle-track" />
                        </label>
                        <p className="modal-section-title" style={{ margin: 0 }}>No reboot — skip instance restart before imaging</p>
                    </div>
                </div>

                {err && <p style={{ fontSize: 12, color: 'var(--status-error)', margin: '0 0 8px' }}>{err}</p>}

                <div className="modal-footer">
                    <button className="button" onClick={onClose} disabled={mutation.isPending}>Cancel</button>
                    <button
                        className="button primary"
                        onClick={handleSubmit}
                        disabled={!name.trim() || mutation.isPending}
                    >
                        {mutation.isPending ? <Loader2 size={13} /> : <HardDrive size={13} />}
                        Create AMI
                    </button>
                </div>
            </div>
        </div>
    )
}

// ─── Console output modal (inline) ───────────────────────────────────────────

function ConsoleOutputModal({ instanceId, onClose }: { instanceId: string; onClose: () => void }) {
    const query = useQuery({
        queryKey: ['ec2', 'console', instanceId],
        queryFn: ({ signal }) => getEc2ConsoleOutput(instanceId, signal),
    })

    return (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
            <div className="create-table-modal" style={{ maxWidth: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Terminal size={14} />
                    Console output — {instanceId}
                </h3>

                {query.isLoading && (
                    <p style={{ fontSize: 12, color: 'var(--text-2)' }}>Loading…</p>
                )}

                {query.isError && (
                    <p style={{ fontSize: 12, color: 'var(--status-error)' }}>
                        {query.error instanceof Error ? query.error.message : 'Failed to fetch console output.'}
                    </p>
                )}

                {query.data && (
                    <>
                        {query.data.timestamp && (
                            <p style={{ fontSize: 11, color: 'var(--text-2)', margin: '0 0 8px' }}>
                                As of {new Date(query.data.timestamp).toLocaleString()}
                            </p>
                        )}
                        <pre
                            className="mono"
                            style={{
                                flex: 1,
                                overflowY: 'auto',
                                background: 'var(--surface-2)',
                                padding: 12,
                                borderRadius: 4,
                                fontSize: 11,
                                margin: 0,
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-all',
                            }}
                        >
                            {query.data.output || '(no output yet)'}
                        </pre>
                    </>
                )}

                <div className="modal-footer" style={{ marginTop: 12 }}>
                    <button className="button" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    )
}

// ─── Deregister AMI confirm (inline) ─────────────────────────────────────────

function DeregisterAmiConfirm({ imageId, onConfirm, onCancel, isPending }: {
    imageId: string
    onConfirm: () => void
    onCancel: () => void
    isPending: boolean
}) {
    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="create-table-modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
                <div className="modal-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertTriangle size={14} style={{ color: 'var(--status-error)', flexShrink: 0 }} />
                    <span>Deregister AMI</span>
                    <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onCancel} aria-label="Close" title="Close">
                        <X size={13} />
                    </button>
                </div>
                <div className="modal-section">
                    <div style={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                        borderRadius: 4,
                        padding: '8px 12px',
                        marginBottom: 12,
                    }}>
                        <div style={{ fontFamily: 'monospace', fontSize: 13 }}>{imageId}</div>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        This will deregister the AMI. Associated snapshots are not deleted automatically.
                    </p>
                </div>
                <div className="modal-footer">
                    <button className="button" onClick={onCancel} disabled={isPending}>Cancel</button>
                    <button className="button danger" onClick={onConfirm} disabled={isPending}>
                        {isPending ? <Loader2 size={13} /> : <Trash2 size={13} />}
                        Deregister
                    </button>
                </div>
            </div>
        </div>
    )
}

// ─── Instance panel ───────────────────────────────────────────────────────────

function InstancePanel({ instanceId }: { instanceId: string }) {
    const qc = useQueryClient()
    const [tab, setTab] = useState<'details' | 'tags' | 'console'>('details')
    const [showAmiModal, setShowAmiModal] = useState(false)
    const [showConsoleModal, setShowConsoleModal] = useState(false)
    const [terminateStep, setTerminateStep] = useState<'idle' | 'confirm'>('idle')

    const query = useQuery({
        queryKey: ['ec2', 'instance', instanceId],
        queryFn: ({ signal }) => describeEc2Instance(instanceId, signal),
    })

    const invalidate = () => {
        void qc.invalidateQueries({ queryKey: ['ec2', 'instance', instanceId] })
        void qc.invalidateQueries({ queryKey: ['ec2', 'instances'] })
    }

    const startMut = useMutation({
        mutationFn: () => startEc2Instance(instanceId),
        onSuccess: invalidate,
    })
    const stopMut = useMutation({
        mutationFn: () => stopEc2Instance(instanceId),
        onSuccess: invalidate,
    })
    const rebootMut = useMutation({
        mutationFn: () => rebootEc2Instance(instanceId),
        onSuccess: invalidate,
    })
    const terminateMut = useMutation({
        mutationFn: () => terminateEc2Instance(instanceId),
        onSuccess: () => {
            setTerminateStep('idle')
            invalidate()
        },
    })

    if (query.isLoading) {
        return (
            <div className="empty compact">
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                <p>Loading instance…</p>
            </div>
        )
    }

    if (query.isError || !query.data) {
        return (
            <div className="empty compact">
                <p style={{ color: 'var(--status-error)' }}>
                    {query.error instanceof Error ? query.error.message : 'Failed to load instance'}
                </p>
            </div>
        )
    }

    const inst = query.data
    const state = inst.state ?? 'unknown'
    const canStart = state === 'stopped'
    const canStop = state === 'running'
    const canReboot = state === 'running'
    const canTerminate = state !== 'terminated' && state !== 'shutting-down'

    return (
        <>
            {showAmiModal && (
                <CreateAmiModal
                    instanceId={instanceId}
                    instanceName={inst.name}
                    onClose={() => setShowAmiModal(false)}
                    onCreated={() => void qc.invalidateQueries({ queryKey: ['ec2', 'amis'] })}
                />
            )}
            {showConsoleModal && (
                <ConsoleOutputModal
                    instanceId={instanceId}
                    onClose={() => setShowConsoleModal(false)}
                />
            )}

            <div className="widget">
                <div className="widget-header">
                    <h3>{inst.name || instanceId}</h3>
                    <span className={`status ${stateClass(state)}`}>{state}</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        <button
                            className="button compact"
                            disabled={!canStart || startMut.isPending}
                            onClick={() => startMut.mutate()}
                            title="Start"
                        >
                            <Play size={12} />
                            Start
                        </button>
                        <button
                            className="button compact"
                            disabled={!canStop || stopMut.isPending}
                            onClick={() => stopMut.mutate()}
                            title="Stop"
                        >
                            <Power size={12} />
                            Stop
                        </button>
                        <button
                            className="button compact"
                            disabled={!canReboot || rebootMut.isPending}
                            onClick={() => rebootMut.mutate()}
                            title="Reboot"
                        >
                            <RotateCcw size={12} />
                            Reboot
                        </button>
                        <button
                            className="button compact"
                            onClick={() => setShowAmiModal(true)}
                            title="Create AMI"
                        >
                            <HardDrive size={12} />
                            Create AMI
                        </button>
                        {canTerminate && terminateStep === 'idle' && (
                            <button
                                className="button compact danger"
                                onClick={() => setTerminateStep('confirm')}
                                title="Terminate"
                            >
                                <Trash2 size={12} />
                                Terminate
                            </button>
                        )}
                        {canTerminate && terminateStep === 'confirm' && (
                            <>
                                <button
                                    className="button compact danger"
                                    disabled={terminateMut.isPending}
                                    onClick={() => terminateMut.mutate()}
                                >
                                    {terminateMut.isPending ? <Loader2 size={12} /> : null}
                                    Confirm terminate
                                </button>
                                <button
                                    className="button compact"
                                    onClick={() => setTerminateStep('idle')}
                                >
                                    Cancel
                                </button>
                            </>
                        )}
                        <button
                            className="button compact"
                            disabled={query.isFetching}
                            onClick={() => query.refetch()}
                        >
                            <RefreshCw size={12} />
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="sns-tabs">
                    <button
                        className={`sns-tab${tab === 'details' ? ' active' : ''}`}
                        onClick={() => setTab('details')}
                    >
                        Details
                    </button>
                    <button
                        className={`sns-tab${tab === 'tags' ? ' active' : ''}`}
                        onClick={() => setTab('tags')}
                    >
                        Tags
                    </button>
                    <button
                        className={`sns-tab${tab === 'console' ? ' active' : ''}`}
                        onClick={() => { setTab('console'); setShowConsoleModal(true) }}
                    >
                        Console
                    </button>
                </div>

                <div className="widget-body">
                    {tab === 'details' && (
                        <div className="meta-grid">
                            <div className="meta-row">
                                <span className="meta-label">Instance ID</span>
                                <span className="meta-value" style={{ fontFamily: 'monospace' }}>{inst.instanceId}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">Type</span>
                                <span className="meta-value">{inst.instanceType ?? '—'}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">AMI</span>
                                <span className="meta-value" style={{ fontFamily: 'monospace', fontSize: 11 }}>{inst.imageId ?? '—'}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">Key pair</span>
                                <span className="meta-value">{inst.keyName ?? '—'}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">Architecture</span>
                                <span className="meta-value">{inst.architecture ?? '—'}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">Platform</span>
                                <span className="meta-value">{inst.platform ?? 'Linux'}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">Launch time</span>
                                <span className="meta-value" style={{ color: '#8d9cad' }}>{inst.launchTime ?? '—'}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">Availability zone</span>
                                <span className="meta-value">{inst.availabilityZone ?? '—'}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">Public IP</span>
                                <span className="meta-value" style={{ fontFamily: 'monospace' }}>{inst.publicIpAddress ?? '—'}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">Private IP</span>
                                <span className="meta-value" style={{ fontFamily: 'monospace' }}>{inst.privateIpAddress ?? '—'}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">VPC</span>
                                <span className="meta-value" style={{ fontFamily: 'monospace', fontSize: 11 }}>{inst.vpcId ?? '—'}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">Subnet</span>
                                <span className="meta-value" style={{ fontFamily: 'monospace', fontSize: 11 }}>{inst.subnetId ?? '—'}</span>
                            </div>
                            {inst.securityGroups.length > 0 && (
                                <div className="meta-row">
                                    <span className="meta-label">Security groups</span>
                                    <span className="meta-value">
                                        {inst.securityGroups.map((sg) => sg.name ?? sg.id ?? '').join(', ')}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}

                    {tab === 'tags' && (
                        <InlineTagEditor instanceId={instanceId} initialTags={inst.tags} />
                    )}

                    {tab === 'console' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                                Open the console output modal to view system logs.
                            </p>
                            <button
                                className="button"
                                onClick={() => setShowConsoleModal(true)}
                                style={{ alignSelf: 'flex-start' }}
                            >
                                <Terminal size={13} />
                                View console output
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </>
    )
}

// ─── AMI panel ────────────────────────────────────────────────────────────────

function AmiPanel({ imageId }: { imageId: string }) {
    const qc = useQueryClient()
    const [showDeregister, setShowDeregister] = useState(false)

    const deregisterMut = useMutation({
        mutationFn: () => deregisterEc2Ami(imageId),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['ec2', 'amis'] })
            void qc.invalidateQueries({ queryKey: ['ec2', 'instances'] })
            setShowDeregister(false)
        },
    })

    return (
        <>
            {showDeregister && (
                <DeregisterAmiConfirm
                    imageId={imageId}
                    onConfirm={() => deregisterMut.mutate()}
                    onCancel={() => setShowDeregister(false)}
                    isPending={deregisterMut.isPending}
                />
            )}

            <div className="widget">
                <div className="widget-header">
                    <h3>{imageId}</h3>
                    <div style={{ marginLeft: 'auto' }}>
                        <button
                            className="button danger compact"
                            onClick={() => setShowDeregister(true)}
                        >
                            <Trash2 size={12} />
                            Deregister
                        </button>
                    </div>
                </div>
                <div className="widget-body">
                    <div className="meta-grid">
                        <div className="meta-row">
                            <span className="meta-label">Image ID</span>
                            <span className="meta-value" style={{ fontFamily: 'monospace' }}>{imageId}</span>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

// ─── ComputePanel ─────────────────────────────────────────────────────────────

export function ComputePanel({ cloud, resource, runtimeReachable }: ComputePanelProps) {
    if (cloud !== 'aws' || !runtimeReachable || !resource) {
        return null
    }

    if (resource.type === 'instance') {
        return <InstancePanel instanceId={resource.id} />
    }

    if (resource.type === 'image') {
        return <AmiPanel imageId={resource.id} />
    }

    return (
        <div className="empty compact">
            <p>Unsupported resource type: {resource.type}</p>
        </div>
    )
}

// ─── LaunchInstanceForm ────────────────────────────────────────────────────────

type InboundRule = { id: string; protocol: string; portInput: string; cidr: string }

const SG_PRESETS: Array<{ label: string; protocol: string; portInput: string; cidr: string }> = [
    { label: 'SSH',   protocol: 'tcp',  portInput: '22',  cidr: '0.0.0.0/0' },
    { label: 'HTTP',  protocol: 'tcp',  portInput: '80',  cidr: '0.0.0.0/0' },
    { label: 'HTTPS', protocol: 'tcp',  portInput: '443', cidr: '0.0.0.0/0' },
    { label: 'All',   protocol: '-1',   portInput: '',    cidr: '0.0.0.0/0' },
]

function parseRule(rule: InboundRule): IpPermissionInput {
    if (rule.protocol === '-1' || rule.protocol === 'icmp') {
        return { protocol: rule.protocol, fromPort: -1, toPort: -1, cidr: rule.cidr }
    }
    const parts = rule.portInput.split('-').map((s) => parseInt(s.trim(), 10))
    const fromPort = isNaN(parts[0]) ? 0 : parts[0]
    const toPort   = parts.length > 1 && !isNaN(parts[1]) ? parts[1] : fromPort
    return { protocol: rule.protocol, fromPort, toPort, cidr: rule.cidr }
}

const INSTANCE_TYPES = [
    't2.micro', 't2.small', 't2.medium',
    't3.micro', 't3.small', 't3.medium', 't3.large', 't3.xlarge',
    'm5.large', 'm5.xlarge',
    'c5.large', 'c5.xlarge',
]

export function LaunchInstanceForm({
    cloud,
    selectedResource,
    onSuccess,
    onCancel,
}: {
    cloud: CloudProvider
    selectedResource?: CloudResource
    onSuccess: (resource: CloudResource) => void
    onCancel: () => void
}) {
    const qc = useQueryClient()

    // Instance fields
    const [name, setName] = useState('')
    const [imageId, setImageId] = useState(selectedResource?.type === 'image' ? selectedResource.id : '')
    const [instanceType, setInstanceType] = useState('t3.micro')

    // Networking fields
    const [keyName, setKeyName] = useState('')
    const [subnetId, setSubnetId] = useState('')
    const [selectedSgs, setSelectedSgs] = useState<string[]>([])

    // Inline SG creation
    const [showCreateSg, setShowCreateSg] = useState(false)
    const [newSgName, setNewSgName] = useState('')
    const [newSgDesc, setNewSgDesc] = useState('')
    const [newSgVpc, setNewSgVpc] = useState('')
    const [inboundRules, setInboundRules] = useState<InboundRule[]>([])

    function addRule(protocol = 'tcp', portInput = '', cidr = '0.0.0.0/0') {
        setInboundRules((prev) => [...prev, { id: Math.random().toString(36).slice(2), protocol, portInput, cidr }])
    }
    function removeRule(id: string) {
        setInboundRules((prev) => prev.filter((r) => r.id !== id))
    }
    function updateRule(id: string, patch: Partial<Omit<InboundRule, 'id'>>) {
        setInboundRules((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r))
    }

    const amisQ = useQuery({ queryKey: ['ec2', 'amis'],            queryFn: ({ signal }) => listEc2Amis(signal) })
    const keysQ = useQuery({ queryKey: ['ec2', 'key-pairs'],       queryFn: ({ signal }) => listEc2KeyPairs(signal) })
    const vpcsQ = useQuery({ queryKey: ['ec2', 'vpcs'],            queryFn: ({ signal }) => listEc2Vpcs(signal) })
    const subsQ = useQuery({ queryKey: ['ec2', 'subnets'],         queryFn: ({ signal }) => listEc2Subnets(undefined, signal) })
    const sgsQ  = useQuery({ queryKey: ['ec2', 'security-groups'], queryFn: ({ signal }) => listEc2SecurityGroups(undefined, signal) })

    const createMut = useMutation({
        mutationFn: (values: Record<string, unknown>) => createCloudResource(cloud, 'compute', values),
        onSuccess: (created) => {
            void qc.invalidateQueries({ queryKey: ['cloud-resources', cloud, 'compute'] })
            onSuccess(created)
        },
    })

    const createSgMut = useMutation({
        mutationFn: async (vars: {name: string; desc: string; vpc: string; rules: InboundRule[]}) => {
            const { groupId } = await createEc2SecurityGroup(vars.name, vars.desc || vars.name, vars.vpc || undefined)
            for (const rule of vars.rules) {
                await authorizeEc2SecurityGroupIngress(groupId, parseRule(rule))
            }
            return { groupId }
        },
        onSuccess: ({ groupId }, vars) => {
            // Optimistically insert into cache — do NOT invalidate immediately;
            // invalidation races the AWS propagation window and overwrites
            // the entry with a server list that doesn't yet include the new SG.
            qc.setQueryData(['ec2', 'security-groups'], (old: Ec2SecurityGroup[] | undefined) => [
                ...(old ?? []),
                {
                    groupId,
                    groupName: vars.name,
                    description: vars.desc || vars.name,
                    vpcId: vars.vpc || undefined,
                    inboundRules: [],
                    outboundRules: [],
                    tags: [],
                } satisfies Ec2SecurityGroup,
            ])
            setSelectedSgs((prev) => [...prev, groupId])
            setShowCreateSg(false)
            setNewSgName('')
            setNewSgDesc('')
            setNewSgVpc('')
            setInboundRules([])
        },
    })

    function toggleSg(groupId: string, checked: boolean) {
        setSelectedSgs((prev) => checked ? [...prev, groupId] : prev.filter((id) => id !== groupId))
    }

    function submit(e: FormEvent) {
        e.preventDefault()
        createMut.mutate({
            name,
            imageId,
            instanceType,
            keyName:          keyName    || undefined,
            subnetId:         subnetId   || undefined,
            securityGroupIds: selectedSgs.length ? selectedSgs.join(',') : undefined,
        })
    }

    const vpcs        = vpcsQ.data ?? []
    const subnets     = subsQ.data ?? []
    const groupByVpc  = vpcs.length > 2

    function vpcLabel(vpc: Ec2Vpc): string {
        const tag = vpc.tags.find((t: Ec2Tag) => t.key === 'Name')?.value
        return tag ? `${tag} (${vpc.vpcId})` : vpc.vpcId
    }

    return (
        <form className="launch-form" onSubmit={submit}>
            {/* ── Required ──────────────────────────────────────────── */}
            <div className="launch-form-group">Required</div>

            <label className="launch-field launch-field--span">
                <span>Instance Name <em className="field-required">*</em></span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. my-web-server"/>
            </label>

            <label className="launch-field">
                <span>AMI <em className="field-required">*</em></span>
                <select className="input" value={imageId} onChange={(e) => setImageId(e.target.value)} required>
                    <option value="">Select an AMI…</option>
                    {(amisQ.data ?? []).map((ami: Ec2Image) => (
                        <option key={ami.imageId} value={ami.imageId}>{ami.name || ami.imageId}</option>
                    ))}
                </select>
            </label>

            <label className="launch-field">
                <span>Instance Type <em className="field-required">*</em></span>
                <select className="input" value={instanceType} onChange={(e) => setInstanceType(e.target.value)} required>
                    {INSTANCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
            </label>

            {/* ── Networking — optional ─────────────────────────────── */}
            <div className="launch-form-group">Networking — optional</div>

            <label className="launch-field">
                <span>Key Pair</span>
                <select className="input" value={keyName} onChange={(e) => setKeyName(e.target.value)}>
                    <option value="">None</option>
                    {(keysQ.data ?? []).map((kp: Ec2KeyPair) => (
                        <option key={kp.keyPairId} value={kp.keyName}>{kp.keyName}</option>
                    ))}
                </select>
            </label>

            <label className="launch-field">
                <span>Subnet</span>
                <select className="input" value={subnetId} onChange={(e) => setSubnetId(e.target.value)}>
                    <option value="">Default</option>
                    {groupByVpc
                        ? vpcs.map((vpc: Ec2Vpc) => {
                            const vpcSubnets = subnets.filter((s: Ec2Subnet) => s.vpcId === vpc.vpcId)
                            if (!vpcSubnets.length) return null
                            return (
                                <optgroup key={vpc.vpcId} label={vpcLabel(vpc)}>
                                    {vpcSubnets.map((s: Ec2Subnet) => (
                                        <option key={s.subnetId} value={s.subnetId}>
                                            {s.availabilityZone} — {s.cidrBlock}
                                        </option>
                                    ))}
                                </optgroup>
                            )
                        })
                        : subnets.map((s: Ec2Subnet) => (
                            <option key={s.subnetId} value={s.subnetId}>
                                {s.availabilityZone} — {s.cidrBlock}
                            </option>
                        ))
                    }
                </select>
            </label>

            {/* ── Security Groups ───────────────────────────────────── */}
            <div className="launch-field launch-field--span">
                <div className="sg-header">
                    <span>Security Groups</span>
                    <button
                        type="button"
                        className="button small"
                        onClick={() => setShowCreateSg((v) => !v)}
                        title={showCreateSg ? 'Cancel new SG' : 'Create a new security group'}
                    >
                        {showCreateSg ? <X size={12}/> : <Plus size={12}/>}
                        {showCreateSg ? 'Cancel' : 'New SG'}
                    </button>
                </div>

                <div className="sg-checklist">
                    {sgsQ.isLoading && <span className="muted">Loading…</span>}
                    {sgsQ.data?.length === 0 && !showCreateSg && (
                        <span className="muted">No security groups — create one above.</span>
                    )}
                    {(sgsQ.data ?? []).map((sg: Ec2SecurityGroup) => (
                        <label key={sg.groupId} className="sg-check-item">
                            <input
                                type="checkbox"
                                checked={selectedSgs.includes(sg.groupId)}
                                onChange={(e) => toggleSg(sg.groupId, e.target.checked)}
                            />
                            <span>{sg.groupName || sg.groupId}</span>
                            {sg.groupName && <code>{sg.groupId}</code>}
                        </label>
                    ))}
                </div>

                {showCreateSg && (
                    <div className="sg-create-inline">
                        <label className="sg-create-field">
                            <span>Name <em className="field-required">*</em></span>
                            <input className="input" value={newSgName} onChange={(e) => setNewSgName(e.target.value)} placeholder="e.g. web-servers"/>
                        </label>
                        <label className="sg-create-field">
                            <span>Description</span>
                            <input className="input" value={newSgDesc} onChange={(e) => setNewSgDesc(e.target.value)} placeholder="Optional description"/>
                        </label>
                        <label className="sg-create-field">
                            <span>VPC</span>
                            <select className="input" value={newSgVpc} onChange={(e) => setNewSgVpc(e.target.value)}>
                                <option value="">Default VPC</option>
                                {vpcs.map((vpc: Ec2Vpc) => (
                                    <option key={vpc.vpcId} value={vpc.vpcId}>{vpcLabel(vpc)}</option>
                                ))}
                            </select>
                        </label>

                        {/* Inbound Rules */}
                        <div className="sg-rules-section">
                            <div className="sg-rules-header">
                                <span className="sg-rules-label">Inbound Rules</span>
                                <div className="sg-rules-divider"/>
                                <div className="sg-presets">
                                    {SG_PRESETS.map((p) => (
                                        <button key={p.label} type="button" className="button small"
                                            onClick={() => addRule(p.protocol, p.portInput, p.cidr)}>
                                            {p.label}
                                        </button>
                                    ))}
                                    <button type="button" className="button small" onClick={() => addRule()}>
                                        <Plus size={10}/> Custom
                                    </button>
                                </div>
                            </div>

                            {inboundRules.length > 0 && (
                                <div className="sg-rule-list">
                                    <div className="sg-rule-row sg-rule-header-row">
                                        <span>Protocol</span>
                                        <span>Port(s)</span>
                                        <span>Source CIDR</span>
                                        <span/>
                                    </div>
                                    {inboundRules.map((rule) => {
                                        const noPort = rule.protocol === '-1' || rule.protocol === 'icmp'
                                        return (
                                            <div key={rule.id} className="sg-rule-row">
                                                <select className="input" value={rule.protocol}
                                                    onChange={(e) => updateRule(rule.id, { protocol: e.target.value, portInput: '' })}>
                                                    <option value="tcp">TCP</option>
                                                    <option value="udp">UDP</option>
                                                    <option value="icmp">ICMP</option>
                                                    <option value="-1">All</option>
                                                </select>
                                                <input className="input" value={rule.portInput}
                                                    placeholder={noPort ? 'All' : '80 or 80-443'}
                                                    disabled={noPort}
                                                    onChange={(e) => updateRule(rule.id, { portInput: e.target.value })}/>
                                                <input className="input" value={rule.cidr}
                                                    placeholder="0.0.0.0/0"
                                                    onChange={(e) => updateRule(rule.id, { cidr: e.target.value })}/>
                                                <button type="button" className="icon-btn danger" onClick={() => removeRule(rule.id)}>
                                                    <X size={12}/>
                                                </button>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="sg-create-actions">
                            {createSgMut.error instanceof Error && (
                                <span className="sg-create-error">
                                    {createSgMut.error.message.startsWith('char')
                                        ? 'Security group creation failed — runtime returned an unexpected response.'
                                        : createSgMut.error.message}
                                </span>
                            )}
                            <button
                                type="button"
                                className="button primary small"
                                disabled={!newSgName || createSgMut.isPending}
                                onClick={() => createSgMut.mutate({name: newSgName, desc: newSgDesc, vpc: newSgVpc, rules: inboundRules})}
                            >
                                <Plus size={12}/>
                                {createSgMut.isPending ? 'Creating…' : 'Create SG'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {createMut.error instanceof Error && (
                <div className="form-error launch-field--span">{createMut.error.message}</div>
            )}

            <div className="launch-form-actions">
                <button type="button" className="button" onClick={onCancel}>Cancel</button>
                <button type="submit" className="button primary" disabled={createMut.isPending}>
                    <Plus size={14}/>
                    {createMut.isPending ? 'Launching…' : 'Launch instance'}
                </button>
            </div>
        </form>
    )
}
