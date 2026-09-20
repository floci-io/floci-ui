import { useState } from 'react'
import { Cloud } from 'lucide-react'
import { useCreateInternetGatewayMutation, useAttachInternetGatewayMutation } from '@/api/aws/ec2.mutations'
import { useEc2VpcsQuery } from '@/api/aws/ec2.queries'
import type { Ec2InternetGateway } from '@/api/aws/ec2.api'

type Props = {
  onClose: () => void
  onCreated?: (igw: Ec2InternetGateway) => void
}

export function CreateIgwModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [vpcId, setVpcId] = useState('')
  const [err, setErr] = useState('')

  const vpcsQuery = useEc2VpcsQuery(true)
  const vpcs = vpcsQuery.data ?? []

  const createMut = useCreateInternetGatewayMutation()
  const attachMut = useAttachInternetGatewayMutation()

  const isPending = createMut.isPending || attachMut.isPending

  async function handleCreate() {
    setErr('')
    try {
      const igw = await createMut.mutateAsync(name.trim() || undefined)
      if (vpcId) {
        await attachMut.mutateAsync({ igwId: igw.internetGatewayId, vpcId })
      }
      onCreated?.(igw)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="create-table-modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Cloud size={14} /> Create Internet Gateway
        </h3>
        <div className="modal-section">
          <div className="field-row">
            <label>Name <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>(optional)</span></label>
            <input
              className="input"
              placeholder="my-igw"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field-row">
            <label>Attach to VPC <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>(optional)</span></label>
            <select className="input" value={vpcId} onChange={(e) => setVpcId(e.target.value)}>
              <option value="">— skip attach —</option>
              {vpcs.map((v) => (
                <option key={v.vpcId} value={v.vpcId}>{v.vpcId} ({v.cidrBlock})</option>
              ))}
            </select>
          </div>
          {err && <p style={{ color: 'var(--status-error)', fontSize: 12, marginTop: 6 }}>{err}</p>}
        </div>
        <div className="modal-footer">
          <button className="button" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={isPending} onClick={() => void handleCreate()}>
            {isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
