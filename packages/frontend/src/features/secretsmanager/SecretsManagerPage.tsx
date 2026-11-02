import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {Icon, CheckSquared as Check, Copy, EyeSquared as Eye, EyeOffSquared as EyeOff, InfoSquared as Info, KeyRound, Loader2, PlusSquared as Plus, RefreshCwSquared as RefreshCw, Save, Search, Trash2, XSquared as X} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import {Textarea} from '@/components/sodium/ui/textarea'
import { EmptyState } from '@/components/EmptyState'
import type { SecretSummary } from '@/api/aws/secretsmanager.api'
import {
  secretsManagerQueryKeys,
  useSecretDetailQuery,
  useSecretsQuery,
  useSecretValueQuery,
} from '@/api/aws/secretsmanager.queries'
import {
  useCreateSecretMutation,
  useDeleteSecretMutation,
  usePutSecretValueMutation,
} from '@/api/aws/secretsmanager.mutations'
import { timeAgo } from '@/lib/utils'
import {Checkbox} from '@/components/sodium/ui/checkbox'
import {Tag} from '@/components/sodium/ui/tag'
import {toast} from '@/components/sodium/ui/toast'
import {RowsSkeleton} from '@/components/PageSkeleton'
import {Hint} from '@/components/Hint'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
type JsonValueKind = 'string' | 'number' | 'boolean' | 'null' | 'json'

type SecretKeyValueEntry = {
  id: string
  key: string
  value: string
  kind: JsonValueKind
}

type SerializedKeyValueEntries =
  | { secretString: string }
  | { error: string }

function valueKind(value: JsonValue): JsonValueKind {
  if (value === null) return 'null'
  if (Array.isArray(value) || typeof value === 'object') return 'json'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'string'
}

function valueText(value: JsonValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function parseKeyValueEntries(secretString: string): SecretKeyValueEntry[] | null {
  try {
    const parsed: unknown = JSON.parse(secretString)
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') return null

    return Object.entries(parsed as Record<string, JsonValue>).map(([key, value], index) => ({
      id: `${index}-${key}`,
      key,
      value: valueText(value),
      kind: valueKind(value),
    }))
  } catch {
    return null
  }
}

function parseEntryValue(entry: SecretKeyValueEntry): JsonValue | undefined {
  if (entry.kind === 'string') return entry.value

  if (entry.kind === 'number') {
    const value = Number(entry.value)
    return Number.isFinite(value) ? value : undefined
  }

  if (entry.kind === 'boolean') {
    if (entry.value === 'true') return true
    if (entry.value === 'false') return false
    return undefined
  }

  try {
    const value: unknown = JSON.parse(entry.value)
    if (entry.kind === 'null') return value === null ? null : undefined
    return value as JsonValue
  } catch {
    return undefined
  }
}

function serializeKeyValueEntries(entries: SecretKeyValueEntry[]): SerializedKeyValueEntries {
  const output: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>

  for (const entry of entries) {
    const key = entry.key
    if (!key) return { error: 'Every entry needs a key.' }
    if (Object.prototype.hasOwnProperty.call(output, key)) return { error: `Duplicate key: ${key}` }

    const value = parseEntryValue(entry)
    if (value === undefined) {
      return { error: `Invalid ${entry.kind} value for ${key}.` }
    }
    output[key] = value
  }

  return { secretString: JSON.stringify(output, null, 2) }
}

// ─── Create secret form ─────────────────────────────────────────────────────────

function CreateSecretForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [secretString, setSecretString] = useState('')
  const [err, setErr] = useState('')

  const createMut = useCreateSecretMutation({
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['resources', 'secretsmanager'] })
      onClose()
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Create failed'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setErr('Secret name is required')
    if (!secretString) return setErr('Secret value is required')
    setErr('')
    createMut.mutate({ name: name.trim(), secretString, description: description.trim() || undefined })
  }

  return (
    <form className="flex flex-col gap-2.5 p-3.5 mb-3 bg-well border border-line"
      onSubmit={handleSubmit}
    >
      <div className="flex items-center gap-2">
        <Icon icon={KeyRound} className="text-accent-text" size={14} />
        <strong className="type-caption">Create secret</strong>
        <Hint label="Close"><Button variant="ghost" size="icon-sm" type="button" className="ml-auto" onClick={onClose} aria-label="Close">
          <Icon icon={X} size={14} />
        </Button></Hint>
      </div>
      <Input aria-label="Secret name"
        placeholder="Secret name (e.g. prod/db/password)"
        value={name}
        onChange={(e) => { setName(e.target.value); setErr('') }}
        autoFocus
      />
      <Input aria-label="Description"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <Textarea aria-label="Secret value"
        className="json-editor"
        placeholder={'Secret value, plaintext or JSON, e.g.\n{\n  "username": "admin",\n  "password": "…"\n}'}
        value={secretString}
        onChange={(e) => { setSecretString(e.target.value); setErr('') }}
        spellCheck={false}
      />
      {err && <span className="type-caption text-fail-text">{err}</span>}
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={createMut.isPending}>
          {createMut.isPending ? <Icon icon={Loader2} size={14} className="spin" /> : <Icon icon={Plus} size={14} />}
          Create
        </Button>
      </div>
    </form>
  )
}

// ─── Secret detail drawer ─────────────────────────────────────────────────────────

function SecretDrawer({
  secretId,
  onClose,
  onDeleted,
}: {
  secretId: string | null
  onClose: () => void
  onDeleted: () => void
}) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'details' | 'value'>('details')
  const [revealed, setRevealed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftValue, setDraftValue] = useState('')
  const [valueViewMode, setValueViewMode] = useState<'key-value' | 'raw'>('raw')
  const [editorMode, setEditorMode] = useState<'key-value' | 'raw'>('raw')
  const [keyValueEntries, setKeyValueEntries] = useState<SecretKeyValueEntry[]>([])
  const [editorError, setEditorError] = useState('')
  const [copied, setCopied] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [forceDelete, setForceDelete] = useState(false)

  // Reset transient state when the selected secret changes (via key prop), and
  // evict any fetched plaintext from the cache so it never outlives this view.
  useEffect(() => {
    setTab('details')
    setRevealed(false)
    setEditing(false)
    setDraftValue('')
    setValueViewMode('raw')
    setEditorMode('raw')
    setKeyValueEntries([])
    setEditorError('')
    setCopied(false)
    setDeleteConfirm(false)
    setForceDelete(false)
    return () => {
      qc.removeQueries({ queryKey: secretsManagerQueryKeys.value(secretId) })
    }
  }, [secretId, qc])

  // Auto-hide when the user leaves the Value tab. Flipping `revealed` is not
  // enough — the fetched plaintext stays in the React Query cache (readable via
  // DevTools/other components) until its entry is evicted, so drop it here and
  // discard any in-progress edit as well.
  useEffect(() => {
    if (tab === 'value') return
    setRevealed(false)
    setEditing(false)
    setDraftValue('')
    setValueViewMode('raw')
    setEditorMode('raw')
    setKeyValueEntries([])
    setEditorError('')
    qc.removeQueries({ queryKey: secretsManagerQueryKeys.value(secretId) })
  }, [tab, secretId, qc])

  const detailQuery = useSecretDetailQuery(secretId)

  // The plaintext value is only fetched once the user explicitly reveals it.
  const valueQuery = useSecretValueQuery(secretId, revealed && tab === 'value')

  const putMut = usePutSecretValueMutation({
    onSuccess: () => {
      setEditing(false)
      setDraftValue('')
    },
    onError: (e) => toast.fail('Update failed', {description: e instanceof Error ? e.message : String(e)}),
  })

  const deleteMut = useDeleteSecretMutation({
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['resources', 'secretsmanager'] })
      onDeleted()
    },
    onError: (e) => toast.fail('Delete failed', {description: e instanceof Error ? e.message : String(e)}),
  })

  const detail = detailQuery.data
  const value = valueQuery.data
  // A binary secret has no SecretString. The API only writes SecretString, so
  // editing one here would overwrite the binary value with text — block it.
  const isBinary = Boolean(value && value.secretString === undefined && value.secretBinary !== undefined)
  const valueEntries = value?.secretString === undefined ? null : parseKeyValueEntries(value.secretString)

  useEffect(() => {
    if (!revealed || tab !== 'value' || editing) return
    setValueViewMode(parseKeyValueEntries(value?.secretString ?? '') ? 'key-value' : 'raw')
  }, [editing, revealed, tab, value?.secretString])

  // Hiding must evict the fetched plaintext from the cache, not merely flip the
  // reveal flag — otherwise the value lingers in memory (DevTools, extensions,
  // other components) after the user hides it.
  function hideValue() {
    setRevealed(false)
    qc.removeQueries({ queryKey: secretsManagerQueryKeys.value(secretId) })
  }

  function cancelEditing() {
    setEditing(false)
    setDraftValue('')
    setEditorMode('raw')
    setKeyValueEntries([])
    setEditorError('')
  }

  function startEditing() {
    if (isBinary) return
    const secretString = value?.secretString ?? ''
    const entries = parseKeyValueEntries(secretString)
    setDraftValue(secretString)
    setKeyValueEntries(entries ?? [])
    setEditorMode(valueViewMode === 'key-value' && entries ? 'key-value' : 'raw')
    setEditorError('')
    setEditing(true)
  }

  function switchEditorMode(mode: 'key-value' | 'raw') {
    if (mode === editorMode) return

    if (mode === 'key-value') {
      const entries = parseKeyValueEntries(draftValue)
      if (!entries) {
        setEditorError('Key-value editing is available only for a JSON object.')
        return
      }
      setKeyValueEntries(entries)
      setEditorError('')
      setEditorMode('key-value')
      return
    }

    const serialized = serializeKeyValueEntries(keyValueEntries)
    if ('error' in serialized) {
      setEditorError(serialized.error)
      return
    }
    setDraftValue(serialized.secretString)
    setEditorError('')
    setEditorMode('raw')
  }

  function updateKeyValueEntry(id: string, field: 'key' | 'value', nextValue: string) {
    setKeyValueEntries((entries) => entries.map((entry) => (
      entry.id === id ? { ...entry, [field]: nextValue } : entry
    )))
    setEditorError('')
  }

  function addKeyValueEntry() {
    setKeyValueEntries((entries) => [
      ...entries,
      { id: crypto.randomUUID(), key: '', value: '', kind: 'string' },
    ])
    setEditorError('')
  }

  function removeKeyValueEntry(id: string) {
    setKeyValueEntries((entries) => entries.filter((entry) => entry.id !== id))
    setEditorError('')
  }

  function saveValue() {
    let secretString = draftValue

    if (editorMode === 'key-value') {
      const serialized = serializeKeyValueEntries(keyValueEntries)
      if ('error' in serialized) {
        setEditorError(serialized.error)
        return
      }
      secretString = serialized.secretString
    }

    if (!secretString) {
      setEditorError('Secret value is required.')
      return
    }

    putMut.mutate({ id: secretId!, secretString })
  }

  async function copyValue() {
    const text = value?.secretString ?? value?.secretBinary
    if (text === undefined || text === null) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be denied; silently ignore.
    }
  }

  return (
    <div className={`tag-drawer ${secretId ? 'open' : ''} w-110`}>
      <div className="tag-drawer-header">
        <Icon icon={KeyRound} className="text-accent-text" size={14} />
        <h2 title={detail?.name ?? secretId ?? ''}>{detail?.name ?? secretId}</h2>
        <Hint label="Close"><Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close"><Icon icon={X} size={14} aria-hidden="true" /></Button></Hint>
      </div>

      <div className="drawer-tabs">
        <Button variant={tab === 'details' ? 'secondary' : 'ghost'} onClick={() => setTab('details')}>
          Details
        </Button>
        <Button variant={tab === 'value' ? 'secondary' : 'ghost'} onClick={() => setTab('value')}>
          Value
        </Button>
      </div>

      <div className="tag-drawer-body">
        {/* ── Details tab ── */}
        {tab === 'details' && (
          detailQuery.isLoading ? (
            <div className="flex items-center gap-2 text-text-3 type-caption">
              <Icon icon={Loader2} size={14} className="spin" /> Loading details…
            </div>
          ) : detailQuery.isError ? (
            <p className="text-fail-text type-caption">Failed to load secret details.</p>
          ) : detail ? (
            <div className="flex flex-col gap-3.5">
              <div className="flex gap-1.5 flex-wrap">
                <Tag variant="ok">
                  {detail.rotationEnabled ? 'Rotation enabled' : 'Active'}
                </Tag>
                {detail.versionIds.length > 0 && (
                  <Tag>
                    {detail.versionIds.length} version{detail.versionIds.length !== 1 ? 's' : ''}
                  </Tag>
                )}
              </div>

              <div className="meta-grid">
                {detail.arn && (
                  <div className="meta-row">
                    <span className="meta-label">ARN</span>
                    <span className="meta-value type-caption">{detail.arn}</span>
                  </div>
                )}
                {detail.description && (
                  <div className="meta-row">
                    <span className="meta-label">Description</span>
                    <span className="meta-value text-text-3">{detail.description}</span>
                  </div>
                )}
                {detail.kmsKeyId && (
                  <div className="meta-row">
                    <span className="meta-label">KMS key</span>
                    <span className="meta-value type-caption">{detail.kmsKeyId}</span>
                  </div>
                )}
                <div className="grid gap-2.5 grid-cols-2">
                  {detail.createdDate && (
                    <div className="meta-row">
                      <span className="meta-label">Created</span>
                      <span className="meta-value text-text-3">{timeAgo(detail.createdDate)}</span>
                    </div>
                  )}
                  {detail.lastChangedDate && (
                    <div className="meta-row">
                      <span className="meta-label">Last changed</span>
                      <span className="meta-value text-text-3">{timeAgo(detail.lastChangedDate)}</span>
                    </div>
                  )}
                  {detail.lastAccessedDate && (
                    <div className="meta-row">
                      <span className="meta-label">Last accessed</span>
                      <span className="meta-value text-text-3">{timeAgo(detail.lastAccessedDate)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Tags */}
              {detail.tags.length > 0 && (
                <div>
                  <p className="type-caption text-text-3 mt-0 mx-0 mb-1.5 type-label-sm">
                    Tags ({detail.tags.length})
                  </p>
                  <div className="overflow-hidden border border-line">
                    {detail.tags.map((tag, i) => (
                      <div className={`grid grid-cols-2 ${i < detail.tags.length - 1 ? 'border-b border-line' : ''}`}
                        key={tag.key}
                      >
                        <div className="py-1.5 px-2 border-r border-line type-code-sm text-warn-text">{tag.key}</div>
                        <div className="py-1.5 px-2 type-code-sm text-text-2" title={tag.value}>{tag.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null
        )}

        {/* ── Value tab ── */}
        {tab === 'value' && (
          <div className="flex flex-col gap-3">
            {!revealed && !editing ? (
              <Button variant="secondary" className="self-start" onClick={() => setRevealed(true)}>
                <Icon icon={Eye} size={14} />
                Reveal secret value
              </Button>
            ) : editing ? (
              <>
                <div className="flex items-center gap-2">
                  <p className="type-caption text-text-3 m-0 type-label-sm">
                    New secret value
                  </p>
                  <div className="drawer-tabs ml-auto">
                    <Button variant={editorMode === 'key-value' ? 'secondary' : 'ghost'}
                      onClick={() => switchEditorMode('key-value')}
                    >
                      Key-value
                    </Button>
                    <Button variant={editorMode === 'raw' ? 'secondary' : 'ghost'}
                      onClick={() => switchEditorMode('raw')}
                    >
                      Plain text
                    </Button>
                  </div>
                </div>
                {editorMode === 'key-value' ? (
                  <div className="overflow-hidden border border-line">
                    <div className="grid gap-1.5 py-2 px-2 border-b border-line text-text-3 type-caption type-label-sm grid-cols-[1fr_1fr_var(--control)]">
                      <span>Key</span>
                      <span>Value</span>
                      <span />
                    </div>
                    {keyValueEntries.map((entry) => (
                      <div className="grid gap-1.5 p-2 border-b border-line grid-cols-[1fr_1fr_var(--control)]" key={entry.id}>
                        <Input
                          aria-label="Secret key"
                          value={entry.key}
                          onChange={(e) => updateKeyValueEntry(entry.id, 'key', e.target.value)}
                          placeholder="Key"
                        />
                        <Input
                          aria-label={`Value for ${entry.key || 'new key'}`}
                          value={entry.value}
                          onChange={(e) => updateKeyValueEntry(entry.id, 'value', e.target.value)}
                          placeholder="Value"
                        />
                        <Hint label="Delete entry"><Button variant="ghost" size="icon-sm" aria-label={`Delete ${entry.key || 'entry'}`} onClick={() => removeKeyValueEntry(entry.id)}>
                          <Icon icon={Trash2} size={14} />
                        </Button></Hint>
                      </div>
                    ))}
                    <div className="p-2">
                      <Button variant="secondary" onClick={addKeyValueEntry}>
                        <Icon icon={Plus} size={14} />
                        Add key-value pair
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Textarea aria-label="Secret value"
                    className="json-editor"
                    value={draftValue}
                    onChange={(e) => { setDraftValue(e.target.value); setEditorError('') }}
                    spellCheck={false}
                  />
                )}
                {editorError && <span className="type-caption text-fail-text">{editorError}</span>}
                <div className="flex gap-2">
                  <Button disabled={putMut.isPending} onClick={saveValue}>
                    {putMut.isPending ? <Icon icon={Loader2} size={14} className="spin" /> : <Icon icon={Save} size={14} />}
                    Save new version
                  </Button>
                  <Button variant="secondary" onClick={cancelEditing}>Cancel</Button>
                </div>
              </>
            ) : valueQuery.isLoading ? (
              <div className="flex items-center gap-2 text-text-3 type-caption">
                <Icon icon={Loader2} size={14} className="spin" /> Loading value…
              </div>
            ) : valueQuery.isError ? (
              <p className="text-fail-text type-caption">Failed to load secret value.</p>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="type-caption text-text-3 type-label-sm">
                    {value?.secretBinary ? 'Binary value (base64)' : 'Secret value'}
                  </span>
                  <Hint label="Hide"><Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Hide" onClick={hideValue}>
                    <Icon icon={EyeOff} size={14} />
                  </Button></Hint>
                  <Hint label="Copy"><Button variant="ghost" size="icon-sm" aria-label="Copy" onClick={copyValue}>
                    {copied ? <Icon icon={Check} size={14} color="var(--status-ok)" /> : <Icon icon={Copy} size={14} />}
                  </Button></Hint>
                </div>
                {!isBinary && valueEntries && (
                  <div className="drawer-tabs self-start">
                    <Button variant={valueViewMode === 'key-value' ? 'secondary' : 'ghost'} onClick={() => setValueViewMode('key-value')}>
                      Key-value
                    </Button>
                    <Button variant={valueViewMode === 'raw' ? 'secondary' : 'ghost'} onClick={() => setValueViewMode('raw')}>
                      Plain text
                    </Button>
                  </div>
                )}
                {valueViewMode === 'key-value' && valueEntries ? (
                  <div className="overflow-hidden border border-line">
                    <div className="grid gap-1.5 py-2 px-2 border-b border-line text-text-3 type-caption type-label-sm grid-cols-2">
                      <span>Key</span>
                      <span>Value</span>
                    </div>
                    {valueEntries.length === 0 ? (
                      <p className="m-0 p-2.5 text-text-3 type-caption">Empty JSON object</p>
                    ) : valueEntries.map((entry, index) => (
                      <div className={`grid gap-1.5 p-2 grid-cols-2 ${index < valueEntries.length - 1 ? 'border-b border-line' : ''}`} key={entry.id}>
                        <span className="mono text-warn-text type-caption wrap-anywhere">{entry.key}</span>
                        <span className="mono text-text-2 type-caption wrap-anywhere">{entry.value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre className="json-editor whitespace-pre-wrap break-all m-0">
                    {value?.secretString ?? value?.secretBinary ?? '(empty)'}
                  </pre>
                )}
                {value?.versionId && (
                  <span className="type-caption text-text-3">Version: {value.versionId}</span>
                )}
                {isBinary ? (
                  <span className="type-caption text-text-3">
                    Binary secrets are read-only here; editing would overwrite the binary value with text.
                  </span>
                ) : (
                  <Button variant="secondary" className="self-start" onClick={startEditing}>
                    <Icon icon={Save} size={14} />
                    Edit value
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="tag-drawer-footer">
        {deleteConfirm ? (
          <div className="flex flex-col gap-2 w-full p-2 bg-fail-tint border border-fail">
            <span className="type-caption text-fail-text">Delete this secret?</span>
            <label className="flex items-center gap-2 type-caption text-text-2">
              <Checkbox checked={forceDelete} onCheckedChange={(checked) => setForceDelete(checked)} />
              Force delete (no 7-day recovery window)
            </label>
            <div className="flex gap-2 justify-end">
              <Button variant="destructive" onClick={() => deleteMut.mutate({ id: secretId!, force: forceDelete })} disabled={deleteMut.isPending}>
                {deleteMut.isPending ? <Icon icon={Loader2} size={14} className="spin" /> : 'Yes, delete'}
              </Button>
              <Button variant="secondary" onClick={() => setDeleteConfirm(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button variant="destructive" className="ml-auto" onClick={() => setDeleteConfirm(true)}>
            <Icon icon={Trash2} size={14} />
            Delete
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SecretsManagerPage() {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const query = useSecretsQuery()

  const secrets = useMemo(() => {
    const all = query.data ?? []
    if (!search) return all
    const q = search.toLowerCase()
    return all.filter((s) => s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q))
  }, [query.data, search])

  function selectionId(secret: SecretSummary): string {
    return secret.arn ?? secret.name
  }

  return (
    <>
      <SecretDrawer
        key={selected}
        secretId={selected}
        onClose={() => setSelected(null)}
        onDeleted={() => setSelected(null)}
      />

      <div className="page-header">
        <div className="page-title">
          <h1>Secrets Manager</h1>
          <span className="info-link">
            <Icon icon={Info} size={14} />
            {query.data ? `${query.data.length} secrets` : 'Encrypted secrets'}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void query.refetch()}>
            <Icon icon={RefreshCw} size={14} />
            Refresh
          </Button>
          <Button onClick={() => setCreating((v) => !v)}>
            <Icon icon={Plus} size={14} />
            Create secret
          </Button>
        </div>
      </div>

      <div className="input-row">
        <Icon icon={Search} size={14} color="var(--text-3)" />
        <Input aria-label="Search by name or description"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or description…"
        />
      </div>

      <div className="content">
        {creating && <CreateSecretForm onClose={() => setCreating(false)} />}

        <div className="table-panel">
          <div className="widget-header">
            <h2>Secrets</h2>
          </div>
          {query.isError ? (
            <EmptyState icon={KeyRound} title="Cannot load secrets" description="Secrets Manager did not respond from the Floci endpoint." />
          ) : query.isLoading ? (
            <RowsSkeleton label="Loading secrets"/>
          ) : secrets.length === 0 ? (
            <EmptyState
              icon={KeyRound}
              title={search ? 'No secrets match your search' : 'No secrets'}
              description={search ? 'Try a different name or description filter.' : 'Create a secret to get started.'}
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Last changed</th>
                  <th>Tags</th>
                </tr>
              </thead>
              <tbody>
                {secrets.map((secret) => {
                  const id = selectionId(secret)
                  return (
                    <tr className={`cursor-pointer ${selected === id ? 'selected' : ''}`}
                      key={id}
                      onClick={() => setSelected(selected === id ? null : id)}
                    >
                      <td className="mono flex items-center gap-2">
                        <Icon icon={KeyRound} className="text-accent-text shrink-0" size={14} />
                        {secret.name}
                      </td>
                      <td className="text-text-3">{secret.description ?? ', '}</td>
                      <td className="text-text-3">{secret.lastChangedDate ? timeAgo(secret.lastChangedDate) : ', '}</td>
                      <td>{secret.tags.length || ', '}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}
