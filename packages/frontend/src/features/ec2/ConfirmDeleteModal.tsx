import { useState } from 'react'
import {Icon, AlertTriangle, Loader2, Trash2, XSquared as X} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import { ModalOverlay } from '@/components/ModalOverlay'
import {Hint} from '@/components/Hint'

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
    <ModalOverlay onClose={onClose}>
      <div className="create-table-modal w-105" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header flex items-center gap-2">
          <Icon icon={AlertTriangle} className="text-fail-text shrink-0" size={14} />
          <span>{title}</span>
          <Hint label="Close"><Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onClose} aria-label="Close">
            <Icon icon={X} size={14} />
          </Button></Hint>
        </div>

        <div className="modal-section">
          {/* Resource ID + optional subtitle */}
          <div className={`py-2 px-3 bg-well border border-line ${warnings && warnings.length > 0 ? 'mb-2.5' : 'mb-3.5'}`}>
            <div className="type-code">{resourceId}</div>
            {subtitle && (
              <div className="type-caption text-text-3 mt-1">{subtitle}</div>
            )}
          </div>

          {/* Cascade / extra warnings */}
          {warnings && warnings.length > 0 && (
            <div className="py-2 px-3 mb-3.5 bg-warn-tint border border-warn">
              {warnings.map((w, i) => (
                <div className="type-caption text-warn-text" key={i}>
                  {w}
                </div>
              ))}
            </div>
          )}

          {/* Confirmation input */}
          <label className="type-caption text-text-3 block mb-1.5">
            Type <strong className="text-text-1 type-code">delete</strong> to confirm
          </label>
          <Input aria-label="Type delete to confirm"
            placeholder="delete"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleConfirm() }}
            autoFocus
            aria-invalid={(typed && typed !== 'delete') ? true : undefined}
          />
        </div>

        <div className="modal-footer">
          <Button variant="secondary" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button variant="destructive" onClick={() => void handleConfirm()} disabled={!canDelete}>
            {isPending ? <Icon className="animate-pending" icon={Loader2} size={14} /> : <Icon icon={Trash2} size={14} />}
            Delete
          </Button>
        </div>

      </div>
    </ModalOverlay>
  )
}
