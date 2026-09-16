import { useState } from 'react'
import { Network } from 'lucide-react'
import { useAllocateElasticIpMutation } from '@/api/aws/ec2.mutations'
import type { Ec2ElasticIp } from '@/api/aws/ec2.api'

type Props = {
  onClose: () => void
  onAllocated?: (eip: Ec2ElasticIp) => void
}

export function AllocateEipModal({ onClose, onAllocated }: Props) {
  const [name, setName] = useState('')
  const [err, setErr] = useState('')

  const mutation = useAllocateElasticIpMutation()

  async function handleAllocate() {
    setErr('')
    try {
      const eip = await mutation.mutateAsync(name.trim() || undefined)
      onAllocated?.(eip)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="create-table-modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Network size={14} /> Allocate Elastic IP
        </h3>
        <div className="modal-section">
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            Allocates a new VPC-scoped Elastic IP address. Standard hourly charges apply when not associated.
          </p>
          <div className="field-row">
            <label>Name tag <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>(optional)</span></label>
            <input
              className="input"
              placeholder="my-eip"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {err && <p style={{ color: 'var(--status-error)', fontSize: 12, marginTop: 6 }}>{err}</p>}
        </div>
        <div className="modal-footer">
          <button className="button" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={mutation.isPending} onClick={() => void handleAllocate()}>
            {mutation.isPending ? 'Allocating…' : 'Allocate'}
          </button>
        </div>
      </div>
    </div>
  )
}
