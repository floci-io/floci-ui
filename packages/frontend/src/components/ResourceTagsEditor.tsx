import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, X } from 'lucide-react'
import { updateCloudResourceTags } from '@/api/cloudProxyClient'
import { changesBetween, duplicateKey, type ResourceTag } from '@/lib/resourceTags'
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
  const [draft, setDraft] = useState<TagDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const saveMut = useMutation({
    mutationFn: (changes: Record<string, string | null>) =>
      updateCloudResourceTags(cloud, resource.service, resource.id, changes),
    onMutate: () => ({
      // Captured now: an account switch while the request is in flight must not
      // refresh another account's resources.
      accountId: getAccountId(),
    }),
    onSuccess: (_, __, context) => {
      const accountId = context?.accountId ?? getAccountId()
      setDraft(null)
      setError(null)
      // The inspector shows the resource's own query and the list shows the row, and
      // both carry the tags, so both are asked again.
      void queryClient.invalidateQueries({
<<<<<<< HEAD
        queryKey: ['cloud-resource', accountId, cloud, resource.service, resource.id],
      })
      void queryClient.invalidateQueries({
        queryKey: ['cloud-resources', accountId, cloud, resource.service],
=======
        queryKey: ['cloud-resource', getAccountId(), cloud, resource.service, resource.id],
      })
      void queryClient.invalidateQueries({
        queryKey: ['cloud-console-resources', cloud, resource.service],
>>>>>>> 1b47868 (fix(console): the tags refresh after they are edited)
      })
    },
    onError: (failure) => setError(errorMessage(failure)),
  })

  if (!draft) {
    return (
      <button
        className="button small"
        type="button"
        disabled={!runtimeReachable}
        onClick={() => {
          // The tags as they are now are the ones the draft is compared against: a
          // tag that arrives while the form is open is not one the form has, and
          // saving must not remove it.
          setDraft({ original: tags, rows: tags.map((tag) => ({ ...tag })) })
          setError(null)
        }}
      >
        <Pencil size={12} />
        Edit tags
      </button>
    )
  }

  const duplicate = duplicateKey(draft.rows)

  // The editor is closed when the save succeeds, so anything the user changes
  // while the request is in flight would be lost. The controls are held still
  // until it is done.
  return (
    <div className="tags-editor">
      {draft.rows.map((row, index) => (
        <div className="tags-editor-row" key={index}>
          <input
            className="input"
            aria-label="Tag key"
            value={row.key}
            disabled={saveMut.isPending}
            onChange={(event) =>
              setDraft((prev) =>
                prev
                  ? { ...prev, rows: prev.rows.map((each, i) => (i === index ? { ...each, key: event.target.value } : each)) }
                  : prev,
              )
            }
          />
          <input
            className="input"
            aria-label="Tag value"
            value={row.value}
            disabled={saveMut.isPending}
            onChange={(event) =>
              setDraft((prev) =>
                prev
                  ? { ...prev, rows: prev.rows.map((each, i) => (i === index ? { ...each, value: event.target.value } : each)) }
                  : prev,
              )
            }
          />
          <button
            className="icon-btn"
            type="button"
            aria-label="Remove tag"
            disabled={saveMut.isPending}
            onClick={() =>
              setDraft((prev) =>
                prev ? { ...prev, rows: prev.rows.filter((_, i) => i !== index) } : prev,
              )
            }
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
          onClick={() =>
            setDraft((prev) => (prev ? { ...prev, rows: [...prev.rows, { key: '', value: '' }] } : prev))
          }
        >
          <Plus size={12} />
          Add tag
        </button>
        <button
          className="button small"
          type="button"
          disabled={saveMut.isPending}
          onClick={() => {
            setDraft(null)
            setError(null)
          }}
        >
          Cancel
        </button>
        <button
          className="button small primary"
          type="button"
          disabled={saveMut.isPending || Boolean(duplicate)}
          onClick={() => saveMut.mutate(changesBetween(draft.original, draft.rows))}
        >
          {saveMut.isPending ? 'Saving' : 'Save'}
        </button>
      </div>
      {duplicate && (
        <p className="form-error" role="alert">
          The tag {duplicate} is named twice: each tag has a key of its own.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * The tags being edited, and the tags they are compared against.
 *
 * <p>The comparison is against the tags as they were when the editing began, not
 * against the tags the resource has now: a tag that arrives while the form is open
 * is not one the form has, and saving must not remove it.
 */
interface TagDraft {
  /** The tags the resource had when the editing began. */
  original: ResourceTag[]
  /** The rows on the form. */
  rows: TagRow[]
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'the request failed'
}
