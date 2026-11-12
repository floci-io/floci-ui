import { useState } from 'react'
import {Icon, PlusSquared as Plus, Trash2} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import {OptionSelect} from '@/components/OptionSelect'
import {
  useCreateRouteMutation,
  useDeleteRouteMutation,
  useAssociateRouteTableMutation,
  useDisassociateRouteTableMutation,
} from '@/api/aws/ec2.mutations'
import { isValidCidr } from './validators'
import type { Ec2Route, Ec2RouteTableAssociation, Ec2InternetGateway, Ec2NatGateway, Ec2Subnet } from '@/api/aws/ec2.api'
import {Hint} from '@/components/Hint'

// ─── Types ────────────────────────────────────────────────────────────────────

type TargetKind = 'igw' | 'nat' | 'peering'

type Props = {
  rtbId: string
  routes: Ec2Route[]
  associations: Ec2RouteTableAssociation[]
  igws: Ec2InternetGateway[]
  natGws: Ec2NatGateway[]
  subnets: Ec2Subnet[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function targetLabel(r: Ec2Route): string {
  if (r.gatewayId === 'local') return 'local'
  if (r.gatewayId) return r.gatewayId
  if (r.natGatewayId) return r.natGatewayId
  if (r.vpcPeeringConnectionId) return r.vpcPeeringConnectionId
  return ', '
}

function canDeleteRoute(r: Ec2Route): boolean {
  return r.gatewayId !== 'local' && r.origin !== 'CreateRouteTable'
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RouteTableEditor({ rtbId, routes, associations, igws, natGws, subnets }: Props) {
  // New-route form state
  const [newCidr, setNewCidr] = useState('')
  const [targetKind, setTargetKind] = useState<TargetKind>('igw')
  const [targetId, setTargetId] = useState('')
  const [routeErr, setRouteErr] = useState('')

  // New association form state
  const [newSubnetId, setNewSubnetId] = useState('')
  const [assocErr, setAssocErr] = useState('')

  const createRouteMut = useCreateRouteMutation()
  const deleteRouteMut = useDeleteRouteMutation()
  const associateMut = useAssociateRouteTableMutation()
  const disassociateMut = useDisassociateRouteTableMutation()

  // Subnets not yet associated with this RT
  const associatedSubnetIds = new Set(associations.map((a) => a.subnetId).filter(Boolean))
  const availableSubnets = subnets.filter((s) => !associatedSubnetIds.has(s.subnetId))

  // Targets by kind
  const targets: { id: string; label: string }[] =
    targetKind === 'igw'
      ? igws.map((g) => ({ id: g.internetGatewayId, label: g.internetGatewayId }))
      : targetKind === 'nat'
      ? natGws.filter((n) => n.state === 'available').map((n) => ({
          id: n.natGatewayId,
          label: `${n.natGatewayId} (${n.publicIp ?? ''})`,
        }))
      : []

  const cidrValid = isValidCidr(newCidr)
  const isDuplicateRoute = cidrValid && routes.some((r) => r.destinationCidrBlock === newCidr.trim())
  const canAddRoute = cidrValid && targetId !== '' && !isDuplicateRoute

  async function handleAddRoute() {
    if (!canAddRoute) return
    setRouteErr('')
    try {
      await createRouteMut.mutateAsync({
        rtbId,
        input: {
          destinationCidrBlock: newCidr.trim(),
          gatewayId: targetKind === 'igw' ? targetId : undefined,
          natGatewayId: targetKind === 'nat' ? targetId : undefined,
          vpcPeeringConnectionId: targetKind === 'peering' ? targetId : undefined,
        },
      })
      setNewCidr('')
      setTargetId('')
    } catch (e) {
      setRouteErr(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function handleDeleteRoute(cidr: string) {
    try {
      await deleteRouteMut.mutateAsync({ rtbId, cidr })
    } catch {
      // non-blocking; RT will refresh on invalidation
    }
  }

  async function handleAssociate() {
    if (!newSubnetId) return
    setAssocErr('')
    try {
      await associateMut.mutateAsync({ rtbId, subnetId: newSubnetId })
      setNewSubnetId('')
    } catch (e) {
      setAssocErr(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function handleDisassociate(associationId: string) {
    try {
      await disassociateMut.mutateAsync(associationId)
    } catch {
      // non-blocking
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ── Routes ──────────────────────────────────────────────────── */}
      <div className="table-panel">
        <div className="widget-header">
          <h2>Routes</h2>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Destination</th>
              <th>Target</th>
              <th>Status</th>
              <th>Origin</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r, i) => (
              <tr key={i}>
                <td className="mono type-caption">{r.destinationCidrBlock ?? ', '}</td>
                <td className="mono type-caption">{targetLabel(r)}</td>
                <td>
                  <span className={`status ${r.state === 'active' ? 'healthy' : 'unknown'}`}>
                    {r.state ?? ', '}
                  </span>
                </td>
                <td className="type-caption text-text-3">{r.origin ?? ', '}</td>
                <td>
                  {canDeleteRoute(r) && (
                    <Hint label="Delete route"><Button variant="ghost" size="icon-sm" aria-label="Delete route"
                      disabled={deleteRouteMut.isPending}
                      onClick={() => void handleDeleteRoute(r.destinationCidrBlock ?? '')}
                    >
                      <Icon icon={Trash2} size={14} />
                    </Button></Hint>
                  )}
                </td>
              </tr>
            ))}
            {/* New route row */}
            <tr>
              <td>
                <Input aria-label="Destination CIDR"
                 
                  aria-invalid={(newCidr && (!cidrValid || isDuplicateRoute)) ? true : undefined}
                  placeholder="0.0.0.0/0"
                  value={newCidr}
                  onChange={(e) => { setNewCidr(e.target.value); setRouteErr('') }}
                />
              </td>
              <td className="flex gap-1 items-center py-1 px-2" colSpan={3}>
                <OptionSelect aria-label="Target type" className="flex-none"
                  value={targetKind}
                  onValueChange={(value) => { setTargetKind(value as TargetKind); setTargetId('') }}
                >
                  <option value="igw">Internet Gateway</option>
                  <option value="nat">NAT Gateway</option>
                  {/* VPC peering shown only if we add peering support later */}
                </OptionSelect>
                <OptionSelect aria-label="Target" className="flex-1"
                  value={targetId}
                  onValueChange={(value) => setTargetId(value)}
                >
                  <option value="">, select target, </option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </OptionSelect>
              </td>
              <td>
                <Hint label="Add route"><Button variant="ghost" size="icon-sm" aria-label="Add route"
                  disabled={!canAddRoute || createRouteMut.isPending}
                  onClick={() => void handleAddRoute()}
                >
                  <Icon icon={Plus} size={14} />
                </Button></Hint>
              </td>
            </tr>
          </tbody>
        </table>
        {isDuplicateRoute && <p className="text-fail-text type-caption py-1 px-2">Route already exists</p>}
        {routeErr && <p className="text-fail-text type-caption py-1 px-2">{routeErr}</p>}
      </div>

      {/* ── Subnet Associations ──────────────────────────────────────── */}
      <div className="table-panel">
        <div className="widget-header">
          <h2>Subnet associations</h2>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Association ID</th>
              <th>Subnet ID</th>
              <th>Main</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {associations.map((a) => (
              <tr key={a.associationId}>
                <td className="mono type-caption">{a.associationId}</td>
                <td className="mono type-caption">{a.subnetId ?? ', '}</td>
                <td>{a.isMain ? <span className="status healthy">Yes</span> : ', '}</td>
                <td>
                  {!a.isMain && (
                    <Hint label="Disassociate"><Button variant="ghost" size="icon-sm" aria-label="Disassociate"
                      disabled={disassociateMut.isPending}
                      onClick={() => void handleDisassociate(a.associationId)}
                    >
                      <Icon icon={Trash2} size={14} />
                    </Button></Hint>
                  )}
                </td>
              </tr>
            ))}
            {/* Associate new subnet */}
            {availableSubnets.length > 0 && (
              <tr>
                <td colSpan={3}>
                  <OptionSelect aria-label="Subnet to associate" className="w-full"
                    value={newSubnetId}
                    onValueChange={(value) => { setNewSubnetId(value); setAssocErr('') }}
                  >
                    <option value="">, associate a subnet, </option>
                    {availableSubnets.map((s) => (
                      <option key={s.subnetId} value={s.subnetId}>
                        {s.subnetId} , {s.cidrBlock}
                      </option>
                    ))}
                  </OptionSelect>
                </td>
                <td>
                  <Hint label="Associate"><Button variant="ghost" size="icon-sm" aria-label="Associate"
                    disabled={!newSubnetId || associateMut.isPending}
                    onClick={() => void handleAssociate()}
                  >
                    <Icon icon={Plus} size={14} />
                  </Button></Hint>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {assocErr && <p className="text-fail-text type-caption py-1 px-2">{assocErr}</p>}
      </div>
    </div>
  )
}
