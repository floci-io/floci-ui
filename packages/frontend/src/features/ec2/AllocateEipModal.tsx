import { useState } from 'react'
import {Icon, Network} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import { useAllocateElasticIpMutation } from '@/api/aws/ec2.mutations'
import type { Ec2ElasticIp } from '@/api/aws/ec2.api'
import { ModalOverlay } from '@/components/ModalOverlay'

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
    <ModalOverlay onClose={onClose}>
      <div className="create-table-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="flex items-center gap-1.5">
          <Icon icon={Network} size={14} /> Allocate Elastic IP
        </h2>
        <div className="modal-section">
          <p className="type-caption text-text-3 mb-3">
            Allocates a new VPC-scoped Elastic IP address. Standard hourly charges apply when not associated.
          </p>
          <div className="field-row">
            <label>Name tag <span className="text-text-3 type-caption">(optional)</span></label>
            <Input aria-label="Name tag"
              placeholder="my-eip"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {err && <p className="text-fail-text type-caption mt-1.5">{err}</p>}
        </div>
        <div className="modal-footer">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={mutation.isPending} onClick={() => void handleAllocate()}>
            {mutation.isPending ? 'Allocating…' : 'Allocate'}
          </Button>
        </div>
      </div>
    </ModalOverlay>
  )
}
