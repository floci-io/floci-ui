import { useState, useMemo } from 'react'
import {Icon, Network, CheckCircle2, Loader2, AlertCircle, XSquared as X, PlusSquared as Plus, Trash2} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import {OptionSelect} from '@/components/OptionSelect'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createVpcWizard } from '@/api/aws/ec2.api'
import type { SubnetGroup, VpcWizardInput, VpcWizardResult } from '@/api/aws/ec2.api'
import { calculateSubnetCidrs, isSubnetLayoutWithinBlock } from '@/lib/network'
import { isValidCidr } from './validators'
import { ec2QueryKeys } from '@/api/aws/ec2.queries'
import { ModalOverlay } from '@/components/ModalOverlay'
import {Hint} from '@/components/Hint'

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
const GROUP_TONES = ['text-data-1', 'text-data-2', 'text-data-3', 'text-data-4'] as const

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ResourceRow({ label, id }: { label: string; id: string }) {
  return (
    <tr>
      <td className="text-text-3 pr-4 whitespace-nowrap type-caption">
        {label}
      </td>
      <td className="type-code-sm">{id}</td>
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
  const previewValid = preview !== null && isSubnetLayoutWithinBlock(cidrBlock, groups)

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
    if (!cidrValid || !name.trim() || groups.length === 0 || !previewValid) return
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
    groups.every((g) => g.name.trim().length > 0 && g.count >= 1) && previewValid

  // ── Private-group color assignment ─────────────────────────────────────────
  // Track a stable color per private group by their declaration order
  const groupTones = useMemo(() => {
    let pi = 0
    return groups.map((g) => g.isPublic ? 'text-ok-text' : GROUP_TONES[pi++ % GROUP_TONES.length])
  }, [groups])

  return (
    <ModalOverlay onClose={onClose}>
      <div
        className="create-table-modal w-215 max-w-[96vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header flex items-center gap-2">
          <Icon icon={Network} className="text-accent-text"  />
          <span>VPC Wizard</span>
          <Hint label="Close"><Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onClose} aria-label="Close">
            <Icon icon={X} size={14} />
          </Button></Hint>
        </div>

        {/* ── Form ──────────────────────────────────────────────────────── */}
        {step === 'form' && (
          <>
            <div className="flex gap-0">
              {/* Left panel — inputs */}
              <div className="py-4 px-5 border-r border-line overflow-y-auto grow-0 shrink-0 basis-95 max-h-[70vh]">

                <div className="modal-section">
                  <div className="section-title">Identity</div>
                  <div className="field-row">
                    <label>Name</label>
                    <Input aria-label="Name"
                      placeholder="my-vpc"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="field-row">
                    <label>IPv4 CIDR block</label>
                    <Input aria-label="IPv4 CIDR block"
                      placeholder="10.0.0.0/16"
                      value={cidrBlock}
                      onChange={(e) => setCidrBlock(e.target.value)}
                      aria-invalid={(cidrBlock && !cidrValid) ? true : undefined}
                    />
                    {cidrBlock && !cidrValid && (
                      <span className="text-fail-text type-caption mt-0.5">
                        Invalid CIDR
                      </span>
                    )}
                  </div>
                </div>

                <div className="modal-section">
                  <div className="flex items-center mb-2">
                    <div className="section-title m-0">Subnet groups</div>
                    <Button variant="secondary" size="sm"
                      className="ml-auto"
                      onClick={addGroup}
                    >
                      <Icon icon={Plus} size={14} /> Add group
                    </Button>
                  </div>

                  {groups.length === 0 && (
                    <p className="text-text-3 mb-2">
                      No groups defined. Add at least one.
                    </p>
                  )}

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

                  {/* Validation hints */}
                  {groups.some((g) => !g.name.trim()) && (
                    <p className="type-caption text-fail-text mt-1">
                      All groups need a name.
                    </p>
                  )}
                </div>


              </div>

              {/* Right panel — preview */}
              <div className="flex-1 py-4 px-5 overflow-y-auto bg-well max-h-[70vh]">
                <div className="section-title mb-3">Preview</div>

                {/* VPC block */}
                <div className="py-2.5 px-3.5 mb-2.5 border border-line bg-page">
                  <div className="type-caption text-accent-text mb-1">VPC</div>
                  <div className="type-code-sm">{cidrValid ? cidrBlock : ', '}</div>
                  <div className="type-caption text-text-3 mt-0.5">
                    + Internet Gateway
                  </div>
                </div>

                {/* Subnet group columns */}
                {preview && preview.length > 0 ? (
                  <div className="flex gap-2 flex-wrap">
                    {preview.map((grp, idx) => {
                      const tone = groupTones[idx]
                      return (
                        <div className="min-w-25 grow shrink basis-25" key={idx}>
                          <div className={`type-caption mb-1.5 ${tone}`}>
                            {grp.name || <em>unnamed</em>} ({grp.cidrs.length})
                            <span className="ml-1 opacity-70">
                              {grp.isPublic ? '· public' : '· private'}
                            </span>
                          </div>
                          {grp.cidrs.map((cidr, i) => (
                            <div className="py-1.5 px-2.5 mb-1.5 type-code-sm border border-line" key={i}>
                              {cidr}
                            </div>
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

        {/* ── Creating ─────────────────────────────────────────────────── */}
        {step === 'creating' && (
          <div className="p-12 flex flex-col items-center gap-3.5">
            <Icon icon={Loader2} className="text-accent-text animate-pending" size={24} />
            <div className="type-caption">Creating VPC infrastructure…</div>
            <div className="type-caption text-text-3 text-center">
              Provisioning VPC, Internet Gateway, {totalSubnets} subnet{totalSubnets !== 1 ? 's' : ''}, route tables…
            </div>
          </div>
        )}

        {/* ── Done ─────────────────────────────────────────────────────── */}
        {step === 'done' && result && (
          <>
            <div className="py-6 px-7 overflow-y-auto max-h-[70vh]">
              <div className="flex items-center gap-2 mb-5">
                <Icon icon={CheckCircle2} className="text-ok-text"  />
                <span>VPC created successfully</span>
              </div>
              <table className="border-collapse w-full">
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
              <Button onClick={onClose}>Close</Button>
            </div>
          </>
        )}

        {/* ── Error ────────────────────────────────────────────────────── */}
        {step === 'error' && (
          <>
            <div className="py-6 px-7">
              <div className="flex items-center gap-2 mb-3">
                <Icon icon={AlertCircle} className="text-fail-text"  />
                <span>Creation failed</span>
              </div>
              <div className="type-code-sm text-fail-text p-3 bg-well">
                {errorMsg}
              </div>
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
