import { useState } from 'react'
import { Router } from 'lucide-react'
import { useCreateRouteTableMutation } from '@/api/aws/ec2.mutations'
import { useEc2VpcsQuery } from '@/api/aws/ec2.queries'
import type { Ec2RouteTable } from '@/api/aws/ec2.api'

type Props = {
  onClose: () => void
  onCreated?: (rtb: Ec2RouteTable) => void
}

export function CreateRtbModal({ onClose, onCreated }: Props) {
  const [vpcId, setVpcId] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState('')

  const vpcsQuery = useEc2VpcsQuery(true)
  const vpcs = vpcsQuery.data ?? []

  const mutation = useCreateRouteTableMutation()

  async function handleCreate() {
    if (!vpcId) { setErr('Select a VPC.'); return }
    setErr('')
    try {
      const rtb = await mutation.mutateAsync({ vpcId, name: name.trim() || undefined })
      onCreated?.(rtb)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="create-table-modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Router size={14} /> Create Route Table
        </h3>
        <div className="modal-section">
          <div className="field-row">
            <label>VPC <span style={{ color: 'var(--status-error)' }}>*</span></label>
            <select
              className="input"
              value={vpcId}
              onChange={(e) => { setVpcId(e.target.value); setErr('') }}
            >
              <option value="">— select VPC —</option>
              {vpcs.map((v) => (
                <option key={v.vpcId} value={v.vpcId}>{v.vpcId} ({v.cidrBlock})</option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label>Name <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>(optional)</span></label>
            <input
              className="input"
              placeholder="my-route-table"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {err && <p style={{ color: 'var(--status-error)', fontSize: 12, marginTop: 6 }}>{err}</p>}
        </div>
        <div className="modal-footer">
          <button className="button" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={!vpcId || mutation.isPending} onClick={() => void handleCreate()}>
            {mutation.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
