import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, X } from 'lucide-react'
import { updateCloudResourceTags } from '@/api/cloudProxyClient'
import { changesBetween, type ResourceTag } from '@/lib/resourceTags'
import { getAccountId } from '@/lib/accountStore'
import type { CloudProvider } from '@/types/cloud'
import type { CloudResource } from '@/types/resource'

interface ResourceTagsEditorProps {
  resource: CloudResource
  cloud: CloudProvider
  /** The tags the resource has now, as the inspector reads them. */
  tags: ResourceTag[]
  runtimeReachable: boolean
}

/** A tag as the editor holds it: the key and the value, both editable. */
type TagRow = ResourceTag

/**
 * The tags of a resource, edited.
 *
 * <p>The schema's `updateTags` capability has been advertised by KMS since the
 * capability existed, and the console had no way to reach it, so the tags a resource
 * showed were the ones it would keep. This is that control: the tags the resource
 * has, editable, saved through the adapter's own `updateTags`.
 */
export function ResourceTagsEditor({ resource, cloud, tags, runtimeReachable }: ResourceTagsEditorProps) {
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<TagRow[]>(() => tags.map((tag) => ({ ...tag })))
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const saveMut = useMutation({
    mutationFn: (changes: Record<string, string | null>) =>
      updateCloudResourceTags(cloud, resource.service, resource.id, changes),
    onSuccess: () => {
      setEditing(false)
      setError(null)
      // The inspector shows the resource's own query and the list shows the row, and
      // both carry the tags, so both are asked again.
      void queryClient.invalidateQueries({
        queryKey: ['cloud-resource', getAccountId(), cloud, resource.service, resource.id],
      })
      void queryClient.invalidateQueries({
        queryKey: ['cloud-console-resources', cloud, resource.service],
      })
    },
    onError: (failure) => setError(errorMessage(failure)),
  })

  if (!editing) {
    return (
      <button
        className="button small"
        type="button"
        disabled={!runtimeReachable}
        onClick={() => {
          setRows(tags.map((tag) => ({ ...tag })))
          setError(null)
          setEditing(true)
        }}
      >
        <Pencil size={12} />
        Edit tags
      </button>
    )
  }

  // The editor is closed when the save succeeds, so anything the user changes
  // while the request is in flight would be lost. The controls are held still
  // until it is done.
  return (
    <div className="tags-editor">
      {rows.map((row, index) => (
        <div className="tags-editor-row" key={index}>
          <input
            className="input"
            aria-label="Tag key"
            value={row.key}
            disabled={saveMut.isPending}
            onChange={(event) =>
              setRows((prev) => prev.map((each, i) => (i === index ? { ...each, key: event.target.value } : each)))
            }
          />
          <input
            className="input"
            aria-label="Tag value"
            value={row.value}
            disabled={saveMut.isPending}
            onChange={(event) =>
              setRows((prev) => prev.map((each, i) => (i === index ? { ...each, value: event.target.value } : each)))
            }
          />
          <button
            className="icon-btn"
            type="button"
            aria-label="Remove tag"
            disabled={saveMut.isPending}
            onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <div className="tags-editor-actions">
        <button
          className="button small"
          type="button"
          disabled={saveMut.isPending}
          onClick={() => setRows((prev) => [...prev, { key: '', value: '' }])}
        >
          <Plus size={12} />
          Add tag
        </button>
        <button
          className="button small"
          type="button"
          disabled={saveMut.isPending}
          onClick={() => {
            setEditing(false)
            setError(null)
          }}
        >
          Cancel
        </button>
        <button
          className="button small primary"
          type="button"
          disabled={saveMut.isPending}
          onClick={() => saveMut.mutate(changesBetween(tags, rows))}
        >
          {saveMut.isPending ? 'Saving' : 'Save'}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'the request failed'
}
