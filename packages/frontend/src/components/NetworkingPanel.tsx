import {useEffect, useMemo, useState} from 'react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {
    AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Globe,
    Key, Loader2, Network, Plus, Router, Server, Shield, Trash2, X,
} from 'lucide-react'
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
import {calculateSubnetCidrs, isValidCidr, isValidPort} from '@/lib/network'

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
    if (from === null) return '—'
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
        <div className="modal-overlay" onClick={onClose}>
            <div className="create-table-modal" style={{width: 380}} onClick={(e) => e.stopPropagation()}>
                <div className="modal-header" style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <AlertTriangle size={14} style={{color: '#f87171', flexShrink: 0}}/>
                    <span>{title}</span>
                    <button className="icon-btn" style={{marginLeft: 'auto'}} onClick={onClose}>
                        <X size={13}/>
                    </button>
                </div>
                <div className="modal-section">
                    <p style={{fontSize: 12, color: 'var(--text-muted)', margin: 0}}>{detail}</p>
                </div>
                <div className="modal-footer">
                    <button className="button" onClick={onClose} disabled={isPending}>Cancel</button>
                    <button className="button danger" onClick={onConfirm} disabled={isPending}>
                        {isPending ? <Loader2 size={13}/> : <Trash2 size={13}/>}
                        Delete
                    </button>
                </div>
            </div>
        </div>
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
                <div style={{border: '1px solid var(--border)', borderRadius: 4, padding: '10px 12px', fontSize: 12, color: 'var(--text-2)', marginBottom: 8}}>
                    No rules. Click Add rule to add one.
                </div>
            ) : (
                <div style={{border: '1px solid var(--border)', borderRadius: 4, marginBottom: 8}}>
                    <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 12}}>
                        <thead>
                            <tr style={{borderBottom: '1px solid var(--border)'}}>
                                <th style={thS}>Type</th>
                                <th style={thS}>Proto</th>
                                <th style={thS}>Ports</th>
                                <th style={thS}>CIDR</th>
                                <th style={{...thS, width: 28}}/>
                            </tr>
                        </thead>
                        <tbody>
                            {rules.map((r, idx) => {
                                const pKey = presetFor(r.protocol, r.fromPort, r.toPort)
                                const cidrErr = r.cidr && !isValidCidr(r.cidr)
                                const fromErr = isCustom(r) && r.fromPort !== '' && !isValidPort(r.fromPort)
                                const toErr   = isCustom(r) && r.toPort   !== '' && !isValidPort(r.toPort)
                                return (
                                    <tr key={r.rid} style={{borderBottom: idx < rules.length - 1 ? '1px solid var(--border-faint)' : 'none'}}>
                                        <td style={tdS}>
                                            <select
                                                className="input"
                                                style={{width: 130, fontSize: 12}}
                                                value={pKey}
                                                onChange={(e) => handlePreset(r.rid, e.target.value)}
                                            >
                                                {RULE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                                            </select>
                                        </td>
                                        <td style={{...tdS, color: 'var(--text-2)'}}>
                                            {protocolLabel(r.protocol)}
                                        </td>
                                        <td style={tdS}>
                                            {r.protocol === '-1' || r.protocol === 'icmp' ? (
                                                <span style={{color: 'var(--text-2)'}}>—</span>
                                            ) : isCustom(r) ? (
                                                <div style={{display: 'flex', alignItems: 'center', gap: 4}}>
                                                    <input
                                                        className="input"
                                                        style={{width: 48, fontSize: 12, minWidth: 'unset', borderColor: fromErr ? '#f87171' : undefined}}
                                                        placeholder="From"
                                                        value={r.fromPort}
                                                        onChange={(e) => update(r.rid, {fromPort: e.target.value})}
                                                    />
                                                    <span style={{color: 'var(--text-2)'}}>–</span>
                                                    <input
                                                        className="input"
                                                        style={{width: 48, fontSize: 12, minWidth: 'unset', borderColor: toErr ? '#f87171' : undefined}}
                                                        placeholder="To"
                                                        value={r.toPort}
                                                        onChange={(e) => update(r.rid, {toPort: e.target.value})}
                                                    />
                                                </div>
                                            ) : (
                                                <span style={{color: 'var(--text-2)', fontSize: 12}}>
                                                    {r.fromPort === r.toPort ? r.fromPort : `${r.fromPort}–${r.toPort}`}
                                                </span>
                                            )}
                                        </td>
                                        <td style={tdS}>
                                            <input
                                                className="input"
                                                style={{width: 140, fontSize: 12, minWidth: 'unset', borderColor: cidrErr ? '#f87171' : undefined}}
                                                placeholder="0.0.0.0/0"
                                                value={r.cidr}
                                                onChange={(e) => update(r.rid, {cidr: e.target.value})}
                                            />
                                        </td>
                                        <td style={{...tdS, textAlign: 'center'}}>
                                            <button className="icon-btn danger" type="button" onClick={() => removeRule(r.rid)}>
                                                <Trash2 size={12}/>
                                            </button>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            <button className="button" type="button" onClick={addRule} style={{fontSize: 12}}>
                + Add rule
            </button>
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
        <div className="modal-overlay" onClick={(e) => {if (e.target === e.currentTarget) onClose()}}>
            <div className="create-table-modal" style={{maxWidth: 400}}>
                <h3>Create Security Group</h3>
                <div className="modal-section">
                    <p className="modal-section-title">Name</p>
                    <input className="input" style={{width: '100%', minWidth: 'unset'}} autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && mut.mutate()}/>
                </div>
                <div className="modal-section">
                    <p className="modal-section-title">Description</p>
                    <input className="input" style={{width: '100%', minWidth: 'unset'}} value={description} onChange={(e) => setDescription(e.target.value)}/>
                </div>
                {vpcs.length > 0 && (
                    <div className="modal-section">
                        <p className="modal-section-title">VPC — optional</p>
                        <select className="input" style={{width: '100%', minWidth: 'unset'}} value={vpcId} onChange={(e) => setVpcId(e.target.value)}>
                            <option value="">Default VPC</option>
                            {vpcs.map((v) => <option key={v.vpcId} value={v.vpcId}>{nameTag(v.tags) || v.vpcId} ({v.cidrBlock})</option>)}
                        </select>
                    </div>
                )}
                {err && <p style={{fontSize: 12, color: '#f87171', margin: '0 0 8px'}}>{err}</p>}
                <div className="modal-footer">
                    <button className="button" onClick={onClose} disabled={mut.isPending}>Cancel</button>
                    <button className="button primary" disabled={!name.trim() || !description.trim() || mut.isPending} onClick={() => mut.mutate()}>
                        {mut.isPending ? <Loader2 size={13}/> : <Shield size={13}/>}
                        Create
                    </button>
                </div>
            </div>
        </div>
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
        <div className="modal-overlay" onClick={(e) => {if (e.target === e.currentTarget) onClose()}}>
            <div className="create-table-modal" style={{maxWidth: 680}}>
                <div className="modal-header" style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <Shield size={14} style={{color: 'var(--accent)'}}/>
                    <span>Edit rules — {sg.groupName}</span>
                    <button className="icon-btn" style={{marginLeft: 'auto'}} onClick={onClose}><X size={13}/></button>
                </div>
                <div className="modal-section">
                    <p className="modal-section-title" style={{marginBottom: 8}}>Inbound rules</p>
                    <EditRuleTable rules={inbound} onChange={setInbound}/>
                </div>
                <div className="modal-section">
                    <p className="modal-section-title" style={{marginBottom: 8}}>Outbound rules</p>
                    <EditRuleTable rules={outbound} onChange={setOutbound}/>
                </div>
                {err && <p style={{fontSize: 12, color: '#f87171', margin: '0 0 8px'}}>{err}</p>}
                <div className="modal-footer">
                    <button className="button" onClick={onClose} disabled={mut.isPending}>Cancel</button>
                    <button className="button primary" disabled={mut.isPending} onClick={() => mut.mutate()}>
                        {mut.isPending ? <Loader2 size={13}/> : null}
                        Save rules
                    </button>
                </div>
            </div>
        </div>
    )
}

// ─── Create key pair modal + PEM display ──────────────────────────────────────

function PemDisplay({material, onClose}: {material: Ec2KeyPairMaterial; onClose: () => void}) {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="create-table-modal" style={{maxWidth: 600}} onClick={(e) => e.stopPropagation()}>
                <div className="modal-header" style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <Key size={14} style={{color: '#34d399'}}/>
                    <span>Save your private key — {material.keyName}</span>
                    <button className="icon-btn" style={{marginLeft: 'auto'}} onClick={onClose}><X size={13}/></button>
                </div>
                <div className="modal-section">
                    <p style={{fontSize: 12, color: '#f87171', marginBottom: 8}}>
                        This is the only time the private key material is available. Copy and save it now.
                    </p>
                    <pre style={{
                        background: 'var(--surface-2)', padding: 12, borderRadius: 4, fontSize: 11,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflowY: 'auto', margin: 0,
                    }}>
                        {material.keyMaterial}
                    </pre>
                </div>
                <div className="modal-footer">
                    <button className="button primary" onClick={() => {
                        navigator.clipboard.writeText(material.keyMaterial).catch(() => undefined)
                    }}>
                        Copy PEM
                    </button>
                    <button className="button" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
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
        <div className="modal-overlay" onClick={(e) => {if (e.target === e.currentTarget) onClose()}}>
            <div className="create-table-modal" style={{maxWidth: 380}}>
                <h3>Create Key Pair</h3>
                <div className="modal-section">
                    <p className="modal-section-title">Name</p>
                    <input
                        className="input" style={{width: '100%', minWidth: 'unset'}} autoFocus
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && name.trim() && mut.mutate()}
                        placeholder="my-key-pair"
                    />
                    {name && !isValidKeyPairName(name) && (
                        <p style={{fontSize: 11, color: '#f87171', margin: '4px 0 0'}}>
                            Letters, numbers, hyphens, underscores, dots, @ only
                        </p>
                    )}
                </div>
                {err && <p style={{fontSize: 12, color: '#f87171', margin: '0 0 8px'}}>{err}</p>}
                <div className="modal-footer">
                    <button className="button" onClick={onClose} disabled={mut.isPending}>Cancel</button>
                    <button className="button primary" disabled={!name.trim() || !isValidKeyPairName(name) || mut.isPending} onClick={() => mut.mutate()}>
                        {mut.isPending ? <Loader2 size={13}/> : <Key size={13}/>}
                        Create
                    </button>
                </div>
            </div>
        </div>
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
        <div className="modal-overlay" onClick={(e) => {if (e.target === e.currentTarget) onClose()}}>
            <div className="create-table-modal" style={{maxWidth: 360}}>
                <h3>Create VPC</h3>
                <div className="modal-section">
                    <p className="modal-section-title">IPv4 CIDR block</p>
                    <input
                        className="input" style={{width: '100%', minWidth: 'unset', borderColor: cidr && !cidrValid ? '#f87171' : undefined}}
                        autoFocus value={cidr}
                        onChange={(e) => setCidr(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && cidrValid && mut.mutate()}
                    />
                    {cidr && !cidrValid && <p style={{fontSize: 11, color: '#f87171', margin: '4px 0 0'}}>Invalid CIDR</p>}
                </div>
                {err && <p style={{fontSize: 12, color: '#f87171', margin: '0 0 8px'}}>{err}</p>}
                <div className="modal-footer">
                    <button className="button" onClick={onClose} disabled={mut.isPending}>Cancel</button>
                    <button className="button primary" disabled={!cidrValid || mut.isPending} onClick={() => mut.mutate()}>
                        {mut.isPending ? <Loader2 size={13}/> : <Network size={13}/>}
                        Create
                    </button>
                </div>
            </div>
        </div>
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
const PRIVATE_PALETTE = ['#94a3b8', '#a78bfa', '#fb923c', '#f472b6']

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

    const privateColors = useMemo(() => {
        let pi = 0
        return groups.map((g) => g.isPublic ? '#34d399' : PRIVATE_PALETTE[pi++ % PRIVATE_PALETTE.length])
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

    const canSubmit = cidrValid && wizName.trim().length > 0 && groups.length > 0 && groups.every((g) => g.name.trim() && g.count >= 1)

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="create-table-modal" style={{width: 860, maxWidth: '96vw'}} onClick={(e) => e.stopPropagation()}>
                <div className="modal-header" style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <Network size={15} style={{color: 'var(--accent)'}}/>
                    <span>VPC Wizard</span>
                    <button className="icon-btn" style={{marginLeft: 'auto'}} onClick={onClose}><X size={13}/></button>
                </div>

                {step === 'form' && (
                    <>
                        <div style={{display: 'flex', gap: 0}}>
                            <div style={{flex: '0 0 380px', padding: '16px 20px', borderRight: '1px solid var(--border)', overflowY: 'auto', maxHeight: '70vh'}}>
                                <div className="modal-section">
                                    <div className="section-title">Identity</div>
                                    <div className="field-row">
                                        <label>Name</label>
                                        <input className="input" placeholder="my-vpc" value={wizName} onChange={(e) => setWizName(e.target.value)}/>
                                    </div>
                                    <div className="field-row">
                                        <label>IPv4 CIDR</label>
                                        <input className="input" placeholder="10.0.0.0/16" value={cidrBlock} onChange={(e) => setCidrBlock(e.target.value)} style={{borderColor: cidrBlock && !cidrValid ? '#f87171' : undefined}}/>
                                        {cidrBlock && !cidrValid && <span style={{color: '#f87171', fontSize: 11, marginTop: 2}}>Invalid CIDR</span>}
                                    </div>
                                </div>
                                <div className="modal-section">
                                    <div style={{display: 'flex', alignItems: 'center', marginBottom: 8}}>
                                        <div className="section-title" style={{margin: 0}}>Subnet groups</div>
                                        <button className="button compact" style={{marginLeft: 'auto', fontSize: 11}} onClick={addGroup}>
                                            <Plus size={11}/> Add group
                                        </button>
                                    </div>
                                    {groups.length === 0 && <p style={{fontSize: 12, color: 'var(--text-muted)', marginBottom: 8}}>Add at least one group.</p>}
                                    {groups.length > 0 && (
                                        <div style={{display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 44px 80px 54px 52px auto', gap: 4, padding: '0 6px', marginBottom: 2}}>
                                            {['Name', '#', 'Type', 'Mask', 'AZ', ''].map((h) => (
                                                <span key={h} style={{fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em'}}>{h}</span>
                                            ))}
                                        </div>
                                    )}
                                    {groups.map((g, idx) => (
                                        <div key={idx} style={{display: 'grid', gridTemplateColumns: 'minmax(60px,1fr) 38px 70px 46px 44px auto', gap: 4, alignItems: 'center', marginBottom: 4, background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 6px'}}>
                                            <input style={{minWidth: 0, fontSize: 12, padding: '3px 7px', background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)'}} placeholder="name" value={g.name} onChange={(e) => updateGroup(idx, {name: e.target.value})}/>
                                            <select className="input" style={{minWidth: 0, width: '100%', fontSize: 12, padding: '2px 4px', height: 26}} value={g.count} onChange={(e) => updateGroup(idx, {count: Number(e.target.value)})}>
                                                {[1,2,3,4].map((n) => <option key={n} value={n}>{n}</option>)}
                                            </select>
                                            <select className="input" style={{minWidth: 0, width: '100%', fontSize: 11, padding: '2px 4px', height: 26, color: g.isPublic ? '#34d399' : 'var(--text-muted)'}} value={g.isPublic ? 'public' : 'private'} onChange={(e) => updateGroup(idx, {isPublic: e.target.value === 'public'})}>
                                                <option value="public">Public</option>
                                                <option value="private">Private</option>
                                            </select>
                                            <select className="input" style={{minWidth: 0, width: '100%', fontSize: 11, padding: '2px 2px', height: 26}} value={g.prefix ?? 'auto'} onChange={(e) => updateGroup(idx, {prefix: e.target.value === 'auto' ? undefined : Number(e.target.value)})}>
                                                <option value="auto">auto</option>
                                                {[20,21,22,23,24,25,26,27,28].map((p) => <option key={p} value={p}>/{p}</option>)}
                                            </select>
                                            <select className="input" style={{minWidth: 0, width: '100%', fontSize: 11, padding: '2px 2px', height: 26}} value={g.az ?? '(auto)'} onChange={(e) => updateGroup(idx, {az: e.target.value === '(auto)' ? undefined : e.target.value})}>
                                                {AZ_OPTIONS.map((a) => <option key={a} value={a}>{AZ_LABELS[a]}</option>)}
                                            </select>
                                            <button className="icon-btn danger" onClick={() => removeGroup(idx)}><Trash2 size={12}/></button>
                                        </div>
                                    ))}
                                    {groups.some((g) => !g.name.trim()) && <p style={{fontSize: 11, color: '#f87171', marginTop: 4}}>All groups need a name.</p>}
                                </div>
                            </div>
                            <div style={{flex: 1, padding: '16px 20px', background: 'var(--bg-subtle, var(--bg-secondary))', overflowY: 'auto', maxHeight: '70vh'}}>
                                <div className="section-title" style={{marginBottom: 12}}>Preview</div>
                                <div style={{border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-primary)', padding: '10px 14px', marginBottom: 10}}>
                                    <div style={{fontSize: 11, fontWeight: 600, color: 'var(--accent)', marginBottom: 4}}>VPC</div>
                                    <div style={{fontFamily: 'monospace', fontSize: 12}}>{cidrValid ? cidrBlock : '—'}</div>
                                    <div style={{fontSize: 11, color: 'var(--text-muted)', marginTop: 2}}>+ Internet Gateway</div>
                                </div>
                                {preview && preview.length > 0 ? (
                                    <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                                        {preview.map((grp, idx) => {
                                            const color = privateColors[idx]
                                            return (
                                                <div key={idx} style={{minWidth: 100, flex: '1 1 100px'}}>
                                                    <div style={{fontSize: 11, fontWeight: 600, color, marginBottom: 6}}>
                                                        {grp.name || <em>unnamed</em>} ({grp.cidrs.length})
                                                        <span style={{fontWeight: 400, marginLeft: 4, opacity: 0.7}}>{grp.isPublic ? '· public' : '· private'}</span>
                                                    </div>
                                                    {grp.cidrs.map((cidr, i) => (
                                                        <div key={i} style={{border: `1px solid ${color}60`, borderRadius: 4, padding: '5px 9px', marginBottom: 5, background: `${color}10`, fontFamily: 'monospace', fontSize: 11}}>{cidr}</div>
                                                    ))}
                                                </div>
                                            )
                                        })}
                                    </div>
                                ) : (
                                    <div style={{color: 'var(--text-muted)', fontSize: 12}}>
                                        {cidrValid ? 'Add subnet groups to preview.' : 'Enter a valid CIDR to preview.'}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="button" onClick={onClose}>Cancel</button>
                            <button className="button primary" disabled={!canSubmit} onClick={() => {setStep('creating'); mut.mutate({name: wizName.trim(), cidrBlock, subnetGroups: groups, natGateway: false})}}>
                                Create VPC
                            </button>
                        </div>
                    </>
                )}

                {step === 'creating' && (
                    <div style={{padding: 48, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14}}>
                        <Loader2 size={28} style={{animation: 'spin 1s linear infinite', color: 'var(--accent)'}}/>
                        <div style={{fontSize: 13, fontWeight: 500}}>Creating VPC infrastructure…</div>
                        <div style={{fontSize: 12, color: 'var(--text-muted)', textAlign: 'center'}}>
                            Provisioning VPC, Internet Gateway, {totalSubnets} subnet{totalSubnets !== 1 ? 's' : ''}, route tables…
                        </div>
                    </div>
                )}

                {step === 'done' && result && (
                    <>
                        <div style={{padding: '24px 28px', maxHeight: '70vh', overflowY: 'auto'}}>
                            <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20}}>
                                <CheckCircle2 size={18} style={{color: '#34d399'}}/>
                                <span style={{fontWeight: 600}}>VPC created successfully</span>
                            </div>
                            <table style={{borderCollapse: 'collapse', width: '100%'}}>
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
                                            <td style={{color: 'var(--text-muted)', paddingRight: 16, whiteSpace: 'nowrap', fontSize: 12}}>{label}</td>
                                            <td style={{fontFamily: 'monospace', fontSize: 12}}>{id}</td>
                                        </tr>
                                    ))}
                                    {result.subnetGroups.map((grp) => grp.subnetIds.map((id, i) => (
                                        <tr key={id}>
                                            <td style={{color: 'var(--text-muted)', paddingRight: 16, whiteSpace: 'nowrap', fontSize: 12}}>{grp.name} {i + 1}</td>
                                            <td style={{fontFamily: 'monospace', fontSize: 12}}>{id}</td>
                                        </tr>
                                    )))}
                                </tbody>
                            </table>
                        </div>
                        <div className="modal-footer"><button className="button primary" onClick={onClose}>Close</button></div>
                    </>
                )}

                {step === 'error' && (
                    <>
                        <div style={{padding: '24px 28px'}}>
                            <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12}}>
                                <AlertCircle size={18} style={{color: '#f87171'}}/>
                                <span style={{fontWeight: 600}}>Creation failed</span>
                            </div>
                            <div style={{fontFamily: 'monospace', fontSize: 12, color: '#f87171', background: 'var(--bg-secondary)', padding: 12, borderRadius: 4}}>{errMsg}</div>
                        </div>
                        <div className="modal-footer">
                            <button className="button" onClick={() => setStep('form')}>Back</button>
                            <button className="button" onClick={onClose}>Close</button>
                        </div>
                    </>
                )}
            </div>
        </div>
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
        <div className="modal-overlay" onClick={(e) => {if (e.target === e.currentTarget) onClose()}}>
            <div className="create-table-modal" style={{maxWidth: 400}}>
                <h3>Create Subnet</h3>
                <div className="modal-section">
                    <p className="modal-section-title">VPC</p>
                    <select className="input" style={{width: '100%', minWidth: 'unset'}} value={vpcId} onChange={(e) => setVpcId(e.target.value)}>
                        {vpcs.map((v) => <option key={v.vpcId} value={v.vpcId}>{nameTag(v.tags) || v.vpcId} ({v.cidrBlock})</option>)}
                    </select>
                </div>
                <div className="modal-section">
                    <p className="modal-section-title">IPv4 CIDR</p>
                    <input className="input" style={{width: '100%', minWidth: 'unset', borderColor: cidr && !cidrValid ? '#f87171' : undefined}} placeholder="10.0.1.0/24" value={cidr} onChange={(e) => setCidr(e.target.value)}/>
                    {cidr && !cidrValid && <p style={{fontSize: 11, color: '#f87171', margin: '4px 0 0'}}>Invalid CIDR</p>}
                </div>
                <div className="modal-section">
                    <p className="modal-section-title">Availability Zone — optional</p>
                    <select className="input" style={{width: '100%', minWidth: 'unset'}} value={az} onChange={(e) => setAz(e.target.value)}>
                        <option value="">No preference</option>
                        {AZ_OPTIONS.filter((a) => a !== '(auto)').map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                </div>
                {err && <p style={{fontSize: 12, color: '#f87171', margin: '0 0 8px'}}>{err}</p>}
                <div className="modal-footer">
                    <button className="button" onClick={onClose} disabled={mut.isPending}>Cancel</button>
                    <button className="button primary" disabled={!vpcId || !cidrValid || mut.isPending} onClick={() => mut.mutate()}>
                        {mut.isPending ? <Loader2 size={13}/> : <Router size={13}/>}
                        Create
                    </button>
                </div>
            </div>
        </div>
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
        <div className="modal-overlay" onClick={(e) => {if (e.target === e.currentTarget) onClose()}}>
            <div className="create-table-modal" style={{maxWidth: 360}}>
                <h3>Create Internet Gateway</h3>
                <div className="modal-section">
                    <p className="modal-section-title">Name — optional</p>
                    <input className="input" style={{width: '100%', minWidth: 'unset'}} autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && mut.mutate()} placeholder="my-igw"/>
                </div>
                {err && <p style={{fontSize: 12, color: '#f87171', margin: '0 0 8px'}}>{err}</p>}
                <div className="modal-footer">
                    <button className="button" onClick={onClose} disabled={mut.isPending}>Cancel</button>
                    <button className="button primary" disabled={mut.isPending} onClick={() => mut.mutate()}>
                        {mut.isPending ? <Loader2 size={13}/> : <Globe size={13}/>}
                        Create
                    </button>
                </div>
            </div>
        </div>
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
        <div className="modal-overlay" onClick={(e) => {if (e.target === e.currentTarget) onClose()}}>
            <div className="create-table-modal" style={{maxWidth: 380}}>
                <h3>Create Route Table</h3>
                <div className="modal-section">
                    <p className="modal-section-title">VPC</p>
                    <select className="input" style={{width: '100%', minWidth: 'unset'}} value={vpcId} onChange={(e) => setVpcId(e.target.value)}>
                        {vpcs.map((v) => <option key={v.vpcId} value={v.vpcId}>{nameTag(v.tags) || v.vpcId} ({v.cidrBlock})</option>)}
                    </select>
                </div>
                <div className="modal-section">
                    <p className="modal-section-title">Name — optional</p>
                    <input className="input" style={{width: '100%', minWidth: 'unset'}} value={name} onChange={(e) => setName(e.target.value)} placeholder="my-rtb"/>
                </div>
                {err && <p style={{fontSize: 12, color: '#f87171', margin: '0 0 8px'}}>{err}</p>}
                <div className="modal-footer">
                    <button className="button" onClick={onClose} disabled={mut.isPending}>Cancel</button>
                    <button className="button primary" disabled={!vpcId || mut.isPending} onClick={() => mut.mutate()}>
                        {mut.isPending ? <Loader2 size={13}/> : <Router size={13}/>}
                        Create
                    </button>
                </div>
            </div>
        </div>
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
        <div className="modal-overlay" onClick={(e) => {if (e.target === e.currentTarget) onClose()}}>
            <div className="create-table-modal" style={{maxWidth: 340}}>
                <h3>Allocate Elastic IP</h3>
                <div className="modal-section">
                    <p style={{fontSize: 12, color: 'var(--text-muted)', margin: 0}}>
                        Allocates a new Elastic IP address from Amazon's pool for use in your account.
                    </p>
                </div>
                {err && <p style={{fontSize: 12, color: '#f87171', margin: '0 0 8px'}}>{err}</p>}
                <div className="modal-footer">
                    <button className="button" onClick={onClose} disabled={mut.isPending}>Cancel</button>
                    <button className="button primary" disabled={mut.isPending} onClick={() => mut.mutate()}>
                        {mut.isPending ? <Loader2 size={13}/> : <Globe size={13}/>}
                        Allocate
                    </button>
                </div>
            </div>
        </div>
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
                <Shield size={14} style={{color: 'var(--accent)'}}/>
                <h3 style={{marginLeft: 6}}>{sg.groupName}</h3>
                <div style={{marginLeft: 'auto', display: 'flex', gap: 6}}>
                    <button className="button compact" onClick={onEdit}>Edit rules</button>
                    <button className="button compact danger" onClick={onDelete}><Trash2 size={12}/> Delete</button>
                </div>
            </div>
            <div className="widget-body">
                <MetaGrid rows={[
                    ['Group ID', sg.groupId],
                    ['Name', sg.groupName],
                    ['Description', sg.description],
                    ['VPC', vpcName ? `${nameTag(vpcName.tags) || vpcName.vpcId}` : sg.vpcId ?? '—'],
                ]}/>
                <p className="modal-section-title" style={{marginTop: 12, marginBottom: 6}}>Inbound rules ({sg.inboundRules.length})</p>
                <IpPermTable perms={sg.inboundRules}/>
                <p className="modal-section-title" style={{marginTop: 12, marginBottom: 6}}>Outbound rules ({sg.outboundRules.length})</p>
                <IpPermTable perms={sg.outboundRules}/>
            </div>
        </div>
    )
}

function IpPermTable({perms}: {perms: Ec2IpPermission[]}) {
    if (perms.length === 0) return <p style={{fontSize: 12, color: 'var(--text-2)'}}>No rules.</p>
    return (
        <div style={{border: '1px solid var(--border)', borderRadius: 4}}>
            <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 12}}>
                <thead>
                    <tr style={{borderBottom: '1px solid var(--border)'}}>
                        <th style={thS}>Protocol</th>
                        <th style={thS}>Ports</th>
                        <th style={thS}>Source/Dest</th>
                    </tr>
                </thead>
                <tbody>
                    {perms.map((p, i) => (
                        p.ipRanges.length > 0 ? p.ipRanges.map((cidr, j) => (
                            <tr key={`${i}-${j}`} style={{borderBottom: 'none'}}>
                                <td style={tdS}>{protocolLabel(p.protocol)}</td>
                                <td style={tdS}>{portDisplay(p.fromPort, p.toPort, p.protocol)}</td>
                                <td style={{...tdS, fontFamily: 'monospace'}}>{cidr}</td>
                            </tr>
                        )) : (
                            <tr key={i}>
                                <td style={tdS}>{protocolLabel(p.protocol)}</td>
                                <td style={tdS}>{portDisplay(p.fromPort, p.toPort, p.protocol)}</td>
                                <td style={{...tdS, color: 'var(--text-2)'}}>—</td>
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
                <Key size={14} style={{color: 'var(--accent)'}}/>
                <h3 style={{marginLeft: 6}}>{kp.keyName}</h3>
                <div style={{marginLeft: 'auto'}}>
                    <button className="button compact danger" onClick={onDelete}><Trash2 size={12}/> Delete</button>
                </div>
            </div>
            <div className="widget-body">
                <MetaGrid rows={[
                    ['Key Pair ID', kp.keyPairId],
                    ['Name', kp.keyName],
                    ['Fingerprint', kp.keyFingerprint ?? '—'],
                ]}/>
            </div>
        </div>
    )
}

// ─── Detail: VPC ──────────────────────────────────────────────────────────────

function VpcDetail({vpc, onDelete}: {vpc: Ec2Vpc; onDelete: () => void}) {
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
                <Network size={14} style={{color: 'var(--accent)'}}/>
                <h3 style={{marginLeft: 6}}>{nameTag(vpc.tags) || vpc.vpcId}</h3>
                {vpc.isDefault && <span className="status pending" style={{marginLeft: 8, fontSize: 10}}>default</span>}
                <div style={{marginLeft: 'auto'}}>
                    <button className="button compact danger" onClick={onDelete} disabled={vpc.isDefault} title={vpc.isDefault ? 'Cannot delete the default VPC' : undefined}>
                        <Trash2 size={12}/> Delete
                    </button>
                </div>
            </div>
            <div className="widget-body">
                <MetaGrid rows={[
                    ['VPC ID', vpc.vpcId],
                    ['CIDR', vpc.cidrBlock],
                    ['State', vpc.state ?? '—'],
                    ['Default', vpc.isDefault ? 'Yes' : 'No'],
                ]}/>
                <p className="modal-section-title" style={{marginTop: 12, marginBottom: 8}}>DNS settings</p>
                {attrsQuery.isLoading && <p style={{fontSize: 12, color: 'var(--text-2)'}}>Loading…</p>}
                {attrsQuery.data && (
                    <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
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
                <Server size={14} style={{color: 'var(--accent)'}}/>
                <h3 style={{marginLeft: 6}}>{nameTag(subnet.tags) || subnet.subnetId}</h3>
                <div style={{marginLeft: 'auto'}}>
                    <button className="button compact danger" onClick={onDelete}><Trash2 size={12}/> Delete</button>
                </div>
            </div>
            <div className="widget-body">
                <MetaGrid rows={[
                    ['Subnet ID', subnet.subnetId],
                    ['VPC', vpc ? `${nameTag(vpc.tags) || vpc.vpcId}` : subnet.vpcId],
                    ['CIDR', subnet.cidrBlock],
                    ['AZ', subnet.availabilityZone],
                    ['Available IPs', subnet.availableIpAddressCount !== undefined ? String(subnet.availableIpAddressCount) : '—'],
                    ['State', subnet.state ?? '—'],
                ]}/>
                <div style={{marginTop: 12}}>
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
                <Globe size={14} style={{color: 'var(--accent)'}}/>
                <h3 style={{marginLeft: 6}}>{nameTag(igw.tags) || igw.internetGatewayId}</h3>
                <div style={{marginLeft: 'auto'}}>
                    <button className="button compact danger" onClick={onDelete} disabled={attached.length > 0} title={attached.length > 0 ? 'Detach from VPC first' : undefined}>
                        <Trash2 size={12}/> Delete
                    </button>
                </div>
            </div>
            <div className="widget-body">
                <MetaGrid rows={[['IGW ID', igw.internetGatewayId]]}/>
                <p className="modal-section-title" style={{marginTop: 12, marginBottom: 8}}>Attached VPCs</p>
                {igw.attachments.length === 0 ? (
                    <p style={{fontSize: 12, color: 'var(--text-2)'}}>Not attached to any VPC.</p>
                ) : (
                    <div style={{display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8}}>
                        {igw.attachments.map((a) => (
                            <div key={a.vpcId} className="field-row" style={{gap: 6}}>
                                <span style={{fontFamily: 'monospace', fontSize: 12, flex: 1}}>{a.vpcId}</span>
                                <span style={{fontSize: 11, color: 'var(--text-2)'}}>{a.state}</span>
                                <button className="button compact danger" disabled={detachMut.isPending} onClick={() => detachMut.mutate(a.vpcId)}>Detach</button>
                            </div>
                        ))}
                    </div>
                )}
                {unattachedVpcs.length > 0 && (
                    <div className="field-row" style={{gap: 6}}>
                        <select className="input" style={{flex: 1, fontSize: 12, minWidth: 0}} value={attachVpcId} onChange={(e) => setAttachVpcId(e.target.value)}>
                            <option value="">Select VPC to attach…</option>
                            {unattachedVpcs.map((v) => <option key={v.vpcId} value={v.vpcId}>{nameTag(v.tags) || v.vpcId}</option>)}
                        </select>
                        <button className="button compact" disabled={!attachVpcId || attachMut.isPending} onClick={() => attachMut.mutate(attachVpcId)}>
                            {attachMut.isPending ? <Loader2 size={12}/> : null}Attach
                        </button>
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
                <Router size={14} style={{color: 'var(--accent)'}}/>
                <h3 style={{marginLeft: 6}}>{nameTag(rtb.tags) || rtb.routeTableId}</h3>
                {isMain && <span className="status pending" style={{marginLeft: 8, fontSize: 10}}>main</span>}
                <div style={{marginLeft: 'auto'}}>
                    <button className="button compact danger" onClick={onDelete} disabled={isMain} title={isMain ? 'Cannot delete the main route table' : undefined}>
                        <Trash2 size={12}/> Delete
                    </button>
                </div>
            </div>
            <div className="widget-body">
                <MetaGrid rows={[
                    ['RTB ID', rtb.routeTableId],
                    ['VPC', vpc ? `${nameTag(vpc.tags) || vpc.vpcId}` : rtb.vpcId],
                ]}/>
                <p className="modal-section-title" style={{marginTop: 12, marginBottom: 6}}>Routes</p>
                {rtb.routes.length === 0 ? (
                    <p style={{fontSize: 12, color: 'var(--text-2)'}}>No routes.</p>
                ) : (
                    <div style={{border: '1px solid var(--border)', borderRadius: 4, marginBottom: 8}}>
                        <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 12}}>
                            <thead>
                                <tr style={{borderBottom: '1px solid var(--border)'}}>
                                    <th style={thS}>Destination</th>
                                    <th style={thS}>Target</th>
                                    <th style={thS}>State</th>
                                    <th style={{...thS, width: 28}}/>
                                </tr>
                            </thead>
                            <tbody>
                                {rtb.routes.map((r, i) => (
                                    <tr key={i} style={{borderBottom: i < rtb.routes.length - 1 ? '1px solid var(--border-faint)' : 'none'}}>
                                        <td style={{...tdS, fontFamily: 'monospace'}}>{r.destinationCidrBlock ?? '—'}</td>
                                        <td style={{...tdS, fontFamily: 'monospace', fontSize: 11}}>{r.gatewayId ?? r.natGatewayId ?? r.vpcPeeringConnectionId ?? '—'}</td>
                                        <td style={{...tdS, color: 'var(--text-2)'}}>{r.state ?? '—'}</td>
                                        <td style={{...tdS, textAlign: 'center'}}>
                                            {r.origin !== 'CreateRouteTable' && r.destinationCidrBlock && (
                                                <button className="icon-btn danger" disabled={deleteRouteMut.isPending} onClick={() => deleteRouteMut.mutate(r.destinationCidrBlock!)}>
                                                    <Trash2 size={11}/>
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <p className="modal-section-title" style={{marginBottom: 6}}>Add route</p>
                <div className="field-row" style={{gap: 6, flexWrap: 'wrap'}}>
                    <input
                        className="input" placeholder="Destination CIDR" style={{width: 150, fontSize: 12, minWidth: 'unset'}}
                        value={newCidr} onChange={(e) => setNewCidr(e.target.value)}
                    />
                    <select className="input" style={{flex: 1, fontSize: 12, minWidth: 120}} value={newTarget} onChange={(e) => setNewTarget(e.target.value)}>
                        <option value="">Select target…</option>
                        {igws.map((g) => <option key={g.internetGatewayId} value={g.internetGatewayId}>{g.internetGatewayId} (IGW)</option>)}
                    </select>
                    <button className="button compact" disabled={!isValidCidr(newCidr) || !newTarget || createRouteMut.isPending} onClick={() => createRouteMut.mutate()}>
                        {createRouteMut.isPending ? <Loader2 size={12}/> : <Plus size={12}/>}
                        Add
                    </button>
                </div>
                {routeErr && <p style={{fontSize: 11, color: '#f87171', marginTop: 4}}>{routeErr}</p>}
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
                <Globe size={14} style={{color: 'var(--accent)'}}/>
                <h3 style={{marginLeft: 6, fontFamily: 'monospace'}}>{eip.publicIp}</h3>
                <div style={{marginLeft: 'auto'}}>
                    <button className="button compact danger" onClick={onRelease} disabled={!!eip.associationId} title={eip.associationId ? 'Disassociate before releasing' : undefined}>
                        <Trash2 size={12}/> Release
                    </button>
                </div>
            </div>
            <div className="widget-body">
                <MetaGrid rows={[
                    ['Allocation ID', eip.allocationId],
                    ['Public IP', eip.publicIp],
                    ['Domain', eip.domain ?? '—'],
                    ['Association ID', eip.associationId ?? '—'],
                    ['Instance', eip.instanceId ?? '—'],
                ]}/>
                <div style={{marginTop: 12}}>
                    {eip.associationId ? (
                        <button className="button compact" disabled={disassociateMut.isPending} onClick={() => disassociateMut.mutate()}>
                            {disassociateMut.isPending ? <Loader2 size={12}/> : null}
                            Disassociate
                        </button>
                    ) : (
                        <div className="field-row" style={{gap: 6}}>
                            <select className="input" style={{flex: 1, fontSize: 12, minWidth: 0}} value={selectedInstance} onChange={(e) => setSelectedInstance(e.target.value)}>
                                <option value="">Associate with instance…</option>
                                {instances.map((inst) => <option key={inst.instanceId} value={inst.instanceId}>{inst.name || inst.instanceId}</option>)}
                            </select>
                            <button className="button compact" disabled={!selectedInstance || associateMut.isPending} onClick={() => associateMut.mutate()}>
                                {associateMut.isPending ? <Loader2 size={12}/> : null}
                                Associate
                            </button>
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
                    <span className="meta-value" style={{fontFamily: label.endsWith('ID') || label === 'CIDR' || label === 'Fingerprint' ? 'monospace' : undefined, fontSize: label.endsWith('ID') ? 11 : undefined}}>
                        {value}
                    </span>
                </div>
            ))}
        </div>
    )
}

function ToggleRow({label, checked, onChange, disabled}: {label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean}) {
    return (
        <div className="field-row" style={{alignItems: 'center', gap: 8}}>
            <label className="toggle-switch" style={{width: 32, height: 18}}>
                <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}/>
                <span className="toggle-track"/>
            </label>
            <span style={{fontSize: 12}}>{label}</span>
            {disabled && <Loader2 size={12} style={{animation: 'spin 1s linear infinite', color: 'var(--text-2)'}}/>}
        </div>
    )
}

// ─── Collapsible section ──────────────────────────────────────────────────────

function NetSection({
    title, icon: Icon, items, section, selected, onSelect, onCreate, isLoading, wizardButton,
}: {
    title: string
    icon: React.ElementType
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
        <div style={{borderBottom: '1px solid var(--border)'}}>
            <div
                style={{display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer', userSelect: 'none'}}
                onClick={() => setOpen((o) => !o)}
            >
                {open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
                <Icon size={13} style={{color: 'var(--text-2)'}}/>
                <span style={{fontSize: 12, fontWeight: 600, flex: 1}}>{title}</span>
                {isLoading && <Loader2 size={11} style={{animation: 'spin 1s linear infinite', color: 'var(--text-2)'}}/>}
                <span style={{fontSize: 11, color: 'var(--text-2)', marginRight: 4}}>{items.length}</span>
                {wizardButton && (
                    <button
                        className="icon-btn" title="VPC Wizard"
                        onClick={(e) => {e.stopPropagation(); wizardButton()}}
                        style={{fontSize: 10, padding: '2px 6px', color: 'var(--accent)'}}
                    >
                        Wizard
                    </button>
                )}
                <button
                    className="icon-btn" title={`Create ${title}`}
                    onClick={(e) => {e.stopPropagation(); onCreate()}}
                >
                    <Plus size={12}/>
                </button>
            </div>
            {open && (
                <div>
                    {items.length === 0 ? (
                        <p style={{fontSize: 11, color: 'var(--text-2)', padding: '4px 28px 10px', margin: 0}}>None</p>
                    ) : (
                        items.map((item) => (
                            <div
                                key={item.id}
                                onClick={() => onSelect(isActive && selected?.id === item.id ? null : {section, id: item.id})}
                                style={{
                                    padding: '5px 10px 5px 28px',
                                    cursor: 'pointer',
                                    background: isActive && selected?.id === item.id ? 'var(--surface-active, var(--surface-2))' : 'transparent',
                                    borderLeft: isActive && selected?.id === item.id ? '2px solid var(--accent)' : '2px solid transparent',
                                    fontSize: 12,
                                }}
                            >
                                <div style={{fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{item.label}</div>
                                {item.sub && <div style={{fontSize: 10, color: 'var(--text-2)', fontFamily: 'monospace'}}>{item.sub}</div>}
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
            <div className="widget" style={{marginTop: 16}}>
                <div className="widget-header"><Network size={14}/><h3 style={{marginLeft: 6}}>Networking</h3></div>
                <div className="widget-body">
                    {/*
                      * Azure has a working VNet adapter, so the table above this panel is
                      * live — saying "coming soon" under it would contradict what the user
                      * can already see. What is genuinely AWS-only is this panel's extra
                      * workflows (subnets, security groups, gateways, route tables, EIPs).
                      */}
                    <p style={{fontSize: 12, color: 'var(--text-2)'}}>
                        {cloud === 'azure'
                            ? 'Virtual networks are managed in the table above. Subnets, security groups, gateways and route tables are AWS-only today.'
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

            <div className="widget" style={{marginTop: 16}}>
                <div className="widget-header">
                    <Network size={14} style={{color: 'var(--accent)'}}/>
                    <h3 style={{marginLeft: 6}}>Networking</h3>
                </div>
                <div className="widget-body" style={{padding: 0}}>
                    <div style={{display: 'flex', height: 'auto', minHeight: 300}}>

                        {/* Left pane — section list */}
                        <div style={{width: 240, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto'}}>
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
                        <div style={{flex: 1, overflowY: 'auto', padding: hasDetail ? 0 : 16}}>
                            {!hasDetail && (
                                <p style={{fontSize: 12, color: 'var(--text-2)'}}>Select a resource to view details.</p>
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
