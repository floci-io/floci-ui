import { useState } from 'react'
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react'

type Props = {
  /** Title line, e.g. "Delete VPC" */
  title: string
  /** Resource identifier shown in monospace, e.g. "vpc-d0965efd" */
  resourceId: string
  /** Human-readable label shown below the ID, e.g. "my-vpc · 10.0.0.0/16 · default" */
  subtitle?: string
  /** Extra warning lines shown between resourceId and the input (cascade list, etc.) */
  warnings?: string[]
  /** Mutation pending state */
  isPending?: boolean
  onConfirm: () => void | Promise<void>
  onClose: () => void
}

export function ConfirmDeleteModal({ title, resourceId, subtitle, warnings, isPending, onConfirm, onClose }: Props) {
  const [typed, setTyped] = useState('')
  const canDelete = typed === 'delete' && !isPending

  async function handleConfirm() {
    if (!canDelete) return
    await onConfirm()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="create-table-modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={14} style={{ color: 'var(--status-error)', flexShrink: 0 }} />
          <span>{title}</span>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close" title="Close">
            <X size={13} />
          </button>
        </div>

        <div className="modal-section">
          {/* Resource ID + optional subtitle */}
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '8px 12px',
            marginBottom: warnings && warnings.length > 0 ? 10 : 14,
          }}>
            <div style={{ fontFamily: 'monospace', fontSize: 13 }}>{resourceId}</div>
            {subtitle && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{subtitle}</div>
            )}
          </div>

          {/* Cascade / extra warnings */}
          {warnings && warnings.length > 0 && (
            <div style={{
              background: 'rgba(251,191,36,0.08)',
              border: '1px solid rgba(251,191,36,0.3)',
              borderRadius: 4,
              padding: '8px 12px',
              marginBottom: 14,
            }}>
              {warnings.map((w, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--status-warn)', lineHeight: 1.5 }}>
                  {w}
                </div>
              ))}
            </div>
          )}

          {/* Confirmation input */}
          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
            Type <strong style={{ color: 'var(--text)', fontFamily: 'monospace' }}>delete</strong> to confirm
          </label>
          <input
            className="input"
            placeholder="delete"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleConfirm() }}
            autoFocus
            style={{ borderColor: typed && typed !== 'delete' ? 'var(--status-error)' : undefined }}
          />
        </div>

        <div className="modal-footer">
          <button className="button" onClick={onClose} disabled={isPending}>Cancel</button>
          <button className="button danger" onClick={() => void handleConfirm()} disabled={!canDelete}>
            {isPending ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={13} />}
            Delete
          </button>
        </div>

      </div>
    </div>
  )
}
