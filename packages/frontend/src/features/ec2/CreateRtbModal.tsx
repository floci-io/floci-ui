import { useState } from 'react'
import {Icon, Router} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import {OptionSelect} from '@/components/OptionSelect'
import { useCreateRouteTableMutation } from '@/api/aws/ec2.mutations'
import { useEc2VpcsQuery } from '@/api/aws/ec2.queries'
import type { Ec2RouteTable } from '@/api/aws/ec2.api'
import { ModalOverlay } from '@/components/ModalOverlay'

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
    <ModalOverlay onClose={onClose}>
      <div className="create-table-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="flex items-center gap-1.5">
          <Icon icon={Router} size={14} /> Create Route Table
        </h2>
        <div className="modal-section">
          <div className="field-row">
            <label>VPC <span className="text-fail-text">*</span></label>
            <OptionSelect aria-label="VPC"
              value={vpcId}
              onValueChange={(value) => { setVpcId(value); setErr('') }}
            >
              <option value="">, select VPC, </option>
              {vpcs.map((v) => (
                <option key={v.vpcId} value={v.vpcId}>{v.vpcId} ({v.cidrBlock})</option>
              ))}
            </OptionSelect>
          </div>
          <div className="field-row">
            <label>Name <span className="text-text-3 type-caption">(optional)</span></label>
            <Input aria-label="Name"
              placeholder="my-route-table"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {err && <p className="text-fail-text type-caption mt-1.5">{err}</p>}
        </div>
        <div className="modal-footer">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!vpcId || mutation.isPending} onClick={() => void handleCreate()}>
            {mutation.isPending ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </div>
    </ModalOverlay>
  )
}
