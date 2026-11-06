import { type FormEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {Icon, AlertTriangle, HardDrive, Loader2, Play, PlusSquared as Plus, Power, RefreshCwSquared as RefreshCw, RotateCcw, Terminal, Trash2, XSquared as X} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import {OptionSelect} from '@/components/OptionSelect'
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
import { TagEditor } from '@/features/ec2/TagEditor'
import { ModalOverlay } from './ModalOverlay'
import {Checkbox} from '@/components/sodium/ui/checkbox'
import {Switch} from '@/components/sodium/ui/switch'
import {EmptyState} from '@/components/EmptyState'
import {RowsSkeleton} from '@/components/PageSkeleton'
import {Hint} from '@/components/Hint'

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
        <ModalOverlay onClose={onClose}>
            <div className="create-table-modal max-w-105">
                <h2>Create AMI</h2>

                <div className="modal-section">
                    <p className="modal-section-title">Image name</p>
                    <Input aria-label="Image name"
                        className="w-full min-w-0"
                        autoFocus
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>

                <div className="modal-section">
                    <p className="modal-section-title">Description, optional</p>
                    <Input aria-label="Description"
                        className="w-full min-w-0"
                        placeholder="e.g. production snapshot"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />
                </div>

                <div className="modal-section">
                    <div className="field-row items-center">
                        <Switch checked={noReboot} onCheckedChange={setNoReboot} aria-label="No reboot"/>
                        <p className="modal-section-title m-0">No reboot, skip instance restart before imaging</p>
                    </div>
                </div>

                {err && <p className="type-caption text-fail-text mt-0 mx-0 mb-2">{err}</p>}

                <div className="modal-footer">
                    <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={!name.trim() || mutation.isPending}
                    >
                        {mutation.isPending ? <Icon icon={Loader2} size={14} /> : <Icon icon={HardDrive} size={14} />}
                        Create AMI
                    </Button>
                </div>
            </div>
        </ModalOverlay>
    )
}

// ─── Console output modal (inline) ───────────────────────────────────────────

function ConsoleOutputModal({ instanceId, onClose }: { instanceId: string; onClose: () => void }) {
    const query = useQuery({
        queryKey: ['ec2', 'console', instanceId],
        queryFn: ({ signal }) => getEc2ConsoleOutput(instanceId, signal),
    })

    return (
        <ModalOverlay onClose={onClose}>
            <div className="create-table-modal max-w-180 flex flex-col max-h-[85vh]">
                <h2 className="flex items-center gap-1.5">
                    <Icon icon={Terminal} size={14} />
                    Console output, {instanceId}
                </h2>

                {query.isLoading && (
                    <p className="type-caption text-text-2">Loading…</p>
                )}

                {query.isError && (
                    <p className="type-caption text-fail-text">
                        {query.error instanceof Error ? query.error.message : 'Failed to fetch console output.'}
                    </p>
                )}

                {query.data && (
                    <>
                        {query.data.timestamp && (
                            <p className="type-caption text-text-2 mt-0 mx-0 mb-2">
                                As of {new Date(query.data.timestamp).toLocaleString()}
                            </p>
                        )}
                        <pre
                            className="mono flex-1 overflow-y-auto p-3 type-caption m-0 whitespace-pre-wrap break-all bg-panel"
                        >
                            {query.data.output || '(no output yet)'}
                        </pre>
                    </>
                )}

                <div className="modal-footer mt-3">
                    <Button variant="secondary" onClick={onClose}>Close</Button>
                </div>
            </div>
        </ModalOverlay>
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
        <ModalOverlay onClose={onCancel}>
            <div className="create-table-modal w-95" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header flex items-center gap-2">
                    <Icon icon={AlertTriangle} className="text-fail-text shrink-0" size={14} />
                    <span>Deregister AMI</span>
                    <Hint label="Close"><Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onCancel} aria-label="Close">
                        <Icon icon={X} size={14} />
                    </Button></Hint>
                </div>
                <div className="modal-section">
                    <div className="py-2 px-3 mb-3 bg-well border border-line">
                        <div className="type-code">{imageId}</div>
                    </div>
                    <p className="type-caption text-text-3">
                        This will deregister the AMI. Associated snapshots are not deleted automatically.
                    </p>
                </div>
                <div className="modal-footer">
                    <Button variant="secondary" onClick={onCancel} disabled={isPending}>Cancel</Button>
                    <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
                        {isPending ? <Icon icon={Loader2} size={14} /> : <Icon icon={Trash2} size={14} />}
                        Deregister
                    </Button>
                </div>
            </div>
        </ModalOverlay>
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
            <RowsSkeleton rows={4} label="Loading instance"/>
        )
    }

    if (query.isError || !query.data) {
        return (
            <EmptyState compact reason="error" title="Failed to load instance" description={query.error instanceof Error ? query.error.message : undefined}/>
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
                    <h2>{inst.name || instanceId}</h2>
                    <span className={`status ${stateClass(state)}`}>{state}</span>
                    <div className="ml-auto flex gap-1.5">
                        <Hint label="Start"><Button variant="secondary" size="sm"
                            disabled={!canStart || startMut.isPending}
                            onClick={() => startMut.mutate()}
                        >
                            <Icon icon={Play} size={14} />
                            Start
                        </Button></Hint>
                        <Hint label="Stop"><Button variant="secondary" size="sm"
                            disabled={!canStop || stopMut.isPending}
                            onClick={() => stopMut.mutate()}
                        >
                            <Icon icon={Power} size={14} />
                            Stop
                        </Button></Hint>
                        <Hint label="Reboot"><Button variant="secondary" size="sm"
                            disabled={!canReboot || rebootMut.isPending}
                            onClick={() => rebootMut.mutate()}
                        >
                            <Icon icon={RotateCcw} size={14} />
                            Reboot
                        </Button></Hint>
                        <Hint label="Create AMI"><Button variant="secondary" size="sm"
                            onClick={() => setShowAmiModal(true)}
                        >
                            <Icon icon={HardDrive} size={14} />
                            Create AMI
                        </Button></Hint>
                        {canTerminate && terminateStep === 'idle' && (
                            <Hint label="Terminate"><Button variant="destructive" size="sm"
                                onClick={() => setTerminateStep('confirm')}
                            >
                                <Icon icon={Trash2} size={14} />
                                Terminate
                            </Button></Hint>
                        )}
                        {canTerminate && terminateStep === 'confirm' && (
                            <>
                                <Button variant="destructive" size="sm"
                                    disabled={terminateMut.isPending}
                                    onClick={() => terminateMut.mutate()}
                                >
                                    {terminateMut.isPending ? <Icon icon={Loader2} size={14} /> : null}
                                    Confirm terminate
                                </Button>
                                <Button variant="secondary" size="sm"
                                    onClick={() => setTerminateStep('idle')}
                                >
                                    Cancel
                                </Button>
                            </>
                        )}
                        <Button variant="secondary" size="sm"
                            disabled={query.isFetching}
                            onClick={() => query.refetch()}
                        >
                            <Icon icon={RefreshCw} size={14} />
                        </Button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="sns-tabs">
                    <Button variant={tab === 'details' ? 'secondary' : 'ghost'}
                        onClick={() => setTab('details')}
                    >
                        Details
                    </Button>
                    <Button variant={tab === 'tags' ? 'secondary' : 'ghost'}
                        onClick={() => setTab('tags')}
                    >
                        Tags
                    </Button>
                    <Button variant={tab === 'console' ? 'secondary' : 'ghost'}
                        onClick={() => { setTab('console'); setShowConsoleModal(true) }}
                    >
                        Console
                    </Button>
                </div>

                <div className="widget-body">
                    {tab === 'details' && (
                        <div className="meta-grid">
                            <div className="meta-row">
                                <span className="meta-label">Instance ID</span>
                                <span className="meta-value type-code">{inst.instanceId}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">Type</span>
                                <span className="meta-value">{inst.instanceType ?? ', '}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">AMI</span>
                                <span className="meta-value type-code-sm">{inst.imageId ?? ', '}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">Key pair</span>
                                <span className="meta-value">{inst.keyName ?? ', '}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">Architecture</span>
                                <span className="meta-value">{inst.architecture ?? ', '}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">Platform</span>
                                <span className="meta-value">{inst.platform ?? 'Linux'}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">Launch time</span>
                                <span className="meta-value text-text-3">{inst.launchTime ?? ', '}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">Availability zone</span>
                                <span className="meta-value">{inst.availabilityZone ?? ', '}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">Public IP</span>
                                <span className="meta-value type-code">{inst.publicIpAddress ?? ', '}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">Private IP</span>
                                <span className="meta-value type-code">{inst.privateIpAddress ?? ', '}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">VPC</span>
                                <span className="meta-value type-code-sm">{inst.vpcId ?? ', '}</span>
                            </div>
                            <div className="meta-row">
                                <span className="meta-label">Subnet</span>
                                <span className="meta-value type-code-sm">{inst.subnetId ?? ', '}</span>
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
                        <TagEditor key={instanceId} instanceId={instanceId} initialTags={inst.tags} />
                    )}

                    {tab === 'console' && (
                        <div className="flex flex-col gap-2">
                            <p className="type-caption text-text-3 m-0">
                                Open the console output modal to view system logs.
                            </p>
                            <Button variant="secondary"
                                className="self-start"
                                onClick={() => setShowConsoleModal(true)}
                            >
                                <Icon icon={Terminal} size={14} />
                                View console output
                            </Button>
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
                    <h2>{imageId}</h2>
                    <div className="ml-auto">
                        <Button variant="destructive" size="sm"
                            onClick={() => setShowDeregister(true)}
                        >
                            <Icon icon={Trash2} size={14} />
                            Deregister
                        </Button>
                    </div>
                </div>
                <div className="widget-body">
                    <div className="meta-grid">
                        <div className="meta-row">
                            <span className="meta-label">Image ID</span>
                            <span className="meta-value type-code">{imageId}</span>
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
                <Input aria-label="Instance name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. my-web-server"/>
            </label>

            <label className="launch-field">
                <span>AMI <em className="field-required">*</em></span>
                <OptionSelect value={imageId} onValueChange={(value) => setImageId(value)} required>
                    <option value="">Select an AMI…</option>
                    {(amisQ.data ?? []).map((ami: Ec2Image) => (
                        <option key={ami.imageId} value={ami.imageId}>{ami.name || ami.imageId}</option>
                    ))}
                </OptionSelect>
            </label>

            <label className="launch-field">
                <span>Instance Type <em className="field-required">*</em></span>
                <OptionSelect value={instanceType} onValueChange={(value) => setInstanceType(value)} required>
                    {INSTANCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </OptionSelect>
            </label>

            {/* ── Networking — optional ─────────────────────────────── */}
            <div className="launch-form-group">Networking, optional</div>

            <label className="launch-field">
                <span>Key Pair</span>
                <OptionSelect value={keyName} onValueChange={(value) => setKeyName(value)}>
                    <option value="">None</option>
                    {(keysQ.data ?? []).map((kp: Ec2KeyPair) => (
                        <option key={kp.keyPairId} value={kp.keyName}>{kp.keyName}</option>
                    ))}
                </OptionSelect>
            </label>

            <label className="launch-field">
                <span>Subnet</span>
                <OptionSelect value={subnetId} onValueChange={(value) => setSubnetId(value)}>
                    <option value="">Default</option>
                    {groupByVpc
                        ? vpcs.map((vpc: Ec2Vpc) => {
                            const vpcSubnets = subnets.filter((s: Ec2Subnet) => s.vpcId === vpc.vpcId)
                            if (!vpcSubnets.length) return null
                            return (
                                <optgroup key={vpc.vpcId} label={vpcLabel(vpc)}>
                                    {vpcSubnets.map((s: Ec2Subnet) => (
                                        <option key={s.subnetId} value={s.subnetId}>
                                            {s.availabilityZone} , {s.cidrBlock}
                                        </option>
                                    ))}
                                </optgroup>
                            )
                        })
                        : subnets.map((s: Ec2Subnet) => (
                            <option key={s.subnetId} value={s.subnetId}>
                                {s.availabilityZone} , {s.cidrBlock}
                            </option>
                        ))
                    }
                </OptionSelect>
            </label>

            {/* ── Security Groups ───────────────────────────────────── */}
            <div className="launch-field launch-field--span">
                <div className="sg-header">
                    <span>Security Groups</span>
                    <Hint label={showCreateSg ? 'Cancel new SG' : 'Create a new security group'}><Button variant="secondary" size="sm"
                        type="button"
                        onClick={() => setShowCreateSg((v) => !v)}
                    >
                        {showCreateSg ? <Icon icon={X} size={14}/> : <Icon icon={Plus} size={14}/>}
                        {showCreateSg ? 'Cancel' : 'New SG'}
                    </Button></Hint>
                </div>

                <div className="sg-checklist">
                    {sgsQ.isLoading && <span className="muted">Loading…</span>}
                    {sgsQ.data?.length === 0 && !showCreateSg && (
                        <span className="muted">No security groups, create one above.</span>
                    )}
                    {(sgsQ.data ?? []).map((sg: Ec2SecurityGroup) => (
                        <label key={sg.groupId} className="sg-check-item">
                            <Checkbox
                                checked={selectedSgs.includes(sg.groupId)}
                                onCheckedChange={(checked) => toggleSg(sg.groupId, checked)}
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
                            <Input aria-label="Security group name" value={newSgName} onChange={(e) => setNewSgName(e.target.value)} placeholder="e.g. web-servers"/>
                        </label>
                        <label className="sg-create-field">
                            <span>Description</span>
                            <Input aria-label="Description" value={newSgDesc} onChange={(e) => setNewSgDesc(e.target.value)} placeholder="Optional description"/>
                        </label>
                        <label className="sg-create-field">
                            <span>VPC</span>
                            <OptionSelect value={newSgVpc} onValueChange={(value) => setNewSgVpc(value)}>
                                <option value="">Default VPC</option>
                                {vpcs.map((vpc: Ec2Vpc) => (
                                    <option key={vpc.vpcId} value={vpc.vpcId}>{vpcLabel(vpc)}</option>
                                ))}
                            </OptionSelect>
                        </label>

                        {/* Inbound Rules */}
                        <div className="sg-rules-section">
                            <div className="sg-rules-header">
                                <span className="sg-rules-label">Inbound Rules</span>
                                <div className="sg-rules-divider"/>
                                <div className="sg-presets">
                                    {SG_PRESETS.map((p) => (
                                        <Button variant="secondary" size="sm" key={p.label} type="button"
                                            onClick={() => addRule(p.protocol, p.portInput, p.cidr)}>
                                            {p.label}
                                        </Button>
                                    ))}
                                    <Button variant="secondary" size="sm" type="button" onClick={() => addRule()}>
                                        <Icon icon={Plus} size={14}/> Custom
                                    </Button>
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
                                                <OptionSelect aria-label="Protocol" value={rule.protocol}
                                                    onValueChange={(value) => updateRule(rule.id, { protocol: value, portInput: '' })}>
                                                    <option value="tcp">TCP</option>
                                                    <option value="udp">UDP</option>
                                                    <option value="icmp">ICMP</option>
                                                    <option value="-1">All</option>
                                                </OptionSelect>
                                                <Input aria-label="Port range" value={rule.portInput}
                                                    placeholder={noPort ? 'All' : '80 or 80-443'}
                                                    disabled={noPort}
                                                    onChange={(e) => updateRule(rule.id, { portInput: e.target.value })}/>
                                                <Input aria-label="Source CIDR" value={rule.cidr}
                                                    placeholder="0.0.0.0/0"
                                                    onChange={(e) => updateRule(rule.id, { cidr: e.target.value })}/>
                                                <Hint label="Remove rule"><Button variant="ghost" size="icon-sm" type="button" aria-label="Remove rule" onClick={() => removeRule(rule.id)}>
                                                    <Icon icon={X} size={14}/>
                                                </Button></Hint>
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
                                        ? 'Security group creation failed, runtime returned an unexpected response.'
                                        : createSgMut.error.message}
                                </span>
                            )}
                            <Button size="sm"
                                type="button"
                                disabled={!newSgName || createSgMut.isPending}
                                onClick={() => createSgMut.mutate({name: newSgName, desc: newSgDesc, vpc: newSgVpc, rules: inboundRules})}
                            >
                                <Icon icon={Plus} size={14}/>
                                {createSgMut.isPending ? 'Creating…' : 'Create SG'}
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {createMut.error instanceof Error && (
                <div className="form-error launch-field--span">{createMut.error.message}</div>
            )}

            <div className="launch-form-actions">
                <Button variant="secondary" type="button" onClick={onCancel}>Cancel</Button>
                <Button type="submit" disabled={createMut.isPending}>
                    <Icon icon={Plus} size={14}/>
                    {createMut.isPending ? 'Launching…' : 'Launch instance'}
                </Button>
            </div>
        </form>
    )
}
