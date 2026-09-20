import { useState } from 'react'
import { Waypoints } from 'lucide-react'
import { useCreateNatGatewayMutation } from '@/api/aws/ec2.mutations'
import { useEc2SubnetsQuery, useEc2ElasticIpsQuery } from '@/api/aws/ec2.queries'
import type { Ec2NatGateway } from '@/api/aws/ec2.api'

type Props = {
  onClose: () => void
  onCreated?: (nat: Ec2NatGateway) => void
}

type EipSource = 'auto' | 'existing'

export function CreateNatGwModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [subnetId, setSubnetId] = useState('')
  const [eipSource, setEipSource] = useState<EipSource>('auto')
  const [allocationId, setAllocationId] = useState('')
  const [err, setErr] = useState('')

  const subnetsQuery = useEc2SubnetsQuery(undefined, true)
  const subnets = subnetsQuery.data ?? []

  const eipsQuery = useEc2ElasticIpsQuery(eipSource === 'existing')
  // Only unattached EIPs can be bound to a NAT GW
  const freeEips = (eipsQuery.data ?? []).filter((e) => !e.associationId && !e.instanceId)

  const mutation = useCreateNatGatewayMutation()

  async function handleCreate() {
    if (!subnetId) { setErr('Select a subnet.'); return }
    if (eipSource === 'existing' && !allocationId) { setErr('Select an Elastic IP.'); return }
    setErr('')
    try {
      const nat = await mutation.mutateAsync({
        name: name.trim() || undefined,
        subnetId,
        allocationId: eipSource === 'existing' ? allocationId : undefined,
      })
      onCreated?.(nat)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="create-table-modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Waypoints size={14} /> Create NAT Gateway
        </h3>

        <div className="modal-section">
          <div className="field-row">
            <label>Name <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>(optional)</span></label>
            <input
              className="input"
              placeholder="my-nat-gateway"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field-row">
            <label>Subnet <span style={{ color: 'var(--status-error)' }}>*</span></label>
            <select
              className="input"
              value={subnetId}
              onChange={(e) => { setSubnetId(e.target.value); setErr('') }}
            >
              <option value="">— select subnet —</option>
              {subnets.map((s) => (
                <option key={s.subnetId} value={s.subnetId}>
                  {s.subnetId} — {s.cidrBlock} ({s.availabilityZone})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="modal-section">
          <p className="modal-section-title">Elastic IP</p>

          <div className="field-row" style={{ alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="radio"
                name="eipSource"
                checked={eipSource === 'auto'}
                onChange={() => { setEipSource('auto'); setAllocationId('') }}
              />
              Allocate new EIP automatically
            </label>
          </div>

          <div className="field-row" style={{ alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="radio"
                name="eipSource"
                checked={eipSource === 'existing'}
                onChange={() => setEipSource('existing')}
              />
              Use existing EIP
            </label>
          </div>

          {eipSource === 'existing' && (
            <div className="field-row" style={{ marginTop: 4 }}>
              <label>Allocation</label>
              {eipsQuery.isLoading ? (
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</p>
              ) : freeEips.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--status-error)' }}>No unattached EIPs. Allocate one first.</p>
              ) : (
                <select
                  className="input"
                  value={allocationId}
                  onChange={(e) => { setAllocationId(e.target.value); setErr('') }}
                >
                  <option value="">— select EIP —</option>
                  {freeEips.map((e) => (
                    <option key={e.allocationId} value={e.allocationId}>
                      {e.publicIp} ({e.allocationId})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {err && <p style={{ color: 'var(--status-error)', fontSize: 12, marginTop: 6 }}>{err}</p>}
        </div>

        <div className="modal-footer">
          <button className="button" onClick={onClose}>Cancel</button>
          <button
            className="button primary"
            disabled={!subnetId || mutation.isPending}
            onClick={() => void handleCreate()}
          >
            {mutation.isPending ? 'Creating… (this may take ~15s)' : 'Create NAT Gateway'}
          </button>
        </div>
      </div>
    </div>
  )
}
