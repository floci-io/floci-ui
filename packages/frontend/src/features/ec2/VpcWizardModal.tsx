import { useState, useMemo } from 'react'
import { Network, CheckCircle2, Loader2, AlertCircle, X, Plus, Trash2 } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createVpcWizard } from '@/api/aws/ec2.api'
import type { SubnetGroup, VpcWizardInput, VpcWizardResult } from '@/api/aws/ec2.api'
import { calculateSubnetCidrs } from '@/lib/network'
import { isValidCidr } from './validators'
import { ec2QueryKeys } from '@/api/aws/ec2.queries'

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  onClose: () => void
  onCreated?: (result: VpcWizardResult) => void
}

type Step = 'form' | 'creating' | 'done' | 'error'

// ─── Constants ────────────────────────────────────────────────────────────────

const AZ_OPTIONS = ['(auto)', 'us-east-1a', 'us-east-1b', 'us-east-1c', 'us-west-2a', 'us-west-2b']
const AZ_LABELS: Record<string, string> = {
  '(auto)': 'auto', 'us-east-1a': '1a', 'us-east-1b': '1b', 'us-east-1c': '1c',
  'us-west-2a': '2a', 'us-west-2b': '2b',
}

const DEFAULT_GROUPS: SubnetGroup[] = [
  { name: 'public', count: 2, isPublic: true },
  { name: 'private', count: 2, isPublic: false },
]

// Muted palette for private groups so they're visually distinct from each other
const PRIVATE_COLORS = ['#94a3b8', '#a78bfa', '#fb923c', '#f472b6']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ResourceRow({ label, id }: { label: string; id: string }) {
  return (
    <tr>
      <td style={{ color: 'var(--text-muted)', paddingRight: 16, whiteSpace: 'nowrap', fontSize: 12 }}>
        {label}
      </td>
      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{id}</td>
    </tr>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

export function VpcWizardModal({ onClose, onCreated }: Props) {
  const qc = useQueryClient()

  // Form state
  const [name, setName] = useState('')
  const [cidrBlock, setCidrBlock] = useState('10.0.0.0/16')
  const [groups, setGroups] = useState<SubnetGroup[]>(DEFAULT_GROUPS)
  // Status
  const [step, setStep] = useState<Step>('form')
  const [result, setResult] = useState<VpcWizardResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  // Derived
  const cidrValid = isValidCidr(cidrBlock)
  const totalSubnets = groups.reduce((s, g) => s + g.count, 0)

  const preview = useMemo(
    () => (cidrValid && totalSubnets > 0 ? calculateSubnetCidrs(cidrBlock, groups) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cidrBlock, cidrValid, JSON.stringify(groups)],
  )

  const mutation = useMutation({
    mutationFn: (input: VpcWizardInput) => createVpcWizard(input),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ec2QueryKeys.vpcs })
      void qc.invalidateQueries({ queryKey: ['ec2', 'subnets'] })
      void qc.invalidateQueries({ queryKey: ec2QueryKeys.internetGateways })
      void qc.invalidateQueries({ queryKey: ec2QueryKeys.natGateways() })
      void qc.invalidateQueries({ queryKey: ec2QueryKeys.routeTables() })
      void qc.invalidateQueries({ queryKey: ec2QueryKeys.elasticIps })
      setResult(data)
      setStep('done')
      onCreated?.(data)
    },
    onError: (err: Error) => {
      setErrorMsg(err.message)
      setStep('error')
    },
  })

  function handleCreate() {
    if (!cidrValid || !name.trim() || groups.length === 0) return
    setStep('creating')
    mutation.mutate({
      name: name.trim(),
      cidrBlock,
      subnetGroups: groups,
      natGateway: false,
    })
  }

  // ── Group list helpers ──────────────────────────────────────────────────────

  function updateGroup(idx: number, patch: Partial<SubnetGroup>) {
    setGroups((prev) => prev.map((g, i) => (i === idx ? { ...g, ...patch } : g)))
  }

  function addGroup() {
    setGroups((prev) => [...prev, { name: '', count: 1, isPublic: false }])
  }

  function removeGroup(idx: number) {
    setGroups((prev) => prev.filter((_, i) => i !== idx))
  }

  const canSubmit = cidrValid && name.trim().length > 0 && groups.length > 0 &&
    groups.every((g) => g.name.trim().length > 0 && g.count >= 1)

  // ── Private-group color assignment ─────────────────────────────────────────
  // Track a stable color per private group by their declaration order
  const privateColors = useMemo(() => {
    let pi = 0
    return groups.map((g) => g.isPublic ? '#34d399' : PRIVATE_COLORS[pi++ % PRIVATE_COLORS.length])
  }, [groups])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="create-table-modal"
        style={{ width: 860, maxWidth: '96vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Network size={15} style={{ color: 'var(--accent)' }} />
          <span>VPC Wizard</span>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close" title="Close">
            <X size={13} />
          </button>
        </div>

        {/* ── Form ──────────────────────────────────────────────────────── */}
        {step === 'form' && (
          <>
            <div style={{ display: 'flex', gap: 0 }}>
              {/* Left panel — inputs */}
              <div style={{ flex: '0 0 380px', padding: '16px 20px', borderRight: '1px solid var(--border)', overflowY: 'auto', maxHeight: '70vh' }}>

                <div className="modal-section">
                  <div className="section-title">Identity</div>
                  <div className="field-row">
                    <label>Name</label>
                    <input
                      className="input"
                      placeholder="my-vpc"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="field-row">
                    <label>IPv4 CIDR block</label>
                    <input
                      className="input"
                      placeholder="10.0.0.0/16"
                      value={cidrBlock}
                      onChange={(e) => setCidrBlock(e.target.value)}
                      style={{ borderColor: cidrBlock && !cidrValid ? 'var(--status-error)' : undefined }}
                    />
                    {cidrBlock && !cidrValid && (
                      <span style={{ color: 'var(--status-error)', fontSize: 11, marginTop: 2 }}>
                        Invalid CIDR
                      </span>
                    )}
                  </div>
                </div>

                <div className="modal-section">
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                    <div className="section-title" style={{ margin: 0 }}>Subnet groups</div>
                    <button
                      className="button compact"
                      style={{ marginLeft: 'auto', fontSize: 11 }}
                      onClick={addGroup}
                    >
                      <Plus size={11} /> Add group
                    </button>
                  </div>

                  {groups.length === 0 && (
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                      No groups defined. Add at least one.
                    </p>
                  )}

                  {groups.length > 0 && (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) 44px 80px 54px 52px auto',
                      gap: 4,
                      padding: '0 6px',
                      marginBottom: 2,
                    }}>
                      {['Name', '#', 'Type', 'Mask', 'AZ', ''].map((h) => (
                        <span key={h} style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</span>
                      ))}
                    </div>
                  )}

                  {groups.map((g, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(60px, 1fr) 38px 70px 46px 44px auto',
                        gap: 4,
                        alignItems: 'center',
                        marginBottom: 4,
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border)',
                        borderRadius: 5,
                        padding: '5px 6px',
                      }}
                    >
                      {/* Name */}
                      <input
                        style={{
                          minWidth: 0, fontSize: 12, padding: '3px 7px',
                          background: 'transparent', border: 'none', outline: 'none',
                          color: 'var(--text)',
                        }}
                        placeholder="group name"
                        value={g.name}
                        onChange={(e) => updateGroup(idx, { name: e.target.value })}
                      />
                      {/* Count */}
                      <select
                        className="input"
                        style={{ minWidth: 0, width: '100%', fontSize: 12, padding: '2px 4px', height: 26 }}
                        value={g.count}
                        onChange={(e) => updateGroup(idx, { count: Number(e.target.value) })}
                      >
                        {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                      {/* Public / Private toggle */}
                      <select
                        className="input"
                        style={{
                          minWidth: 0, width: '100%', fontSize: 11, padding: '2px 4px', height: 26,
                          color: g.isPublic ? '#34d399' : 'var(--text-muted)',
                        }}
                        value={g.isPublic ? 'public' : 'private'}
                        onChange={(e) => updateGroup(idx, { isPublic: e.target.value === 'public' })}
                      >
                        <option value="public">Public</option>
                        <option value="private">Private</option>
                      </select>
                      {/* Prefix / mask */}
                      <select
                        className="input"
                        style={{ minWidth: 0, width: '100%', fontSize: 11, padding: '2px 2px', height: 26 }}
                        value={g.prefix ?? 'auto'}
                        onChange={(e) => updateGroup(idx, { prefix: e.target.value === 'auto' ? undefined : Number(e.target.value) })}
                        title="Subnet prefix length"
                      >
                        <option value="auto">auto</option>
                        {[20, 21, 22, 23, 24, 25, 26, 27, 28].map((p) => (
                          <option key={p} value={p}>/{p}</option>
                        ))}
                      </select>
                      {/* AZ */}
                      <select
                        className="input"
                        style={{ minWidth: 0, width: '100%', fontSize: 11, padding: '2px 2px', height: 26 }}
                        value={g.az ?? '(auto)'}
                        onChange={(e) => updateGroup(idx, { az: e.target.value === '(auto)' ? undefined : e.target.value })}
                        title="Availability zone"
                      >
                        {AZ_OPTIONS.map((a) => (
                          <option key={a} value={a}>{AZ_LABELS[a]}</option>
                        ))}
                      </select>
                      {/* Remove */}
                      <button
                        className="icon-btn danger"
                        onClick={() => removeGroup(idx)}
                        title="Remove group"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}

                  {/* Validation hints */}
                  {groups.some((g) => !g.name.trim()) && (
                    <p style={{ fontSize: 11, color: 'var(--status-error)', marginTop: 4 }}>
                      All groups need a name.
                    </p>
                  )}
                </div>


              </div>

              {/* Right panel — preview */}
              <div style={{ flex: 1, padding: '16px 20px', background: 'var(--bg-subtle, var(--bg-secondary))', overflowY: 'auto', maxHeight: '70vh' }}>
                <div className="section-title" style={{ marginBottom: 12 }}>Preview</div>

                {/* VPC block */}
                <div style={{
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  background: 'var(--bg-primary)',
                  padding: '10px 14px',
                  marginBottom: 10,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>VPC</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{cidrValid ? cidrBlock : '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    + Internet Gateway
                  </div>
                </div>

                {/* Subnet group columns */}
                {preview && preview.length > 0 ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {preview.map((grp, idx) => {
                      const color = privateColors[idx]
                      const borderColor = `${color}60`
                      const bgColor = `${color}10`
                      return (
                        <div key={idx} style={{ minWidth: 100, flex: '1 1 100px' }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color, marginBottom: 6 }}>
                            {grp.name || <em>unnamed</em>} ({grp.cidrs.length})
                            <span style={{ fontWeight: 400, marginLeft: 4, opacity: 0.7 }}>
                              {grp.isPublic ? '· public' : '· private'}
                            </span>
                          </div>
                          {grp.cidrs.map((cidr, i) => (
                            <div key={i} style={{
                              border: `1px solid ${borderColor}`,
                              borderRadius: 4,
                              padding: '5px 9px',
                              marginBottom: 5,
                              background: bgColor,
                              fontFamily: 'monospace',
                              fontSize: 11,
                            }}>
                              {cidr}
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {cidrValid ? 'Add subnet groups to preview.' : 'Enter a valid CIDR to preview.'}
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="button" onClick={onClose}>Cancel</button>
              <button className="button primary" disabled={!canSubmit} onClick={handleCreate}>
                Create VPC
              </button>
            </div>
          </>
        )}

        {/* ── Creating ─────────────────────────────────────────────────── */}
        {step === 'creating' && (
          <div style={{ padding: 48, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} />
            <div style={{ fontSize: 13, fontWeight: 500 }}>Creating VPC infrastructure…</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              Provisioning VPC, Internet Gateway, {totalSubnets} subnet{totalSubnets !== 1 ? 's' : ''}, route tables…
            </div>
          </div>
        )}

        {/* ── Done ─────────────────────────────────────────────────────── */}
        {step === 'done' && result && (
          <>
            <div style={{ padding: '24px 28px', maxHeight: '70vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <CheckCircle2 size={18} style={{ color: '#34d399' }} />
                <span style={{ fontWeight: 600 }}>VPC created successfully</span>
              </div>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <tbody>
                  <ResourceRow label="VPC" id={result.vpcId} />
                  <ResourceRow label="Internet Gateway" id={result.igwId} />
                  <ResourceRow label="Public Route Table" id={result.publicRouteTableId} />
                  {result.privateRouteTableId && (
                    <ResourceRow label="Private Route Table" id={result.privateRouteTableId} />
                  )}
                  {result.natGatewayId && (
                    <ResourceRow label="NAT Gateway" id={result.natGatewayId} />
                  )}
                  {result.eipAllocationId && (
                    <ResourceRow label="Elastic IP" id={result.eipAllocationId} />
                  )}
                  {result.subnetGroups.map((grp) =>
                    grp.subnetIds.map((id, i) => (
                      <ResourceRow
                        key={id}
                        label={`${grp.name} ${i + 1}`}
                        id={id}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="modal-footer">
              <button className="button primary" onClick={onClose}>Close</button>
            </div>
          </>
        )}

        {/* ── Error ────────────────────────────────────────────────────── */}
        {step === 'error' && (
          <>
            <div style={{ padding: '24px 28px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <AlertCircle size={18} style={{ color: 'var(--status-error)' }} />
                <span style={{ fontWeight: 600 }}>Creation failed</span>
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--status-error)', background: 'var(--bg-secondary)', padding: 12, borderRadius: 4 }}>
                {errorMsg}
              </div>
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
