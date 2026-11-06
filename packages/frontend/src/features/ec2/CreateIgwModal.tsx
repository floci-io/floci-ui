import { useState } from 'react'
import {Icon, Cloud} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import {OptionSelect} from '@/components/OptionSelect'
import { useCreateInternetGatewayMutation, useAttachInternetGatewayMutation } from '@/api/aws/ec2.mutations'
import { useEc2VpcsQuery } from '@/api/aws/ec2.queries'
import type { Ec2InternetGateway } from '@/api/aws/ec2.api'
import { ModalOverlay } from '@/components/ModalOverlay'

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
    <ModalOverlay onClose={onClose}>
      <div className="create-table-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="flex items-center gap-1.5">
          <Icon icon={Cloud} size={14} /> Create Internet Gateway
        </h2>
        <div className="modal-section">
          <div className="field-row">
            <label>Name <span className="text-text-3 type-caption">(optional)</span></label>
            <Input aria-label="Name"
              placeholder="my-igw"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field-row">
            <label>Attach to VPC <span className="text-text-3 type-caption">(optional)</span></label>
            <OptionSelect aria-label="Attach to VPC" value={vpcId} onValueChange={(value) => setVpcId(value)}>
              <option value="">, skip attach, </option>
              {vpcs.map((v) => (
                <option key={v.vpcId} value={v.vpcId}>{v.vpcId} ({v.cidrBlock})</option>
              ))}
            </OptionSelect>
          </div>
          {err && <p className="text-fail-text type-caption mt-1.5">{err}</p>}
        </div>
        <div className="modal-footer">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={isPending} onClick={() => void handleCreate()}>
            {isPending ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </div>
    </ModalOverlay>
  )
}
