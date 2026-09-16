import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  useCreateRouteMutation,
  useDeleteRouteMutation,
  useAssociateRouteTableMutation,
  useDisassociateRouteTableMutation,
} from '@/api/aws/ec2.mutations'
import { isValidCidr } from './validators'
import type { Ec2Route, Ec2RouteTableAssociation, Ec2InternetGateway, Ec2NatGateway, Ec2Subnet } from '@/api/aws/ec2.api'

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
  return '—'
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── Routes ──────────────────────────────────────────────────── */}
      <div className="table-panel">
        <div className="widget-header">
          <h3>Routes</h3>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Destination</th>
              <th>Target</th>
              <th>Status</th>
              <th>Origin</th>
              <th style={{ width: 32 }}></th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r, i) => (
              <tr key={i}>
                <td className="mono" style={{ fontSize: 12 }}>{r.destinationCidrBlock ?? '—'}</td>
                <td className="mono" style={{ fontSize: 12 }}>{targetLabel(r)}</td>
                <td>
                  <span className={`status ${r.state === 'active' ? 'healthy' : 'unknown'}`}>
                    {r.state ?? '—'}
                  </span>
                </td>
                <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.origin ?? '—'}</td>
                <td>
                  {canDeleteRoute(r) && (
                    <button
                      className="icon-btn"
                      title="Delete route"
                      disabled={deleteRouteMut.isPending}
                      onClick={() => void handleDeleteRoute(r.destinationCidrBlock ?? '')}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {/* New route row */}
            <tr>
              <td>
                <input
                  className="input"
                  style={{
                    fontSize: 12, padding: '2px 6px',
                    borderColor: newCidr && (!cidrValid || isDuplicateRoute) ? 'var(--status-error)' : undefined,
                  }}
                  placeholder="0.0.0.0/0"
                  value={newCidr}
                  onChange={(e) => { setNewCidr(e.target.value); setRouteErr('') }}
                />
              </td>
              <td colSpan={3} style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '4px 8px' }}>
                <select
                  className="input"
                  style={{ fontSize: 12, padding: '2px 6px', flex: '0 0 auto' }}
                  value={targetKind}
                  onChange={(e) => { setTargetKind(e.target.value as TargetKind); setTargetId('') }}
                >
                  <option value="igw">Internet Gateway</option>
                  <option value="nat">NAT Gateway</option>
                  {/* VPC peering shown only if we add peering support later */}
                </select>
                <select
                  className="input"
                  style={{ fontSize: 12, padding: '2px 6px', flex: 1 }}
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                >
                  <option value="">— select target —</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </td>
              <td>
                <button
                  className="icon-btn"
                  title="Add route"
                  disabled={!canAddRoute || createRouteMut.isPending}
                  onClick={() => void handleAddRoute()}
                >
                  <Plus size={12} />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        {isDuplicateRoute && <p style={{ color: 'var(--status-error)', fontSize: 11, padding: '4px 8px' }}>Route already exists</p>}
        {routeErr && <p style={{ color: 'var(--status-error)', fontSize: 11, padding: '4px 8px' }}>{routeErr}</p>}
      </div>

      {/* ── Subnet Associations ──────────────────────────────────────── */}
      <div className="table-panel">
        <div className="widget-header">
          <h3>Subnet associations</h3>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Association ID</th>
              <th>Subnet ID</th>
              <th>Main</th>
              <th style={{ width: 32 }}></th>
            </tr>
          </thead>
          <tbody>
            {associations.map((a) => (
              <tr key={a.associationId}>
                <td className="mono" style={{ fontSize: 12 }}>{a.associationId}</td>
                <td className="mono" style={{ fontSize: 12 }}>{a.subnetId ?? '—'}</td>
                <td>{a.isMain ? <span className="status healthy">Yes</span> : '—'}</td>
                <td>
                  {!a.isMain && (
                    <button
                      className="icon-btn"
                      title="Disassociate"
                      disabled={disassociateMut.isPending}
                      onClick={() => void handleDisassociate(a.associationId)}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {/* Associate new subnet */}
            {availableSubnets.length > 0 && (
              <tr>
                <td colSpan={3}>
                  <select
                    className="input"
                    style={{ fontSize: 12, padding: '2px 6px', width: '100%' }}
                    value={newSubnetId}
                    onChange={(e) => { setNewSubnetId(e.target.value); setAssocErr('') }}
                  >
                    <option value="">— associate a subnet —</option>
                    {availableSubnets.map((s) => (
                      <option key={s.subnetId} value={s.subnetId}>
                        {s.subnetId} — {s.cidrBlock}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    className="icon-btn"
                    title="Associate"
                    disabled={!newSubnetId || associateMut.isPending}
                    onClick={() => void handleAssociate()}
                  >
                    <Plus size={12} />
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {assocErr && <p style={{ color: 'var(--status-error)', fontSize: 11, padding: '4px 8px' }}>{assocErr}</p>}
      </div>
    </div>
  )
}
