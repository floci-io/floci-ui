import {useEffect, useMemo, useState} from 'react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {Icon, type SodiumIcon, AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Globe, Key, Loader2, Network, PlusSquared as Plus, Router, ServerSquared as Server, Shield, Trash2, XSquared as X} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import {OptionSelect} from '@/components/OptionSelect'
import {
    allocateEc2ElasticIp,
    associateEc2ElasticIp,
    attachEc2InternetGateway,
    authorizeEc2SecurityGroupEgress,
    authorizeEc2SecurityGroupIngress,
    createEc2InternetGateway,
    createEc2KeyPair,
    createEc2Route,
    createEc2RouteTable,
    createEc2SecurityGroup,
    createEc2Subnet,
    createEc2Vpc,
    createVpcWizard,
    deleteEc2InternetGateway,
    deleteEc2KeyPair,
    deleteEc2Route,
    deleteEc2RouteTable,
    deleteEc2SecurityGroup,
    deleteEc2Subnet,
    deleteEc2Vpc,
    detachEc2InternetGateway,
    disassociateEc2ElasticIp,
    getEc2VpcAttributes,
    listEc2ElasticIps,
    listEc2Instances,
    listEc2InternetGateways,
    listEc2KeyPairs,
    listEc2RouteTables,
    listEc2SecurityGroups,
    listEc2Subnets,
    listEc2Vpcs,
    modifyEc2SubnetAttribute,
    modifyEc2VpcAttribute,
    releaseEc2ElasticIp,
    revokeEc2SecurityGroupEgress,
    revokeEc2SecurityGroupIngress,
    type CreateRouteInput,
    type Ec2ElasticIp,
    type Ec2InternetGateway,
    type Ec2IpPermission,
    type Ec2KeyPair,
    type Ec2KeyPairMaterial,
    type Ec2RouteTable,
    type Ec2SecurityGroup,
    type Ec2Subnet,
    type Ec2Vpc,
    type SubnetGroup,
    type VpcWizardInput,
    type VpcWizardResult,
} from '@/api/aws/ec2.api'
import type {CloudProvider} from '@/types/cloud'
import type {CloudResource} from '@/types/resource'
import {calculateSubnetCidrs, isSubnetLayoutWithinBlock, isValidCidr, isValidPort} from '@/lib/network'
import {ModalOverlay} from './ModalOverlay'
import {Switch} from '@/components/sodium/ui/switch'
import {Hint} from '@/components/Hint'

// ─── Props ────────────────────────────────────────────────────────────────────

interface NetworkingPanelProps {
    cloud: CloudProvider
    runtimeReachable?: boolean
    /** CloudResource selected in the generic resource table (type === 'vpc' → preselects that VPC) */
    resource?: CloudResource
}

// ─── Selection state ──────────────────────────────────────────────────────────

type Section = 'sg' | 'kp' | 'vpc' | 'subnet' | 'igw' | 'rtb' | 'eip'
type Selection = {section: Section; id: string} | null

// ─── Editable rule row ────────────────────────────────────────────────────────

type EditRule = {
    rid: string
    protocol: string
    fromPort: string
    toPort: string
    cidr: string
}

// ─── Rule presets ─────────────────────────────────────────────────────────────

type RulePreset = {key: string; label: string; protocol: string; fromPort: string; toPort: string}

const RULE_PRESETS: RulePreset[] = [
    {key: 'ssh',        label: 'SSH',          protocol: 'tcp',  fromPort: '22',   toPort: '22'},
    {key: 'http',       label: 'HTTP',         protocol: 'tcp',  fromPort: '80',   toPort: '80'},
    {key: 'https',      label: 'HTTPS',        protocol: 'tcp',  fromPort: '443',  toPort: '443'},
    {key: 'rdp',        label: 'RDP',          protocol: 'tcp',  fromPort: '3389', toPort: '3389'},
    {key: 'mysql',      label: 'MySQL',        protocol: 'tcp',  fromPort: '3306', toPort: '3306'},
    {key: 'postgres',   label: 'PostgreSQL',   protocol: 'tcp',  fromPort: '5432', toPort: '5432'},
    {key: 'redis',      label: 'Redis',        protocol: 'tcp',  fromPort: '6379', toPort: '6379'},
    {key: 'all-tcp',    label: 'All TCP',      protocol: 'tcp',  fromPort: '0',    toPort: '65535'},
    {key: 'all-udp',    label: 'All UDP',      protocol: 'udp',  fromPort: '0',    toPort: '65535'},
    {key: 'all-icmp',   label: 'All ICMP',     protocol: 'icmp', fromPort: '-1',   toPort: '-1'},
    {key: 'all',        label: 'All traffic',  protocol: '-1',   fromPort: '0',    toPort: '0'},
    {key: 'custom-tcp', label: 'Custom TCP',   protocol: 'tcp',  fromPort: '',     toPort: ''},
    {key: 'custom-udp', label: 'Custom UDP',   protocol: 'udp',  fromPort: '',     toPort: ''},
]

function presetFor(proto: string, from: string, to: string): string {
    if (proto === '-1') return 'all'
    if (proto === 'icmp') return 'all-icmp'
    const match = RULE_PRESETS.find((p) => p.protocol === proto && p.fromPort === from && p.toPort === to && p.key !== 'custom-tcp' && p.key !== 'custom-udp')
    if (match) return match.key
    if (proto === 'tcp') return 'custom-tcp'
    if (proto === 'udp') return 'custom-udp'
    return 'custom-tcp'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function protocolLabel(p: string): string {
    if (p === '-1') return 'All'
    if (p === 'icmp') return 'ICMP'
    return p.toUpperCase()
}

function portDisplay(from: number | null, to: number | null, protocol: string): string {
    if (protocol === '-1') return 'All'
    if (protocol === 'icmp') return 'N/A'
    if (from === null) return ', '
    if (from === to) return String(from)
    return `${from}–${to}`
}

function nameTag(tags: Array<{key: string; value: string}>): string {
    return tags.find((t) => t.key === 'Name')?.value ?? ''
}

function permissionsToRules(perms: Ec2IpPermission[]): EditRule[] {
    const rules: EditRule[] = []
    for (const perm of perms) {
        for (const cidr of perm.ipRanges) {
            rules.push({
                rid: crypto.randomUUID(),
                protocol: perm.protocol,
                fromPort: perm.fromPort !== null ? String(perm.fromPort) : (perm.protocol === 'icmp' ? '-1' : '0'),
                toPort: perm.toPort !== null ? String(perm.toPort) : (perm.protocol === 'icmp' ? '-1' : '0'),
                cidr,
            })
        }
    }
    return rules
}

function ruleToPermission(r: EditRule) {
    return {
        protocol: r.protocol,
        fromPort: r.protocol === '-1' ? 0 : (parseInt(r.fromPort) || 0),
        toPort:   r.protocol === '-1' ? 0 : (parseInt(r.toPort)   || 0),
        cidr: r.cidr,
    }
}

function ruleKey(r: EditRule): string {
    return `${r.protocol}|${r.fromPort}|${r.toPort}|${r.cidr}`
}

function isValidKeyPairName(name: string): boolean {
    return /^[\w\-.@]{1,255}$/.test(name)
}

// ─── Shared confirm delete modal ──────────────────────────────────────────────

function ConfirmDeleteModal({title, detail, onConfirm, onClose, isPending}: {
    title: string
    detail: string
    onConfirm: () => void
    onClose: () => void
    isPending: boolean
}) {
    return (
        <ModalOverlay onClose={onClose}>
            <div className="create-table-modal w-95" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header flex items-center gap-2">
                    <Icon icon={AlertTriangle} className="text-fail-text shrink-0" size={14}/>
                    <span>{title}</span>
                    <Hint label="Close"><Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onClose} aria-label="Close">
                        <Icon icon={X} size={14} aria-hidden="true"/>
                    </Button></Hint>
                </div>
                <div className="modal-section">
                    <p className="type-caption text-text-3 m-0">{detail}</p>
                </div>
                <div className="modal-footer">
                    <Button variant="secondary" onClick={onClose} disabled={isPending}>Cancel</Button>
                    <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
                        {isPending ? <Icon icon={Loader2} size={14}/> : <Icon icon={Trash2} size={14}/>}
                        Delete
                    </Button>
                </div>
            </div>
        </ModalOverlay>
    )
}

// ─── Editable rule table (used in EditSgRulesModal) ───────────────────────────

function EditRuleTable({rules, onChange}: {rules: EditRule[]; onChange: (rules: EditRule[]) => void}) {
    function addRule() {
        onChange([...rules, {rid: crypto.randomUUID(), protocol: 'tcp', fromPort: '', toPort: '', cidr: '0.0.0.0/0'}])
    }
    function removeRule(rid: string) {
        onChange(rules.filter((r) => r.rid !== rid))
    }
    function update(rid: string, patch: Partial<EditRule>) {
        onChange(rules.map((r) => r.rid === rid ? {...r, ...patch} : r))
    }
    function handlePreset(rid: string, key: string) {
        const p = RULE_PRESETS.find((x) => x.key === key)
        if (!p) return
        update(rid, {protocol: p.protocol, fromPort: p.fromPort, toPort: p.toPort})
    }

    const isCustom = (r: EditRule) => r.protocol !== '-1' && r.protocol !== 'icmp' && (
        !RULE_PRESETS.find((p) => p.key !== 'custom-tcp' && p.key !== 'custom-udp' && p.protocol === r.protocol && p.fromPort === r.fromPort && p.toPort === r.toPort)
    )

    return (
        <div>
            {rules.length === 0 ? (
                <div className="py-2.5 px-3 type-caption text-text-2 mb-2 border border-line">
                    No rules. Click Add rule to add one.
                </div>
            ) : (
                <div className="mb-2 border border-line">
                    <table className="w-full border-collapse type-caption">
                        <thead>
                            <tr className="border-b border-line">
                                <th style={thS}>Type</th>
                                <th style={thS}>Proto</th>
                                <th style={thS}>Ports</th>
                                <th style={thS}>CIDR</th>
                                <th className="w-7" style={{...thS}}/>
                            </tr>
                        </thead>
                        <tbody>
                            {rules.map((r, idx) => {
                                const pKey = presetFor(r.protocol, r.fromPort, r.toPort)
                                const cidrErr = r.cidr && !isValidCidr(r.cidr)
                                const fromErr = isCustom(r) && r.fromPort !== '' && !isValidPort(r.fromPort)
                                const toErr   = isCustom(r) && r.toPort   !== '' && !isValidPort(r.toPort)
                                return (
                                    <tr key={r.rid} className={idx < rules.length - 1 ? 'border-b border-line-faint' : undefined}>
                                        <td style={tdS}>
                                            <OptionSelect aria-label="Rule type" className="w-32.5"
                                                value={pKey}
                                                onValueChange={(value) => handlePreset(r.rid, value)}
                                            >
                                                {RULE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                                            </OptionSelect>
                                        </td>
                                        <td className="text-text-2" style={{...tdS}}>
                                            {protocolLabel(r.protocol)}
                                        </td>
                                        <td style={tdS}>
                                            {r.protocol === '-1' || r.protocol === 'icmp' ? (
                                                <span className="text-text-2">, </span>
                                            ) : isCustom(r) ? (
                                                <div className="flex items-center gap-1">
                                                    <Input aria-label="From port"
                                                        className="w-12 min-w-0"
                                                        aria-invalid={(fromErr) ? true : undefined}
                                                        placeholder="From"
                                                        value={r.fromPort}
                                                        onChange={(e) => update(r.rid, {fromPort: e.target.value})}
                                                    />
                                                    <span className="text-text-2">–</span>
                                                    <Input aria-label="To port"
                                                        className="w-12 min-w-0"
                                                        aria-invalid={(toErr) ? true : undefined}
                                                        placeholder="To"
                                                        value={r.toPort}
                                                        onChange={(e) => update(r.rid, {toPort: e.target.value})}
                                                    />
                                                </div>
                                            ) : (
                                                <span className="text-text-2">
                                                    {r.fromPort === r.toPort ? r.fromPort : `${r.fromPort}–${r.toPort}`}
                                                </span>
                                            )}
                                        </td>
                                        <td style={tdS}>
                                            <Input aria-label="Source CIDR"
                                                className="w-35 min-w-0"
                                                aria-invalid={(cidrErr) ? true : undefined}
                                                placeholder="0.0.0.0/0"
                                                value={r.cidr}
                                                onChange={(e) => update(r.rid, {cidr: e.target.value})}
                                            />
                                        </td>
                                        <td className="text-center" style={{...tdS}}>
                                            <Hint label="Remove rule"><Button variant="ghost" size="icon-sm" type="button" aria-label="Remove rule" onClick={() => removeRule(r.rid)}>
                                                <Icon icon={Trash2} size={14}/>
                                            </Button></Hint>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            <Button variant="secondary" type="button" onClick={addRule}>
                + Add rule
            </Button>
        </div>
    )
}

const thS: React.CSSProperties = {padding: '7px 8px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-2)', background: 'var(--surface-2)', whiteSpace: 'nowrap'}
const tdS: React.CSSProperties = {padding: '5px 8px', verticalAlign: 'middle'}

// ─── Create SG modal ──────────────────────────────────────────────────────────

function CreateSgModal({vpcs, onClose}: {vpcs: Ec2Vpc[]; onClose: () => void}) {
    const qc = useQueryClient()
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [vpcId, setVpcId] = useState(vpcs[0]?.vpcId ?? '')
    const [err, setErr] = useState('')

    const mut = useMutation({
        mutationFn: () => createEc2SecurityGroup(name.trim(), description.trim(), vpcId || undefined),
        onSuccess: () => {
            void qc.invalidateQueries({queryKey: ['ec2', 'security-groups']})
            onClose()
        },
        onError: (e) => setErr(e instanceof Error ? e.message : 'Create failed'),
    })

    return (
        <ModalOverlay onClose={onClose}>
            <div className="create-table-modal max-w-100">
                <h2>Create Security Group</h2>
                <div className="modal-section">
                    <p className="modal-section-title">Name</p>
                    <Input aria-label="Name" className="w-full min-w-0" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && mut.mutate()}/>
                </div>
                <div className="modal-section">
                    <p className="modal-section-title">Description</p>
                    <Input aria-label="Description" className="w-full min-w-0" value={description} onChange={(e) => setDescription(e.target.value)}/>
                </div>
                {vpcs.length > 0 && (
                    <div className="modal-section">
                        <p className="modal-section-title">VPC, optional</p>
                        <OptionSelect aria-label="VPC" className="w-full min-w-0" value={vpcId} onValueChange={(value) => setVpcId(value)}>
                            <option value="">Default VPC</option>
                            {vpcs.map((v) => <option key={v.vpcId} value={v.vpcId}>{nameTag(v.tags) || v.vpcId} ({v.cidrBlock})</option>)}
                        </OptionSelect>
                    </div>
                )}
                {err && <p className="type-caption text-fail-text mt-0 mx-0 mb-2">{err}</p>}
                <div className="modal-footer">
                    <Button variant="secondary" onClick={onClose} disabled={mut.isPending}>Cancel</Button>
                    <Button disabled={!name.trim() || !description.trim() || mut.isPending} onClick={() => mut.mutate()}>
                        {mut.isPending ? <Icon icon={Loader2} size={14}/> : <Icon icon={Shield} size={14}/>}
                        Create
                    </Button>
                </div>
            </div>
        </ModalOverlay>
    )
}

// ─── Edit SG rules modal ──────────────────────────────────────────────────────

function EditSgRulesModal({sg, onClose}: {sg: Ec2SecurityGroup; onClose: () => void}) {
    const qc = useQueryClient()
    const [inbound, setInbound] = useState<EditRule[]>(() => permissionsToRules(sg.inboundRules))
    const [outbound, setOutbound] = useState<EditRule[]>(() => permissionsToRules(sg.outboundRules))
    const [err, setErr] = useState('')

    const mut = useMutation({
        mutationFn: async () => {
            const origInKeys = new Set(permissionsToRules(sg.inboundRules).map(ruleKey))
            const newInKeys  = new Set(inbound.map(ruleKey))
            const toAddIn    = inbound.filter((r) => !origInKeys.has(ruleKey(r)))
            const toRevokeIn = permissionsToRules(sg.inboundRules).filter((r) => !newInKeys.has(ruleKey(r)))

            const origOutKeys = new Set(permissionsToRules(sg.outboundRules).map(ruleKey))
            const newOutKeys  = new Set(outbound.map(ruleKey))
            const toAddOut    = outbound.filter((r) => !origOutKeys.has(ruleKey(r)))
            const toRevokeOut = permissionsToRules(sg.outboundRules).filter((r) => !newOutKeys.has(ruleKey(r)))

            await Promise.all([
                ...toAddIn.map((r) => authorizeEc2SecurityGroupIngress(sg.groupId, ruleToPermission(r))),
                ...toRevokeIn.map((r) => revokeEc2SecurityGroupIngress(sg.groupId, ruleToPermission(r))),
                ...toAddOut.map((r) => authorizeEc2SecurityGroupEgress(sg.groupId, ruleToPermission(r))),
                ...toRevokeOut.map((r) => revokeEc2SecurityGroupEgress(sg.groupId, ruleToPermission(r))),
            ])
        },
        onSuccess: () => {
            void qc.invalidateQueries({queryKey: ['ec2', 'security-groups']})
            onClose()
        },
        onError: (e) => setErr(e instanceof Error ? e.message : 'Save failed'),
    })

    return (
        <ModalOverlay onClose={onClose}>
            <div className="create-table-modal max-w-170">
                <div className="modal-header flex items-center gap-2">
                    <Icon icon={Shield} className="text-accent-text" size={14}/>
                    <span>Edit rules, {sg.groupName}</span>
                    <Hint label="Close"><Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onClose} aria-label="Close"><Icon icon={X} size={14} aria-hidden="true"/></Button></Hint>
                </div>
                <div className="modal-section">
                    <p className="modal-section-title mb-2">Inbound rules</p>
                    <EditRuleTable rules={inbound} onChange={setInbound}/>
                </div>
                <div className="modal-section">
                    <p className="modal-section-title mb-2">Outbound rules</p>
                    <EditRuleTable rules={outbound} onChange={setOutbound}/>
                </div>
                {err && <p className="type-caption text-fail-text mt-0 mx-0 mb-2">{err}</p>}
                <div className="modal-footer">
                    <Button variant="secondary" onClick={onClose} disabled={mut.isPending}>Cancel</Button>
                    <Button disabled={mut.isPending} onClick={() => mut.mutate()}>
                        {mut.isPending ? <Icon icon={Loader2} size={14}/> : null}
                        Save rules
                    </Button>
                </div>
            </div>
        </ModalOverlay>
    )
}

// ─── Create key pair modal + PEM display ──────────────────────────────────────

function PemDisplay({material, onClose}: {material: Ec2KeyPairMaterial; onClose: () => void}) {
    return (
        <ModalOverlay onClose={onClose}>
            <div className="create-table-modal max-w-150" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header flex items-center gap-2">
                    <Icon icon={Key} className="text-ok-text" size={14}/>
                    <span>Save your private key, {material.keyName}</span>
                    <Hint label="Close"><Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onClose} aria-label="Close"><Icon icon={X} size={14} aria-hidden="true"/></Button></Hint>
                </div>
                <div className="modal-section">
                    <p className="type-caption text-fail-text mb-2">
                        This is the only time the private key material is available. Copy and save it now.
                    </p>
                    <pre className="p-3 type-caption whitespace-pre-wrap break-all max-h-75 overflow-y-auto m-0 bg-panel">
                        {material.keyMaterial}
                    </pre>
                </div>
                <div className="modal-footer">
                    <Button onClick={() => {
                        navigator.clipboard.writeText(material.keyMaterial).catch(() => undefined)
                    }}>
                        Copy PEM
                    </Button>
                    <Button variant="secondary" onClick={onClose}>Close</Button>
                </div>
            </div>
        </ModalOverlay>
    )
}

function CreateKpModal({onClose, onCreated}: {onClose: () => void; onCreated: (mat: Ec2KeyPairMaterial) => void}) {
    const qc = useQueryClient()
    const [name, setName] = useState('')
    const [err, setErr] = useState('')

    const mut = useMutation({
        mutationFn: () => createEc2KeyPair(name.trim()),
        onSuccess: (mat) => {
            void qc.invalidateQueries({queryKey: ['ec2', 'key-pairs']})
            onCreated(mat)
            onClose()
        },
        onError: (e) => setErr(e instanceof Error ? e.message : 'Create failed'),
    })

    return (
        <ModalOverlay onClose={onClose}>
            <div className="create-table-modal max-w-95">
                <h2>Create Key Pair</h2>
                <div className="modal-section">
                    <p className="modal-section-title">Name</p>
                    <Input aria-label="Name"
                        className="w-full min-w-0" autoFocus
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && name.trim() && mut.mutate()}
                        placeholder="my-key-pair"
                    />
                    {name && !isValidKeyPairName(name) && (
                        <p className="type-caption text-fail-text mt-1 mx-0 mb-0">
                            Letters, numbers, hyphens, underscores, dots, @ only
                        </p>
                    )}
                </div>
                {err && <p className="type-caption text-fail-text mt-0 mx-0 mb-2">{err}</p>}
                <div className="modal-footer">
                    <Button variant="secondary" onClick={onClose} disabled={mut.isPending}>Cancel</Button>
                    <Button disabled={!name.trim() || !isValidKeyPairName(name) || mut.isPending} onClick={() => mut.mutate()}>
                        {mut.isPending ? <Icon icon={Loader2} size={14}/> : <Icon icon={Key} size={14}/>}
                        Create
                    </Button>
                </div>
            </div>
        </ModalOverlay>
    )
}

// ─── Create VPC modal ─────────────────────────────────────────────────────────

function CreateVpcModal({onClose}: {onClose: () => void}) {
    const qc = useQueryClient()
    const [cidr, setCidr] = useState('10.0.0.0/16')
    const [err, setErr] = useState('')

    const mut = useMutation({
        mutationFn: () => createEc2Vpc(cidr.trim()),
        onSuccess: () => {
            void qc.invalidateQueries({queryKey: ['ec2', 'vpcs']})
            onClose()
        },
        onError: (e) => setErr(e instanceof Error ? e.message : 'Create failed'),
    })

    const cidrValid = isValidCidr(cidr)

    return (
        <ModalOverlay onClose={onClose}>
            <div className="create-table-modal max-w-90">
                <h2>Create VPC</h2>
                <div className="modal-section">
                    <p className="modal-section-title">IPv4 CIDR block</p>
                    <Input aria-label="IPv4 CIDR block"
                        className="w-full min-w-0" aria-invalid={(cidr && !cidrValid) ? true : undefined}
                        autoFocus value={cidr}
                        onChange={(e) => setCidr(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && cidrValid && mut.mutate()}
                    />
                    {cidr && !cidrValid && <p className="type-caption text-fail-text mt-1 mx-0 mb-0">Invalid CIDR</p>}
                </div>
                {err && <p className="type-caption text-fail-text mt-0 mx-0 mb-2">{err}</p>}
                <div className="modal-footer">
                    <Button variant="secondary" onClick={onClose} disabled={mut.isPending}>Cancel</Button>
                    <Button disabled={!cidrValid || mut.isPending} onClick={() => mut.mutate()}>
                        {mut.isPending ? <Icon icon={Loader2} size={14}/> : <Icon icon={Network} size={14}/>}
                        Create
                    </Button>
                </div>
            </div>
        </ModalOverlay>
    )
}

// ─── VPC Wizard modal (inline — no imports from features/ec2) ─────────────────

const AZ_OPTIONS = ['(auto)', 'us-east-1a', 'us-east-1b', 'us-east-1c', 'us-west-2a', 'us-west-2b']
const AZ_LABELS: Record<string, string> = {
    '(auto)': 'auto', 'us-east-1a': '1a', 'us-east-1b': '1b', 'us-east-1c': '1c',
    'us-west-2a': '2a', 'us-west-2b': '2b',
}
const DEFAULT_SUBNET_GROUPS: SubnetGroup[] = [
    {name: 'public',  count: 2, isPublic: true},
    {name: 'private', count: 2, isPublic: false},
]
const GROUP_TONES = ['text-data-1', 'text-data-2', 'text-data-3', 'text-data-4'] as const

type WizardStep = 'form' | 'creating' | 'done' | 'error'

function WizardModal({onClose}: {onClose: () => void}) {
    const qc = useQueryClient()
    const [wizName, setWizName]     = useState('')
    const [cidrBlock, setCidrBlock] = useState('10.0.0.0/16')
    const [groups, setGroups]       = useState<SubnetGroup[]>(DEFAULT_SUBNET_GROUPS)
    const [step, setStep]           = useState<WizardStep>('form')
    const [result, setResult]       = useState<VpcWizardResult | null>(null)
    const [errMsg, setErrMsg]       = useState('')

    const cidrValid   = isValidCidr(cidrBlock)
    const totalSubnets = groups.reduce((s, g) => s + g.count, 0)

    const preview = useMemo(
        () => (cidrValid && totalSubnets > 0 ? calculateSubnetCidrs(cidrBlock, groups) : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [cidrBlock, cidrValid, JSON.stringify(groups)],
    )
    const previewValid = preview !== null && isSubnetLayoutWithinBlock(cidrBlock, groups)

    const groupTones = useMemo(() => {
        let pi = 0
        return groups.map((g) => g.isPublic ? 'text-ok-text' : GROUP_TONES[pi++ % GROUP_TONES.length])
    }, [groups])

    const mut = useMutation({
        mutationFn: (input: VpcWizardInput) => createVpcWizard(input),
        onSuccess: (data) => {
            void qc.invalidateQueries({queryKey: ['ec2', 'vpcs']})
            void qc.invalidateQueries({queryKey: ['ec2', 'subnets']})
            void qc.invalidateQueries({queryKey: ['ec2', 'igws']})
            void qc.invalidateQueries({queryKey: ['ec2', 'route-tables']})
            void qc.invalidateQueries({queryKey: ['ec2', 'eips']})
            setResult(data)
            setStep('done')
        },
        onError: (e: Error) => {setErrMsg(e.message); setStep('error')},
    })

    function updateGroup(idx: number, patch: Partial<SubnetGroup>) {
        setGroups((prev) => prev.map((g, i) => i === idx ? {...g, ...patch} : g))
    }
    function addGroup() {setGroups((prev) => [...prev, {name: '', count: 1, isPublic: false}])}
    function removeGroup(idx: number) {setGroups((prev) => prev.filter((_, i) => i !== idx))}

    const canSubmit = cidrValid && wizName.trim().length > 0 && groups.length > 0 && groups.every((g) => g.name.trim() && g.count >= 1) && previewValid
    function handleCreate() {
        if (!canSubmit) return
        setStep('creating')
        mut.mutate({name: wizName.trim(), cidrBlock, subnetGroups: groups, natGateway: false})
    }

    return (
        <ModalOverlay onClose={onClose}>
            <div className="create-table-modal w-215 max-w-[96vw]" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header flex items-center gap-2">
                    <Icon icon={Network} className="text-accent-text" />
                    <span>VPC Wizard</span>
                    <Hint label="Close"><Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onClose} aria-label="Close"><Icon icon={X} size={14} aria-hidden="true"/></Button></Hint>
                </div>

                {step === 'form' && (
                    <>
                        <div className="flex gap-0">
                            <div className="py-4 px-5 border-r border-line overflow-y-auto grow-0 shrink-0 basis-95 max-h-[70vh]">
                                <div className="modal-section">
                                    <div className="section-title">Identity</div>
                                    <div className="field-row">
                                        <label>Name</label>
                                        <Input aria-label="Name" placeholder="my-vpc" value={wizName} onChange={(e) => setWizName(e.target.value)}/>
                                    </div>
                                    <div className="field-row">
                                        <label>IPv4 CIDR</label>
                                        <Input aria-label="IPv4 CIDR" placeholder="10.0.0.0/16" value={cidrBlock} onChange={(e) => setCidrBlock(e.target.value)} aria-invalid={(cidrBlock && !cidrValid) ? true : undefined}/>
                                        {cidrBlock && !cidrValid && <span className="text-fail-text type-caption mt-0.5">Invalid CIDR</span>}
                                    </div>
                                </div>
                                <div className="modal-section">
                                    <div className="flex items-center mb-2">
                                        <div className="section-title m-0">Subnet groups</div>
                                        <Button variant="secondary" size="sm" className="ml-auto" onClick={addGroup}>
                                            <Icon icon={Plus} size={14}/> Add group
                                        </Button>
                                    </div>
                                    {groups.length === 0 && <p className="text-text-3 mb-2">Add at least one group.</p>}
                                    {groups.map((g, idx) => (
                                      <div className="flex flex-col gap-2 mb-2 p-2 bg-page border border-line" key={idx}>
                                        <div className="flex items-center gap-2">
                                          <Input className="min-w-0 flex-1" aria-label="Subnet group name"
                                            placeholder="group name"
                                            value={g.name}
                                            onChange={(e) => updateGroup(idx, {name: e.target.value})}
                                          />
                                          <Hint label="Remove group"><Button variant="ghost" size="icon-sm" aria-label="Remove group" onClick={() => removeGroup(idx)}>
                                            <Icon icon={Trash2} size={14}/>
                                          </Button></Hint>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                          <label className="flex min-w-0 flex-col gap-1">
                                            <span className="type-micro text-text-3">Count</span>
                                            <OptionSelect aria-label="Subnet count" value={String(g.count)} onValueChange={(value) => updateGroup(idx, {count: Number(value)})}>
                                              {[1, 2, 3, 4].map((n) => <option key={n} value={String(n)}>{n}</option>)}
                                            </OptionSelect>
                                          </label>
                                          <label className="flex min-w-0 flex-col gap-1">
                                            <span className="type-micro text-text-3">Type</span>
                                            <OptionSelect aria-label="Subnet visibility" value={g.isPublic ? 'public' : 'private'} onValueChange={(value) => updateGroup(idx, {isPublic: value === 'public'})}>
                                              <option value="public">Public</option>
                                              <option value="private">Private</option>
                                            </OptionSelect>
                                          </label>
                                          <label className="flex min-w-0 flex-col gap-1">
                                            <span className="type-micro text-text-3">Mask</span>
                                            <OptionSelect aria-label="Subnet prefix length" value={String(g.prefix ?? 'auto')} onValueChange={(value) => updateGroup(idx, {prefix: value === 'auto' ? undefined : Number(value)})}>
                                              <option value="auto">auto</option>
                                              {[20, 21, 22, 23, 24, 25, 26, 27, 28].map((p) => <option key={p} value={String(p)}>/{p}</option>)}
                                            </OptionSelect>
                                          </label>
                                          <label className="flex min-w-0 flex-col gap-1">
                                            <span className="type-micro text-text-3">AZ</span>
                                            <OptionSelect aria-label="Availability zone" value={g.az ?? '(auto)'} onValueChange={(value) => updateGroup(idx, {az: value === '(auto)' ? undefined : value})}>
                                              {AZ_OPTIONS.map((a) => <option key={a} value={a}>{AZ_LABELS[a]}</option>)}
                                            </OptionSelect>
                                          </label>
                                        </div>
                                      </div>
                                    ))}

                                    {groups.some((g) => !g.name.trim()) && <p className="type-caption text-fail-text mt-1">All groups need a name.</p>}
                                </div>
                            </div>
                            <div className="flex-1 py-4 px-5 overflow-y-auto bg-well max-h-[70vh]">
                                <div className="section-title mb-3">Preview</div>
                                <div className="py-2.5 px-3.5 mb-2.5 border border-line bg-page">
                                    <div className="type-caption text-accent-text mb-1">VPC</div>
                                    <div className="type-code-sm">{cidrValid ? cidrBlock : ', '}</div>
                                    <div className="type-caption text-text-3 mt-0.5">+ Internet Gateway</div>
                                </div>
                                {preview && preview.length > 0 ? (
                                    <div className="flex gap-2 flex-wrap">
                                        {preview.map((grp, idx) => {
                                            const tone = groupTones[idx]
                                            return (
                                                <div className="min-w-25 grow shrink basis-25" key={idx}>
                                                    <div className={`type-caption mb-1.5 ${tone}`}>
                                                        {grp.name || <em>unnamed</em>} ({grp.cidrs.length})
                                                        <span className="ml-1 opacity-70">{grp.isPublic ? '· public' : '· private'}</span>
                                                    </div>
                                                    {grp.cidrs.map((cidr, i) => (
                                                        <div className="py-1.5 px-2.5 mb-1.5 type-code-sm border border-line" key={i}>{cidr}</div>
                                                    ))}
                                                </div>
                                            )
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-text-3 type-caption">
                                        {cidrValid ? 'Add subnet groups to preview.' : 'Enter a valid CIDR to preview.'}
                                    </div>
                                )}
                                {preview && !previewValid && (
                                    <p className="text-fail-text type-caption mt-2">
                                        Requested subnet layout is invalid or does not fit the VPC CIDR.
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <Button variant="secondary" onClick={onClose}>Cancel</Button>
                            <Button disabled={!canSubmit} onClick={handleCreate}>
                                Create VPC
                            </Button>
                        </div>
                    </>
                )}

                {step === 'creating' && (
                    <div className="p-12 flex flex-col items-center gap-3.5">
                        <Icon icon={Loader2} className="text-accent-text animate-pending" size={24}/>
                        <div className="type-caption">Creating VPC infrastructure…</div>
                        <div className="type-caption text-text-3 text-center">
                            Provisioning VPC, Internet Gateway, {totalSubnets} subnet{totalSubnets !== 1 ? 's' : ''}, route tables…
                        </div>
                    </div>
                )}

                {step === 'done' && result && (
                    <>
                        <div className="py-6 px-7 overflow-y-auto max-h-[70vh]">
                            <div className="flex items-center gap-2 mb-5">
                                <Icon icon={CheckCircle2} className="text-ok-text" />
                                <span>VPC created successfully</span>
                            </div>
                            <table className="border-collapse w-full">
                                <tbody>
                                    {[
                                        ['VPC', result.vpcId],
                                        ['Internet Gateway', result.igwId],
                                        ['Public Route Table', result.publicRouteTableId],
                                        ...(result.privateRouteTableId ? [['Private Route Table', result.privateRouteTableId]] : []),
                                        ...(result.natGatewayId ? [['NAT Gateway', result.natGatewayId]] : []),
                                        ...(result.eipAllocationId ? [['Elastic IP', result.eipAllocationId]] : []),
                                    ].map(([label, id]) => (
                                        <tr key={label}>
                                            <td className="text-text-3 pr-4 whitespace-nowrap type-caption">{label}</td>
                                            <td className="type-code-sm">{id}</td>
                                        </tr>
                                    ))}
                                    {result.subnetGroups.map((grp) => grp.subnetIds.map((id, i) => (
                                        <tr key={id}>
                                            <td className="text-text-3 pr-4 whitespace-nowrap type-caption">{grp.name} {i + 1}</td>
                                            <td className="type-code-sm">{id}</td>
                                        </tr>
                                    )))}
                                </tbody>
                            </table>
                        </div>
                        <div className="modal-footer"><Button onClick={onClose}>Close</Button></div>
                    </>
                )}

                {step === 'error' && (
                    <>
                        <div className="py-6 px-7">
                            <div className="flex items-center gap-2 mb-3">
                                <Icon icon={AlertCircle} className="text-fail-text" />
                                <span>Creation failed</span>
                            </div>
                            <div className="type-code-sm text-fail-text p-3 bg-well">{errMsg}</div>
                        </div>
                        <div className="modal-footer">
                            <Button variant="secondary" onClick={() => setStep('form')}>Back</Button>
                            <Button variant="secondary" onClick={onClose}>Close</Button>
                        </div>
                    </>
                )}
            </div>
        </ModalOverlay>
    )
}

// ─── Create Subnet modal ──────────────────────────────────────────────────────

function CreateSubnetModal({vpcs, onClose}: {vpcs: Ec2Vpc[]; onClose: () => void}) {
    const qc = useQueryClient()
    const [vpcId, setVpcId] = useState(vpcs[0]?.vpcId ?? '')
    const [cidr, setCidr]   = useState('')
    const [az, setAz]       = useState('')
    const [err, setErr]     = useState('')

    const cidrValid = isValidCidr(cidr)

    const mut = useMutation({
        mutationFn: () => createEc2Subnet(vpcId, cidr.trim(), az || undefined),
        onSuccess: () => {
            void qc.invalidateQueries({queryKey: ['ec2', 'subnets']})
            onClose()
        },
        onError: (e) => setErr(e instanceof Error ? e.message : 'Create failed'),
    })

    return (
        <ModalOverlay onClose={onClose}>
            <div className="create-table-modal max-w-100">
                <h2>Create Subnet</h2>
                <div className="modal-section">
                    <p className="modal-section-title">VPC</p>
                    <OptionSelect aria-label="VPC" className="w-full min-w-0" value={vpcId} onValueChange={(value) => setVpcId(value)}>
                        {vpcs.map((v) => <option key={v.vpcId} value={v.vpcId}>{nameTag(v.tags) || v.vpcId} ({v.cidrBlock})</option>)}
                    </OptionSelect>
                </div>
                <div className="modal-section">
                    <p className="modal-section-title">IPv4 CIDR</p>
                    <Input aria-label="IPv4 CIDR" className="w-full min-w-0" aria-invalid={(cidr && !cidrValid) ? true : undefined} placeholder="10.0.1.0/24" value={cidr} onChange={(e) => setCidr(e.target.value)}/>
                    {cidr && !cidrValid && <p className="type-caption text-fail-text mt-1 mx-0 mb-0">Invalid CIDR</p>}
                </div>
                <div className="modal-section">
                    <p className="modal-section-title">Availability Zone, optional</p>
                    <OptionSelect aria-label="Availability Zone" className="w-full min-w-0" value={az} onValueChange={(value) => setAz(value)}>
                        <option value="">No preference</option>
                        {AZ_OPTIONS.filter((a) => a !== '(auto)').map((a) => <option key={a} value={a}>{a}</option>)}
                    </OptionSelect>
                </div>
                {err && <p className="type-caption text-fail-text mt-0 mx-0 mb-2">{err}</p>}
                <div className="modal-footer">
                    <Button variant="secondary" onClick={onClose} disabled={mut.isPending}>Cancel</Button>
                    <Button disabled={!vpcId || !cidrValid || mut.isPending} onClick={() => mut.mutate()}>
                        {mut.isPending ? <Icon icon={Loader2} size={14}/> : <Icon icon={Router} size={14}/>}
                        Create
                    </Button>
                </div>
            </div>
        </ModalOverlay>
    )
}

// ─── Create IGW modal ─────────────────────────────────────────────────────────

function CreateIgwModal({onClose}: {onClose: () => void}) {
    const qc = useQueryClient()
    const [name, setName] = useState('')
    const [err, setErr]   = useState('')

    const mut = useMutation({
        mutationFn: () => createEc2InternetGateway(name.trim() || undefined),
        onSuccess: () => {
            void qc.invalidateQueries({queryKey: ['ec2', 'igws']})
            onClose()
        },
        onError: (e) => setErr(e instanceof Error ? e.message : 'Create failed'),
    })

    return (
        <ModalOverlay onClose={onClose}>
            <div className="create-table-modal max-w-90">
                <h2>Create Internet Gateway</h2>
                <div className="modal-section">
                    <p className="modal-section-title">Name, optional</p>
                    <Input aria-label="Name" className="w-full min-w-0" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && mut.mutate()} placeholder="my-igw"/>
                </div>
                {err && <p className="type-caption text-fail-text mt-0 mx-0 mb-2">{err}</p>}
                <div className="modal-footer">
                    <Button variant="secondary" onClick={onClose} disabled={mut.isPending}>Cancel</Button>
                    <Button disabled={mut.isPending} onClick={() => mut.mutate()}>
                        {mut.isPending ? <Icon icon={Loader2} size={14}/> : <Icon icon={Globe} size={14}/>}
                        Create
                    </Button>
                </div>
            </div>
        </ModalOverlay>
    )
}

// ─── Create Route Table modal ─────────────────────────────────────────────────

function CreateRtbModal({vpcs, onClose}: {vpcs: Ec2Vpc[]; onClose: () => void}) {
    const qc = useQueryClient()
    const [vpcId, setVpcId] = useState(vpcs[0]?.vpcId ?? '')
    const [name, setName]   = useState('')
    const [err, setErr]     = useState('')

    const mut = useMutation({
        mutationFn: () => createEc2RouteTable(vpcId, name.trim() || undefined),
        onSuccess: () => {
            void qc.invalidateQueries({queryKey: ['ec2', 'route-tables']})
            onClose()
        },
        onError: (e) => setErr(e instanceof Error ? e.message : 'Create failed'),
    })

    return (
        <ModalOverlay onClose={onClose}>
            <div className="create-table-modal max-w-95">
                <h2>Create Route Table</h2>
                <div className="modal-section">
                    <p className="modal-section-title">VPC</p>
                    <OptionSelect aria-label="VPC" className="w-full min-w-0" value={vpcId} onValueChange={(value) => setVpcId(value)}>
                        {vpcs.map((v) => <option key={v.vpcId} value={v.vpcId}>{nameTag(v.tags) || v.vpcId} ({v.cidrBlock})</option>)}
                    </OptionSelect>
                </div>
                <div className="modal-section">
                    <p className="modal-section-title">Name, optional</p>
                    <Input aria-label="Name" className="w-full min-w-0" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-rtb"/>
                </div>
                {err && <p className="type-caption text-fail-text mt-0 mx-0 mb-2">{err}</p>}
                <div className="modal-footer">
                    <Button variant="secondary" onClick={onClose} disabled={mut.isPending}>Cancel</Button>
                    <Button disabled={!vpcId || mut.isPending} onClick={() => mut.mutate()}>
                        {mut.isPending ? <Icon icon={Loader2} size={14}/> : <Icon icon={Router} size={14}/>}
                        Create
                    </Button>
                </div>
            </div>
        </ModalOverlay>
    )
}

// ─── Allocate EIP modal ───────────────────────────────────────────────────────

function AllocateEipModal({onClose}: {onClose: () => void}) {
    const qc = useQueryClient()
    const [err, setErr] = useState('')

    const mut = useMutation({
        mutationFn: () => allocateEc2ElasticIp(),
        onSuccess: () => {
            void qc.invalidateQueries({queryKey: ['ec2', 'eips']})
            onClose()
        },
        onError: (e) => setErr(e instanceof Error ? e.message : 'Allocate failed'),
    })

    return (
        <ModalOverlay onClose={onClose}>
            <div className="create-table-modal max-w-85">
                <h2>Allocate Elastic IP</h2>
                <div className="modal-section">
                    <p className="type-caption text-text-3 m-0">
                        Allocates a new Elastic IP address from Amazon's pool for use in your account.
                    </p>
                </div>
                {err && <p className="type-caption text-fail-text mt-0 mx-0 mb-2">{err}</p>}
                <div className="modal-footer">
                    <Button variant="secondary" onClick={onClose} disabled={mut.isPending}>Cancel</Button>
                    <Button disabled={mut.isPending} onClick={() => mut.mutate()}>
                        {mut.isPending ? <Icon icon={Loader2} size={14}/> : <Icon icon={Globe} size={14}/>}
                        Allocate
                    </Button>
                </div>
            </div>
        </ModalOverlay>
    )
}

// ─── Detail: Security Group ───────────────────────────────────────────────────

function SgDetail({sg, vpcs, onEdit, onDelete}: {
    sg: Ec2SecurityGroup
    vpcs: Ec2Vpc[]
    onEdit: () => void
    onDelete: () => void
}) {
    const vpcName = vpcs.find((v) => v.vpcId === sg.vpcId)
    return (
        <div className="widget">
            <div className="widget-header">
                <Icon icon={Shield} className="text-accent-text" size={14}/>
                <h2 className="ml-1.5">{sg.groupName}</h2>
                <div className="ml-auto flex gap-1.5">
                    <Button variant="secondary" size="sm" onClick={onEdit}>Edit rules</Button>
                    <Button variant="destructive" size="sm" onClick={onDelete}><Icon icon={Trash2} size={14}/> Delete</Button>
                </div>
            </div>
            <div className="widget-body">
                <MetaGrid rows={[
                    ['Group ID', sg.groupId],
                    ['Name', sg.groupName],
                    ['Description', sg.description],
                    ['VPC', vpcName ? `${nameTag(vpcName.tags) || vpcName.vpcId}` : sg.vpcId ?? ', '],
                ]}/>
                <p className="modal-section-title mt-3 mb-1.5">Inbound rules ({sg.inboundRules.length})</p>
                <IpPermTable perms={sg.inboundRules}/>
                <p className="modal-section-title mt-3 mb-1.5">Outbound rules ({sg.outboundRules.length})</p>
                <IpPermTable perms={sg.outboundRules}/>
            </div>
        </div>
    )
}

function IpPermTable({perms}: {perms: Ec2IpPermission[]}) {
    if (perms.length === 0) return <p className="type-caption text-text-2">No rules.</p>
    return (
        <div className="border border-line">
            <table className="w-full border-collapse type-caption">
                <thead>
                    <tr className="border-b border-line">
                        <th style={thS}>Protocol</th>
                        <th style={thS}>Ports</th>
                        <th style={thS}>Source/Dest</th>
                    </tr>
                </thead>
                <tbody>
                    {perms.map((p, i) => (
                        p.ipRanges.length > 0 ? p.ipRanges.map((cidr, j) => (
                            <tr key={`${i}-${j}`}>
                                <td style={tdS}>{protocolLabel(p.protocol)}</td>
                                <td style={tdS}>{portDisplay(p.fromPort, p.toPort, p.protocol)}</td>
                                <td className="type-code" style={{...tdS}}>{cidr}</td>
                            </tr>
                        )) : (
                            <tr key={i}>
                                <td style={tdS}>{protocolLabel(p.protocol)}</td>
                                <td style={tdS}>{portDisplay(p.fromPort, p.toPort, p.protocol)}</td>
                                <td className="text-text-2" style={{...tdS}}>, </td>
                            </tr>
                        )
                    ))}
                </tbody>
            </table>
        </div>
    )
}

// ─── Detail: Key Pair ─────────────────────────────────────────────────────────

function KpDetail({kp, onDelete}: {kp: Ec2KeyPair; onDelete: () => void}) {
    return (
        <div className="widget">
            <div className="widget-header">
                <Icon icon={Key} className="text-accent-text" size={14}/>
                <h2 className="ml-1.5">{kp.keyName}</h2>
                <div className="ml-auto">
                    <Button variant="destructive" size="sm" onClick={onDelete}><Icon icon={Trash2} size={14}/> Delete</Button>
                </div>
            </div>
            <div className="widget-body">
                <MetaGrid rows={[
                    ['Key Pair ID', kp.keyPairId],
                    ['Name', kp.keyName],
                    ['Fingerprint', kp.keyFingerprint ?? ', '],
                ]}/>
            </div>
        </div>
    )
}

// ─── Detail: VPC ──────────────────────────────────────────────────────────────

function VpcDetail({vpc, onDelete, deleteError}: {vpc: Ec2Vpc; onDelete: () => void; deleteError?: string}) {
    const qc = useQueryClient()

    const attrsQuery = useQuery({
        queryKey: ['ec2', 'vpc-attrs', vpc.vpcId],
        queryFn: ({signal}) => getEc2VpcAttributes(vpc.vpcId, signal),
    })

    const modifyMut = useMutation({
        mutationFn: ({attr, value}: {attr: 'enableDnsHostnames' | 'enableDnsSupport'; value: boolean}) =>
            modifyEc2VpcAttribute(vpc.vpcId, attr, value),
        onSuccess: () => void qc.invalidateQueries({queryKey: ['ec2', 'vpc-attrs', vpc.vpcId]}),
    })

    return (
        <div className="widget">
            <div className="widget-header">
                <Icon icon={Network} className="text-accent-text" size={14}/>
                <h2 className="ml-1.5">{nameTag(vpc.tags) || vpc.vpcId}</h2>
                {vpc.isDefault && <span className="status pending ml-2 type-caption">default</span>}
                <div className="ml-auto">
                    <Button title={vpc.isDefault ? 'Cannot delete the default VPC' : undefined} variant="destructive" size="sm" onClick={onDelete} disabled={vpc.isDefault}>
                        <Icon icon={Trash2} size={14}/> Delete
                    </Button>
                </div>
            </div>
            <div className="widget-body">
                {deleteError && <p className="type-caption text-fail-text mt-0 mx-0 mb-2" role="alert">{deleteError}</p>}
                <MetaGrid rows={[
                    ['VPC ID', vpc.vpcId],
                    ['CIDR', vpc.cidrBlock],
                    ['State', vpc.state ?? ', '],
                    ['Default', vpc.isDefault ? 'Yes' : 'No'],
                ]}/>
                <p className="modal-section-title mt-3 mb-2">DNS settings</p>
                {attrsQuery.isLoading && <p className="type-caption text-text-2">Loading…</p>}
                {attrsQuery.data && (
                    <div className="flex flex-col gap-2">
                        <ToggleRow
                            label="DNS hostnames"
                            checked={attrsQuery.data.enableDnsHostnames}
                            onChange={(v) => modifyMut.mutate({attr: 'enableDnsHostnames', value: v})}
                            disabled={modifyMut.isPending}
                        />
                        <ToggleRow
                            label="DNS support"
                            checked={attrsQuery.data.enableDnsSupport}
                            onChange={(v) => modifyMut.mutate({attr: 'enableDnsSupport', value: v})}
                            disabled={modifyMut.isPending}
                        />
                    </div>
                )}
            </div>
        </div>
    )
}

// ─── Detail: Subnet ───────────────────────────────────────────────────────────

function SubnetDetail({subnet, vpcs, onDelete}: {subnet: Ec2Subnet; vpcs: Ec2Vpc[]; onDelete: () => void}) {
    const qc = useQueryClient()
    const vpc = vpcs.find((v) => v.vpcId === subnet.vpcId)

    const mapIpMut = useMutation({
        mutationFn: (value: boolean) => modifyEc2SubnetAttribute(subnet.subnetId, value),
        onSuccess: () => void qc.invalidateQueries({queryKey: ['ec2', 'subnets']}),
    })

    return (
        <div className="widget">
            <div className="widget-header">
                <Icon icon={Server} className="text-accent-text" size={14}/>
                <h2 className="ml-1.5">{nameTag(subnet.tags) || subnet.subnetId}</h2>
                <div className="ml-auto">
                    <Button variant="destructive" size="sm" onClick={onDelete}><Icon icon={Trash2} size={14}/> Delete</Button>
                </div>
            </div>
            <div className="widget-body">
                <MetaGrid rows={[
                    ['Subnet ID', subnet.subnetId],
                    ['VPC', vpc ? `${nameTag(vpc.tags) || vpc.vpcId}` : subnet.vpcId],
                    ['CIDR', subnet.cidrBlock],
                    ['AZ', subnet.availabilityZone],
                    ['Available IPs', subnet.availableIpAddressCount !== undefined ? String(subnet.availableIpAddressCount) : ', '],
                    ['State', subnet.state ?? ', '],
                ]}/>
                <div className="mt-3">
                    <ToggleRow
                        label="Auto-assign public IPv4"
                        checked={subnet.mapPublicIpOnLaunch}
                        onChange={(v) => mapIpMut.mutate(v)}
                        disabled={mapIpMut.isPending}
                    />
                </div>
            </div>
        </div>
    )
}

// ─── Detail: Internet Gateway ─────────────────────────────────────────────────

function IgwDetail({igw, vpcs, onDelete}: {igw: Ec2InternetGateway; vpcs: Ec2Vpc[]; onDelete: () => void}) {
    const qc = useQueryClient()
    const [attachVpcId, setAttachVpcId] = useState('')
    const attached = igw.attachments.filter((a) => a.state === 'available' || a.state === 'attached')

    const attachMut = useMutation({
        mutationFn: (vpcId: string) => attachEc2InternetGateway(igw.internetGatewayId, vpcId),
        onSuccess: () => {void qc.invalidateQueries({queryKey: ['ec2', 'igws']}); setAttachVpcId('')},
    })
    const detachMut = useMutation({
        mutationFn: (vpcId: string) => detachEc2InternetGateway(igw.internetGatewayId, vpcId),
        onSuccess: () => void qc.invalidateQueries({queryKey: ['ec2', 'igws']}),
    })

    const attachedVpcIds = new Set(igw.attachments.map((a) => a.vpcId))
    const unattachedVpcs = vpcs.filter((v) => !attachedVpcIds.has(v.vpcId))

    return (
        <div className="widget">
            <div className="widget-header">
                <Icon icon={Globe} className="text-accent-text" size={14}/>
                <h2 className="ml-1.5">{nameTag(igw.tags) || igw.internetGatewayId}</h2>
                <div className="ml-auto">
                    <Button title={attached.length > 0 ? 'Detach from VPC first' : undefined} variant="destructive" size="sm" onClick={onDelete} disabled={attached.length > 0}>
                        <Icon icon={Trash2} size={14}/> Delete
                    </Button>
                </div>
            </div>
            <div className="widget-body">
                <MetaGrid rows={[['IGW ID', igw.internetGatewayId]]}/>
                <p className="modal-section-title mt-3 mb-2">Attached VPCs</p>
                {igw.attachments.length === 0 ? (
                    <p className="type-caption text-text-2">Not attached to any VPC.</p>
                ) : (
                    <div className="flex flex-col gap-1 mb-2">
                        {igw.attachments.map((a) => (
                            <div key={a.vpcId} className="field-row gap-1.5">
                                <span className="type-code-sm flex-1">{a.vpcId}</span>
                                <span className="type-caption text-text-2">{a.state}</span>
                                <Button variant="destructive" size="sm" disabled={detachMut.isPending} onClick={() => detachMut.mutate(a.vpcId)}>Detach</Button>
                            </div>
                        ))}
                    </div>
                )}
                {unattachedVpcs.length > 0 && (
                    <div className="field-row gap-1.5">
                        <OptionSelect aria-label="VPC to attach" className="flex-1 min-w-0" value={attachVpcId} onValueChange={(value) => setAttachVpcId(value)}>
                            <option value="">Select VPC to attach…</option>
                            {unattachedVpcs.map((v) => <option key={v.vpcId} value={v.vpcId}>{nameTag(v.tags) || v.vpcId}</option>)}
                        </OptionSelect>
                        <Button variant="secondary" size="sm" disabled={!attachVpcId || attachMut.isPending} onClick={() => attachMut.mutate(attachVpcId)}>
                            {attachMut.isPending ? <Icon icon={Loader2} size={14}/> : null}Attach
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}

// ─── Detail: Route Table ──────────────────────────────────────────────────────

function RtbDetail({rtb, vpcs, igws, onDelete}: {rtb: Ec2RouteTable; vpcs: Ec2Vpc[]; igws: Ec2InternetGateway[]; onDelete: () => void}) {
    const qc = useQueryClient()
    const [newCidr, setNewCidr]     = useState('')
    const [newTarget, setNewTarget] = useState('')
    const [routeErr, setRouteErr]   = useState('')

    const isMain = rtb.associations.some((a) => a.isMain)
    const vpc = vpcs.find((v) => v.vpcId === rtb.vpcId)

    const createRouteMut = useMutation({
        mutationFn: () => {
            const input: CreateRouteInput = {destinationCidrBlock: newCidr.trim()}
            const igw = igws.find((g) => g.internetGatewayId === newTarget)
            if (igw) input.gatewayId = newTarget
            else input.natGatewayId = newTarget
            return createEc2Route(rtb.routeTableId, input)
        },
        onSuccess: () => {
            void qc.invalidateQueries({queryKey: ['ec2', 'route-tables']})
            setNewCidr('')
            setNewTarget('')
            setRouteErr('')
        },
        onError: (e) => setRouteErr(e instanceof Error ? e.message : 'Add route failed'),
    })

    const deleteRouteMut = useMutation({
        mutationFn: (cidr: string) => deleteEc2Route(rtb.routeTableId, cidr),
        onSuccess: () => void qc.invalidateQueries({queryKey: ['ec2', 'route-tables']}),
    })

    return (
        <div className="widget">
            <div className="widget-header">
                <Icon icon={Router} className="text-accent-text" size={14}/>
                <h2 className="ml-1.5">{nameTag(rtb.tags) || rtb.routeTableId}</h2>
                {isMain && <span className="status pending ml-2 type-caption">main</span>}
                <div className="ml-auto">
                    <Button title={isMain ? 'Cannot delete the main route table' : undefined} variant="destructive" size="sm" onClick={onDelete} disabled={isMain}>
                        <Icon icon={Trash2} size={14}/> Delete
                    </Button>
                </div>
            </div>
            <div className="widget-body">
                <MetaGrid rows={[
                    ['RTB ID', rtb.routeTableId],
                    ['VPC', vpc ? `${nameTag(vpc.tags) || vpc.vpcId}` : rtb.vpcId],
                ]}/>
                <p className="modal-section-title mt-3 mb-1.5">Routes</p>
                {rtb.routes.length === 0 ? (
                    <p className="type-caption text-text-2">No routes.</p>
                ) : (
                    <div className="mb-2 border border-line">
                        <table className="w-full border-collapse type-caption">
                            <thead>
                                <tr className="border-b border-line">
                                    <th style={thS}>Destination</th>
                                    <th style={thS}>Target</th>
                                    <th style={thS}>State</th>
                                    <th className="w-7" style={{...thS}}/>
                                </tr>
                            </thead>
                            <tbody>
                                {rtb.routes.map((r, i) => (
                                    <tr key={i} className={i < rtb.routes.length - 1 ? 'border-b border-line-faint' : undefined}>
                                        <td className="type-code" style={{...tdS}}>{r.destinationCidrBlock ?? ', '}</td>
                                        <td className="type-code-sm" style={{...tdS}}>{r.gatewayId ?? r.natGatewayId ?? r.vpcPeeringConnectionId ?? ', '}</td>
                                        <td className="text-text-2" style={{...tdS}}>{r.state ?? ', '}</td>
                                        <td className="text-center" style={{...tdS}}>
                                            {r.origin !== 'CreateRouteTable' && r.destinationCidrBlock && (
                                                <Hint label="Delete route"><Button variant="ghost" size="icon-sm" aria-label="Delete route" disabled={deleteRouteMut.isPending} onClick={() => deleteRouteMut.mutate(r.destinationCidrBlock!)}>
                                                    <Icon icon={Trash2} size={14}/>
                                                </Button></Hint>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <p className="modal-section-title mb-1.5">Add route</p>
                <div className="field-row gap-1.5 flex-wrap">
                    <Input aria-label="Destination CIDR"
                        className="w-37.5 min-w-0" placeholder="Destination CIDR"
                        value={newCidr} onChange={(e) => setNewCidr(e.target.value)}
                    />
                    <OptionSelect aria-label="Route target" className="flex-1 min-w-30" value={newTarget} onValueChange={(value) => setNewTarget(value)}>
                        <option value="">Select target…</option>
                        {igws.map((g) => <option key={g.internetGatewayId} value={g.internetGatewayId}>{g.internetGatewayId} (IGW)</option>)}
                    </OptionSelect>
                    <Button variant="secondary" size="sm" disabled={!isValidCidr(newCidr) || !newTarget || createRouteMut.isPending} onClick={() => createRouteMut.mutate()}>
                        {createRouteMut.isPending ? <Icon icon={Loader2} size={14}/> : <Icon icon={Plus} size={14}/>}
                        Add
                    </Button>
                </div>
                {routeErr && <p className="type-caption text-fail-text mt-1">{routeErr}</p>}
            </div>
        </div>
    )
}

// ─── Detail: Elastic IP ───────────────────────────────────────────────────────

function EipDetail({eip, instances, onRelease}: {
    eip: Ec2ElasticIp
    instances: Array<{instanceId: string; name: string}>
    onRelease: () => void
}) {
    const qc = useQueryClient()
    const [selectedInstance, setSelectedInstance] = useState('')

    const associateMut = useMutation({
        mutationFn: () => associateEc2ElasticIp(eip.allocationId, selectedInstance),
        onSuccess: () => {
            void qc.invalidateQueries({queryKey: ['ec2', 'eips']})
            setSelectedInstance('')
        },
    })
    const disassociateMut = useMutation({
        mutationFn: () => disassociateEc2ElasticIp(eip.allocationId, eip.associationId!),
        onSuccess: () => void qc.invalidateQueries({queryKey: ['ec2', 'eips']}),
    })

    return (
        <div className="widget">
            <div className="widget-header">
                <Icon icon={Globe} className="text-accent-text" size={14}/>
                <h2 className="ml-1.5 type-code">{eip.publicIp}</h2>
                <div className="ml-auto">
                    <Button title={eip.associationId ? 'Disassociate before releasing' : undefined} variant="destructive" size="sm" onClick={onRelease} disabled={!!eip.associationId}>
                        <Icon icon={Trash2} size={14}/> Release
                    </Button>
                </div>
            </div>
            <div className="widget-body">
                <MetaGrid rows={[
                    ['Allocation ID', eip.allocationId],
                    ['Public IP', eip.publicIp],
                    ['Domain', eip.domain ?? ', '],
                    ['Association ID', eip.associationId ?? ', '],
                    ['Instance', eip.instanceId ?? ', '],
                ]}/>
                <div className="mt-3">
                    {eip.associationId ? (
                        <Button variant="secondary" size="sm" disabled={disassociateMut.isPending} onClick={() => disassociateMut.mutate()}>
                            {disassociateMut.isPending ? <Icon icon={Loader2} size={14}/> : null}
                            Disassociate
                        </Button>
                    ) : (
                        <div className="field-row gap-1.5">
                            <OptionSelect aria-label="Instance to associate" className="flex-1 min-w-0" value={selectedInstance} onValueChange={(value) => setSelectedInstance(value)}>
                                <option value="">Associate with instance…</option>
                                {instances.map((inst) => <option key={inst.instanceId} value={inst.instanceId}>{inst.name || inst.instanceId}</option>)}
                            </OptionSelect>
                            <Button variant="secondary" size="sm" disabled={!selectedInstance || associateMut.isPending} onClick={() => associateMut.mutate()}>
                                {associateMut.isPending ? <Icon icon={Loader2} size={14}/> : null}
                                Associate
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function MetaGrid({rows}: {rows: [string, string][]}) {
    return (
        <div className="meta-grid">
            {rows.map(([label, value]) => (
                <div key={label} className="meta-row">
                    <span className="meta-label">{label}</span>
                    <span className={`meta-value ${label.endsWith('ID') ? 'type-code-sm' : label === 'CIDR' || label === 'Fingerprint' ? 'type-code' : ''}`}>
                        {value}
                    </span>
                </div>
            ))}
        </div>
    )
}

function ToggleRow({label, checked, onChange, disabled}: {label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean}) {
    return (
        <div className="field-row items-center gap-2">
            <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label}/>
            <span className="type-caption">{label}</span>
            {disabled && <Icon icon={Loader2} className="text-text-2 animate-pending" size={14}/>}
        </div>
    )
}

// ─── Collapsible section ──────────────────────────────────────────────────────

function NetSection({
    title, icon: Glyph, items, section, selected, onSelect, onCreate, isLoading, wizardButton,
}: {
    title: string
    icon: SodiumIcon
    items: Array<{id: string; label: string; sub?: string}>
    section: Section
    selected: Selection
    onSelect: (sel: Selection) => void
    onCreate: () => void
    isLoading: boolean
    wizardButton?: () => void
}) {
    const [open, setOpen] = useState(true)
    const isActive = selected?.section === section

    return (
        <div className="border-b border-line">
            <div className="flex items-center gap-2 py-2 px-2.5 cursor-pointer select-none"
                onClick={() => setOpen((o) => !o)}
            >
                {open ? <Icon icon={ChevronDown} size={14}/> : <Icon icon={ChevronRight} size={14}/>}
                <Icon icon={Glyph} className="text-text-2" size={14}/>
                <span className="type-caption flex-1">{title}</span>
                {isLoading && <Icon icon={Loader2} className="text-text-2 animate-pending" size={14}/>}
                <span className="type-caption text-text-2 mr-1">{items.length}</span>
                {wizardButton && (
                    <Hint label="VPC Wizard"><Button variant="ghost" size="icon-sm" aria-label="VPC Wizard"
                        onClick={(e) => {e.stopPropagation(); wizardButton()}}
                    >
                        Wizard
                    </Button></Hint>
                )}
                <Hint label={`Create ${title}`}><Button variant="ghost" size="icon-sm" aria-label={`Create ${title}`}
                    onClick={(e) => {e.stopPropagation(); onCreate()}}
                >
                    <Icon icon={Plus} size={14}/>
                </Button></Hint>
            </div>
            {open && (
                <div>
                    {items.length === 0 ? (
                        <p className="text-text-2 pt-1 px-7 pb-2.5 m-0">None</p>
                    ) : (
                        items.map((item) => (
                            <div className={`pt-1.5 pr-2.5 pb-1.5 pl-7 cursor-pointer type-caption ${isActive && selected?.id === item.id ? 'selected' : ''}`}
                                key={item.id}
                                onClick={() => onSelect(isActive && selected?.id === item.id ? null : {section, id: item.id})}
                            >
                                <div className="overflow-hidden text-ellipsis whitespace-nowrap">{item.label}</div>
                                {item.sub && <div className="type-code-sm text-text-2">{item.sub}</div>}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    )
}

// ─── NetworkingPanel ──────────────────────────────────────────────────────────

type ModalState =
    | {type: 'create-sg'}
    | {type: 'edit-sg-rules'; sg: Ec2SecurityGroup}
    | {type: 'create-kp'}
    | {type: 'pem'; material: Ec2KeyPairMaterial}
    | {type: 'create-vpc'}
    | {type: 'vpc-wizard'}
    | {type: 'create-subnet'}
    | {type: 'create-igw'}
    | {type: 'create-rtb'}
    | {type: 'allocate-eip'}
    | {type: 'confirm-delete'; title: string; detail: string; onConfirm: () => void; isPending: boolean}

export function NetworkingPanel({cloud, resource, runtimeReachable}: NetworkingPanelProps) {
    const qc = useQueryClient()
    const [selected, setSelected] = useState<Selection>(null)
    const [modal, setModal]       = useState<ModalState | null>(null)

    // Sync with resource table selection: when a VPC is selected in the generic table,
    // preselect it in the left pane — same pattern as StorageObjectBrowser receiving its bucket.
    useEffect(() => {
        if (resource?.type === 'vpc') {
            setSelected({section: 'vpc', id: resource.id})
        }
    }, [resource?.id, resource?.type])

    // ── Data queries ──────────────────────────────────────────────────────────

    const sgsQ    = useQuery({queryKey: ['ec2', 'security-groups'],   queryFn: ({signal}) => listEc2SecurityGroups(undefined, signal), enabled: cloud === 'aws' && !!runtimeReachable})
    const kpsQ    = useQuery({queryKey: ['ec2', 'key-pairs'],          queryFn: ({signal}) => listEc2KeyPairs(signal),                  enabled: cloud === 'aws' && !!runtimeReachable})
    const vpcsQ   = useQuery({queryKey: ['ec2', 'vpcs'],               queryFn: ({signal}) => listEc2Vpcs(signal),                      enabled: cloud === 'aws' && !!runtimeReachable})
    const subnetsQ = useQuery({queryKey: ['ec2', 'subnets'],           queryFn: ({signal}) => listEc2Subnets(undefined, signal),        enabled: cloud === 'aws' && !!runtimeReachable})
    const igwsQ   = useQuery({queryKey: ['ec2', 'igws'],               queryFn: ({signal}) => listEc2InternetGateways(signal),          enabled: cloud === 'aws' && !!runtimeReachable})
    const rtbsQ   = useQuery({queryKey: ['ec2', 'route-tables'],       queryFn: ({signal}) => listEc2RouteTables(undefined, signal),    enabled: cloud === 'aws' && !!runtimeReachable})
    const eipsQ   = useQuery({queryKey: ['ec2', 'eips'],               queryFn: ({signal}) => listEc2ElasticIps(signal),               enabled: cloud === 'aws' && !!runtimeReachable})
    const instsQ  = useQuery({queryKey: ['ec2', 'instances'],          queryFn: ({signal}) => listEc2Instances(signal),                 enabled: cloud === 'aws' && !!runtimeReachable})

    // ── Delete mutations ──────────────────────────────────────────────────────

    const delSgMut = useMutation({
        mutationFn: (id: string) => deleteEc2SecurityGroup(id),
        onSuccess: (_, id) => {if (selected?.id === id) setSelected(null); void qc.invalidateQueries({queryKey: ['ec2', 'security-groups']})},
    })
    const delKpMut = useMutation({
        mutationFn: (name: string) => deleteEc2KeyPair(name),
        onSuccess: (_, name) => {if (selected?.id === name) setSelected(null); void qc.invalidateQueries({queryKey: ['ec2', 'key-pairs']})},
    })
    const delVpcMut = useMutation({
        mutationFn: (id: string) => deleteEc2Vpc(id),
        onSuccess: (_, id) => {if (selected?.id === id) setSelected(null); void qc.invalidateQueries({queryKey: ['ec2', 'vpcs']})},
    })
    const delSubnetMut = useMutation({
        mutationFn: (id: string) => deleteEc2Subnet(id),
        onSuccess: (_, id) => {if (selected?.id === id) setSelected(null); void qc.invalidateQueries({queryKey: ['ec2', 'subnets']})},
    })
    const delIgwMut = useMutation({
        mutationFn: (id: string) => deleteEc2InternetGateway(id),
        onSuccess: (_, id) => {if (selected?.id === id) setSelected(null); void qc.invalidateQueries({queryKey: ['ec2', 'igws']})},
    })
    const delRtbMut = useMutation({
        mutationFn: (id: string) => deleteEc2RouteTable(id),
        onSuccess: (_, id) => {if (selected?.id === id) setSelected(null); void qc.invalidateQueries({queryKey: ['ec2', 'route-tables']})},
    })
    const relEipMut = useMutation({
        mutationFn: (id: string) => releaseEc2ElasticIp(id),
        onSuccess: (_, id) => {if (selected?.id === id) setSelected(null); void qc.invalidateQueries({queryKey: ['ec2', 'eips']})},
    })

    if (cloud !== 'aws') {
        return (
            <div className="widget mt-4">
                <div className="widget-header"><Icon icon={Network} size={14}/><h2 className="ml-1.5">Networking</h2></div>
                <div className="widget-body">
                    {/*
                      * Azure has a working VNet adapter, so the table above this panel is
                      * live — saying "coming soon" under it would contradict what the user
                      * can already see. What is genuinely AWS-only is this panel's extra
                      * workflows (subnets, security groups, gateways, route tables, EIPs).
                      */}
                    <p className="type-caption text-text-2">
                        {cloud === 'azure'
                            ? 'Virtual networks are managed in the table above. Subnets, security groups, gateways and route tables are AWS-only today.'
                            : cloud === 'gcp'
                              ? 'VPC networks, subnetworks and firewall rules are managed in the table above. The emulator stores and validates them but forwards no traffic.'
                              : `Networking management coming soon for ${cloud.toUpperCase()}.`}
                    </p>
                </div>
            </div>
        )
    }

    if (!runtimeReachable) return null

    const sgs     = sgsQ.data    ?? []
    const kps     = kpsQ.data    ?? []
    const vpcs    = vpcsQ.data   ?? []
    const subnets = subnetsQ.data ?? []
    const igws    = igwsQ.data   ?? []
    const rtbs    = rtbsQ.data   ?? []
    const eips    = eipsQ.data   ?? []
    const insts   = instsQ.data  ?? []

    const instList = insts.map((i) => ({instanceId: i.instanceId, name: i.name}))

    // ── Resolve selected detail ───────────────────────────────────────────────

    const selectedSg     = selected?.section === 'sg'     ? sgs.find((x) => x.groupId === selected.id)         : undefined
    const selectedKp     = selected?.section === 'kp'     ? kps.find((x) => x.keyPairId === selected.id)       : undefined
    const selectedVpc    = selected?.section === 'vpc'    ? vpcs.find((x) => x.vpcId === selected.id)          : undefined
    const selectedSubnet = selected?.section === 'subnet' ? subnets.find((x) => x.subnetId === selected.id)    : undefined
    const selectedIgw    = selected?.section === 'igw'    ? igws.find((x) => x.internetGatewayId === selected.id) : undefined
    const selectedRtb    = selected?.section === 'rtb'    ? rtbs.find((x) => x.routeTableId === selected.id)   : undefined
    const selectedEip    = selected?.section === 'eip'    ? eips.find((x) => x.allocationId === selected.id)   : undefined

    const hasDetail = !!(selectedSg || selectedKp || selectedVpc || selectedSubnet || selectedIgw || selectedRtb || selectedEip)

    return (
        <>
            {/* Modals */}
            {modal?.type === 'create-sg'      && <CreateSgModal vpcs={vpcs} onClose={() => setModal(null)}/>}
            {modal?.type === 'edit-sg-rules'  && <EditSgRulesModal sg={modal.sg} onClose={() => {setModal(null); void qc.invalidateQueries({queryKey: ['ec2', 'security-groups']})}}/>}
            {modal?.type === 'create-kp'      && <CreateKpModal onClose={() => setModal(null)} onCreated={(mat) => setModal({type: 'pem', material: mat})}/>}
            {modal?.type === 'pem'            && <PemDisplay material={modal.material} onClose={() => setModal(null)}/>}
            {modal?.type === 'create-vpc'     && <CreateVpcModal onClose={() => setModal(null)}/>}
            {modal?.type === 'vpc-wizard'     && <WizardModal onClose={() => setModal(null)}/>}
            {modal?.type === 'create-subnet'  && <CreateSubnetModal vpcs={vpcs} onClose={() => setModal(null)}/>}
            {modal?.type === 'create-igw'     && <CreateIgwModal onClose={() => setModal(null)}/>}
            {modal?.type === 'create-rtb'     && <CreateRtbModal vpcs={vpcs} onClose={() => setModal(null)}/>}
            {modal?.type === 'allocate-eip'   && <AllocateEipModal onClose={() => setModal(null)}/>}
            {modal?.type === 'confirm-delete' && (
                <ConfirmDeleteModal
                    title={modal.title}
                    detail={modal.detail}
                    onConfirm={modal.onConfirm}
                    onClose={() => setModal(null)}
                    isPending={modal.isPending}
                />
            )}

            <div className="widget mt-4">
                <div className="widget-header">
                    <Icon icon={Network} className="text-accent-text" size={14}/>
                    <h2 className="ml-1.5">Networking</h2>
                </div>
                <div className="widget-body p-0">
                    <div className="net-split">

                        {/* Left pane — section list */}
                        <div className="net-split-list">
                            <NetSection
                                title="Security Groups" icon={Shield} section="sg" selected={selected} onSelect={setSelected}
                                items={sgs.map((x) => ({id: x.groupId, label: x.groupName, sub: x.groupId}))}
                                isLoading={sgsQ.isLoading}
                                onCreate={() => setModal({type: 'create-sg'})}
                            />
                            <NetSection
                                title="Key Pairs" icon={Key} section="kp" selected={selected} onSelect={setSelected}
                                items={kps.map((x) => ({id: x.keyPairId, label: x.keyName, sub: x.keyPairId}))}
                                isLoading={kpsQ.isLoading}
                                onCreate={() => setModal({type: 'create-kp'})}
                            />
                            <NetSection
                                title="VPCs" icon={Network} section="vpc" selected={selected} onSelect={setSelected}
                                items={vpcs.map((x) => ({id: x.vpcId, label: nameTag(x.tags) || x.vpcId, sub: x.cidrBlock}))}
                                isLoading={vpcsQ.isLoading}
                                onCreate={() => setModal({type: 'create-vpc'})}
                                wizardButton={() => setModal({type: 'vpc-wizard'})}
                            />
                            <NetSection
                                title="Subnets" icon={Server} section="subnet" selected={selected} onSelect={setSelected}
                                items={subnets.map((x) => ({id: x.subnetId, label: nameTag(x.tags) || x.subnetId, sub: x.cidrBlock}))}
                                isLoading={subnetsQ.isLoading}
                                onCreate={() => setModal({type: 'create-subnet'})}
                            />
                            <NetSection
                                title="Internet Gateways" icon={Globe} section="igw" selected={selected} onSelect={setSelected}
                                items={igws.map((x) => ({id: x.internetGatewayId, label: nameTag(x.tags) || x.internetGatewayId, sub: x.attachments.length > 0 ? `attached: ${x.attachments[0].vpcId}` : 'detached'}))}
                                isLoading={igwsQ.isLoading}
                                onCreate={() => setModal({type: 'create-igw'})}
                            />
                            <NetSection
                                title="Route Tables" icon={Router} section="rtb" selected={selected} onSelect={setSelected}
                                items={rtbs.map((x) => ({id: x.routeTableId, label: nameTag(x.tags) || x.routeTableId, sub: x.vpcId}))}
                                isLoading={rtbsQ.isLoading}
                                onCreate={() => setModal({type: 'create-rtb'})}
                            />
                            <NetSection
                                title="Elastic IPs" icon={Globe} section="eip" selected={selected} onSelect={setSelected}
                                items={eips.map((x) => ({id: x.allocationId, label: x.publicIp, sub: x.instanceId ? `→ ${x.instanceId}` : 'unassociated'}))}
                                isLoading={eipsQ.isLoading}
                                onCreate={() => setModal({type: 'allocate-eip'})}
                            />
                        </div>

                        {/* Right pane — detail */}
                        <div className={`net-split-detail ${hasDetail ? 'p-0' : 'p-4'}`}>
                            {!hasDetail && (
                                <p className="type-caption text-text-2">Select a resource to view details.</p>
                            )}

                            {selectedSg && (
                                <SgDetail
                                    sg={selectedSg}
                                    vpcs={vpcs}
                                    onEdit={() => setModal({type: 'edit-sg-rules', sg: selectedSg})}
                                    onDelete={() => setModal({
                                        type: 'confirm-delete',
                                        title: 'Delete Security Group',
                                        detail: `Delete "${selectedSg.groupName}" (${selectedSg.groupId})?`,
                                        isPending: delSgMut.isPending,
                                        onConfirm: () => { delSgMut.mutate(selectedSg.groupId); setModal(null) },
                                    })}
                                />
                            )}

                            {selectedKp && (
                                <KpDetail
                                    kp={selectedKp}
                                    onDelete={() => setModal({
                                        type: 'confirm-delete',
                                        title: 'Delete Key Pair',
                                        detail: `Delete key pair "${selectedKp.keyName}"? This cannot be undone.`,
                                        isPending: delKpMut.isPending,
                                        onConfirm: () => { delKpMut.mutate(selectedKp.keyName); setModal(null) },
                                    })}
                                />
                            )}

                            {selectedVpc && (
                                <VpcDetail
                                    vpc={selectedVpc}
                                    deleteError={delVpcMut.isError && delVpcMut.variables === selectedVpc.vpcId
                                        ? (delVpcMut.error instanceof Error ? delVpcMut.error.message : 'Delete VPC failed')
                                        : undefined}
                                    onDelete={() => setModal({
                                        type: 'confirm-delete',
                                        title: 'Delete VPC',
                                        detail: `Delete VPC "${selectedVpc.vpcId}" (${selectedVpc.cidrBlock})?`,
                                        isPending: delVpcMut.isPending,
                                        onConfirm: () => { delVpcMut.mutate(selectedVpc.vpcId); setModal(null) },
                                    })}
                                />
                            )}

                            {selectedSubnet && (
                                <SubnetDetail
                                    subnet={selectedSubnet}
                                    vpcs={vpcs}
                                    onDelete={() => setModal({
                                        type: 'confirm-delete',
                                        title: 'Delete Subnet',
                                        detail: `Delete subnet "${selectedSubnet.subnetId}" (${selectedSubnet.cidrBlock})?`,
                                        isPending: delSubnetMut.isPending,
                                        onConfirm: () => { delSubnetMut.mutate(selectedSubnet.subnetId); setModal(null) },
                                    })}
                                />
                            )}

                            {selectedIgw && (
                                <IgwDetail
                                    igw={selectedIgw}
                                    vpcs={vpcs}
                                    onDelete={() => setModal({
                                        type: 'confirm-delete',
                                        title: 'Delete Internet Gateway',
                                        detail: `Delete "${selectedIgw.internetGatewayId}"?`,
                                        isPending: delIgwMut.isPending,
                                        onConfirm: () => { delIgwMut.mutate(selectedIgw.internetGatewayId); setModal(null) },
                                    })}
                                />
                            )}

                            {selectedRtb && (
                                <RtbDetail
                                    rtb={selectedRtb}
                                    vpcs={vpcs}
                                    igws={igws}
                                    onDelete={() => setModal({
                                        type: 'confirm-delete',
                                        title: 'Delete Route Table',
                                        detail: `Delete "${selectedRtb.routeTableId}"?`,
                                        isPending: delRtbMut.isPending,
                                        onConfirm: () => { delRtbMut.mutate(selectedRtb.routeTableId); setModal(null) },
                                    })}
                                />
                            )}

                            {selectedEip && (
                                <EipDetail
                                    eip={selectedEip}
                                    instances={instList}
                                    onRelease={() => setModal({
                                        type: 'confirm-delete',
                                        title: 'Release Elastic IP',
                                        detail: `Release ${selectedEip.publicIp} (${selectedEip.allocationId})?`,
                                        isPending: relEipMut.isPending,
                                        onConfirm: () => { relEipMut.mutate(selectedEip.allocationId); setModal(null) },
                                    })}
                                />
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}
