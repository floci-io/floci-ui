import { useState } from 'react'
import {Icon, Waypoints} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import {OptionSelect} from '@/components/OptionSelect'
import { useCreateNatGatewayMutation } from '@/api/aws/ec2.mutations'
import { useEc2SubnetsQuery, useEc2ElasticIpsQuery } from '@/api/aws/ec2.queries'
import type { Ec2NatGateway } from '@/api/aws/ec2.api'
import { ModalOverlay } from '@/components/ModalOverlay'
import {RadioGroup, RadioGroupOption} from '@/components/sodium/ui/radio-group'

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
    <ModalOverlay onClose={onClose}>
      <div className="create-table-modal w-130" onClick={(e) => e.stopPropagation()}>
        <h2 className="flex items-center gap-1.5">
          <Icon icon={Waypoints} size={14} /> Create NAT Gateway
        </h2>

        <div className="modal-section">
          <div className="field-row">
            <label>Name <span className="text-text-3 type-caption">(optional)</span></label>
            <Input aria-label="Name"
              placeholder="my-nat-gateway"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field-row">
            <label>Subnet <span className="text-fail-text">*</span></label>
            <OptionSelect aria-label="Subnet"
              value={subnetId}
              onValueChange={(value) => { setSubnetId(value); setErr('') }}
            >
              <option value="">, select subnet, </option>
              {subnets.map((s) => (
                <option key={s.subnetId} value={s.subnetId}>
                  {s.subnetId} , {s.cidrBlock} ({s.availabilityZone})
                </option>
              ))}
            </OptionSelect>
          </div>
        </div>

        <div className="modal-section">
          <p className="modal-section-title">Elastic IP</p>

          <RadioGroup
            aria-label="Elastic IP source"
            value={eipSource}
            onValueChange={(next) => {
              if (next === 'auto') { setEipSource('auto'); setAllocationId('') } else setEipSource('existing')
            }}
          >
            <RadioGroupOption value="auto" label="Allocate new EIP automatically"/>
            <RadioGroupOption value="existing" label="Use existing EIP"/>
          </RadioGroup>

          {eipSource === 'existing' && (
            <div className="field-row mt-1">
              <label>Allocation</label>
              {eipsQuery.isLoading ? (
                <p className="type-caption text-text-3">Loading…</p>
              ) : freeEips.length === 0 ? (
                <p className="type-caption text-fail-text">No unattached EIPs. Allocate one first.</p>
              ) : (
                <OptionSelect aria-label="Elastic IP"
                  value={allocationId}
                  onValueChange={(value) => { setAllocationId(value); setErr('') }}
                >
                  <option value="">, select EIP, </option>
                  {freeEips.map((e) => (
                    <option key={e.allocationId} value={e.allocationId}>
                      {e.publicIp} ({e.allocationId})
                    </option>
                  ))}
                </OptionSelect>
              )}
            </div>
          )}

          {err && <p className="text-fail-text type-caption mt-1.5">{err}</p>}
        </div>

        <div className="modal-footer">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!subnetId || mutation.isPending}
            onClick={() => void handleCreate()}
          >
            {mutation.isPending ? 'Creating… (this may take ~15s)' : 'Create NAT Gateway'}
          </Button>
        </div>
      </div>
    </ModalOverlay>
  )
}
