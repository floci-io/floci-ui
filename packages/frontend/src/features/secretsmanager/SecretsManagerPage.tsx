import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react'
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
    <form
      onSubmit={handleSubmit}
      style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <KeyRound size={14} style={{ color: 'var(--accent)' }} />
        <strong style={{ fontSize: 13 }}>Create secret</strong>
        <button type="button" className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <input
        className="input"
        placeholder="Secret name (e.g. prod/db/password)"
        value={name}
        onChange={(e) => { setName(e.target.value); setErr('') }}
        autoFocus
      />
      <input
        className="input"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <textarea
        className="json-editor"
        style={{ minHeight: 100 }}
        placeholder={'Secret value — plaintext or JSON, e.g.\n{\n  "username": "admin",\n  "password": "…"\n}'}
        value={secretString}
        onChange={(e) => { setSecretString(e.target.value); setErr('') }}
        spellCheck={false}
      />
      {err && <span style={{ fontSize: 12, color: '#f87171' }}>{err}</span>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="button primary" disabled={createMut.isPending}>
          {createMut.isPending ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
          Create
        </button>
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
    onError: (e) => alert(`Update failed: ${e instanceof Error ? e.message : e}`),
  })

  const deleteMut = useDeleteSecretMutation({
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['resources', 'secretsmanager'] })
      onDeleted()
    },
    onError: (e) => alert(`Delete failed: ${e instanceof Error ? e.message : e}`),
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
    <div className={`tag-drawer ${secretId ? 'open' : ''}`} style={{ width: 440 }}>
      <div className="tag-drawer-header">
        <KeyRound size={14} style={{ color: 'var(--accent)' }} />
        <h3 title={detail?.name ?? secretId ?? ''}>{detail?.name ?? secretId}</h3>
        <button className="icon-btn" onClick={onClose}><X size={14} /></button>
      </div>

      <div className="drawer-tabs">
        <button className={`drawer-tab ${tab === 'details' ? 'active' : ''}`} onClick={() => setTab('details')}>
          Details
        </button>
        <button className={`drawer-tab ${tab === 'value' ? 'active' : ''}`} onClick={() => setTab('value')}>
          Value
        </button>
      </div>

      <div className="tag-drawer-body">
        {/* ── Details tab ── */}
        {tab === 'details' && (
          detailQuery.isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#5f7080', fontSize: 13 }}>
              <Loader2 size={14} className="spin" /> Loading details…
            </div>
          ) : detailQuery.isError ? (
            <p style={{ color: '#f87171', fontSize: 13 }}>Failed to load secret details.</p>
          ) : detail ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span className="badge" style={{ background: 'rgba(34,197,94,0.14)', color: '#4ade80' }}>
                  {detail.rotationEnabled ? 'Rotation enabled' : 'Active'}
                </span>
                {detail.versionIds.length > 0 && (
                  <span className="badge" style={{ background: 'rgba(107,114,128,0.14)', color: '#9ca3af' }}>
                    {detail.versionIds.length} version{detail.versionIds.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              <div className="meta-grid">
                {detail.arn && (
                  <div className="meta-row">
                    <span className="meta-label">ARN</span>
                    <span className="meta-value" style={{ fontSize: 11 }}>{detail.arn}</span>
                  </div>
                )}
                {detail.description && (
                  <div className="meta-row">
                    <span className="meta-label">Description</span>
                    <span className="meta-value" style={{ fontFamily: 'inherit', color: '#8d9cad' }}>{detail.description}</span>
                  </div>
                )}
                {detail.kmsKeyId && (
                  <div className="meta-row">
                    <span className="meta-label">KMS key</span>
                    <span className="meta-value" style={{ fontSize: 11 }}>{detail.kmsKeyId}</span>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {detail.createdDate && (
                    <div className="meta-row">
                      <span className="meta-label">Created</span>
                      <span className="meta-value" style={{ color: '#8d9cad' }}>{timeAgo(detail.createdDate)}</span>
                    </div>
                  )}
                  {detail.lastChangedDate && (
                    <div className="meta-row">
                      <span className="meta-label">Last changed</span>
                      <span className="meta-value" style={{ color: '#8d9cad' }}>{timeAgo(detail.lastChangedDate)}</span>
                    </div>
                  )}
                  {detail.lastAccessedDate && (
                    <div className="meta-row">
                      <span className="meta-label">Last accessed</span>
                      <span className="meta-value" style={{ color: '#8d9cad' }}>{timeAgo(detail.lastAccessedDate)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Tags */}
              {detail.tags.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, color: '#5f7080', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>
                    Tags ({detail.tags.length})
                  </p>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                    {detail.tags.map((tag, i) => (
                      <div
                        key={tag.key}
                        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: i < detail.tags.length - 1 ? '1px solid var(--border)' : undefined }}
                      >
                        <div style={{ padding: '6px 8px', borderRight: '1px solid var(--border)', fontSize: 12, fontFamily: 'monospace', color: '#fbbf24' }}>{tag.key}</div>
                        <div style={{ padding: '6px 8px', fontSize: 12, fontFamily: 'monospace', color: '#d1d1d1' }} title={tag.value}>{tag.value}</div>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {!revealed && !editing ? (
              <button className="button" onClick={() => setRevealed(true)} style={{ alignSelf: 'flex-start' }}>
                <Eye size={13} />
                Reveal secret value
              </button>
            ) : editing ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <p style={{ fontSize: 11, color: '#5f7080', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
                    New secret value
                  </p>
                  <div className="drawer-tabs" style={{ marginLeft: 'auto' }}>
                    <button
                      className={`drawer-tab ${editorMode === 'key-value' ? 'active' : ''}`}
                      onClick={() => switchEditorMode('key-value')}
                    >
                      Key-value
                    </button>
                    <button
                      className={`drawer-tab ${editorMode === 'raw' ? 'active' : ''}`}
                      onClick={() => switchEditorMode('raw')}
                    >
                      Plain text
                    </button>
                  </div>
                </div>
                {editorMode === 'key-value' ? (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 32px', gap: 6, padding: '7px 8px', borderBottom: '1px solid var(--border)', color: '#5f7080', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      <span>Key</span>
                      <span>Value</span>
                      <span />
                    </div>
                    {keyValueEntries.map((entry) => (
                      <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 32px', gap: 6, padding: 8, borderBottom: '1px solid var(--border)' }}>
                        <input
                          className="input"
                          aria-label="Secret key"
                          value={entry.key}
                          onChange={(e) => updateKeyValueEntry(entry.id, 'key', e.target.value)}
                          placeholder="Key"
                        />
                        <input
                          className="input"
                          aria-label={`Value for ${entry.key || 'new key'}`}
                          value={entry.value}
                          onChange={(e) => updateKeyValueEntry(entry.id, 'value', e.target.value)}
                          placeholder="Value"
                        />
                        <button className="icon-btn" title="Delete entry" aria-label={`Delete ${entry.key || 'entry'}`} onClick={() => removeKeyValueEntry(entry.id)}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                    <div style={{ padding: 8 }}>
                      <button className="button" onClick={addKeyValueEntry}>
                        <Plus size={13} />
                        Add key-value pair
                      </button>
                    </div>
                  </div>
                ) : (
                  <textarea
                    className="json-editor"
                    style={{ minHeight: 180 }}
                    value={draftValue}
                    onChange={(e) => { setDraftValue(e.target.value); setEditorError('') }}
                    spellCheck={false}
                  />
                )}
                {editorError && <span style={{ fontSize: 12, color: '#f87171' }}>{editorError}</span>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="button primary" disabled={putMut.isPending} onClick={saveValue}>
                    {putMut.isPending ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
                    Save new version
                  </button>
                  <button className="button" onClick={cancelEditing}>Cancel</button>
                </div>
              </>
            ) : valueQuery.isLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#5f7080', fontSize: 13 }}>
                <Loader2 size={14} className="spin" /> Loading value…
              </div>
            ) : valueQuery.isError ? (
              <p style={{ color: '#f87171', fontSize: 13 }}>Failed to load secret value.</p>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: '#5f7080', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {value?.secretBinary ? 'Binary value (base64)' : 'Secret value'}
                  </span>
                  <button className="icon-btn" style={{ marginLeft: 'auto' }} title="Hide" onClick={hideValue}>
                    <EyeOff size={13} />
                  </button>
                  <button className="icon-btn" title="Copy" onClick={copyValue}>
                    {copied ? <Check size={13} color="#4ade80" /> : <Copy size={13} />}
                  </button>
                </div>
                {!isBinary && valueEntries && (
                  <div className="drawer-tabs" style={{ alignSelf: 'flex-start' }}>
                    <button className={`drawer-tab ${valueViewMode === 'key-value' ? 'active' : ''}`} onClick={() => setValueViewMode('key-value')}>
                      Key-value
                    </button>
                    <button className={`drawer-tab ${valueViewMode === 'raw' ? 'active' : ''}`} onClick={() => setValueViewMode('raw')}>
                      Plain text
                    </button>
                  </div>
                )}
                {valueViewMode === 'key-value' && valueEntries ? (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: '7px 8px', borderBottom: '1px solid var(--border)', color: '#5f7080', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      <span>Key</span>
                      <span>Value</span>
                    </div>
                    {valueEntries.length === 0 ? (
                      <p style={{ margin: 0, padding: 10, color: '#8d9cad', fontSize: 12 }}>Empty JSON object</p>
                    ) : valueEntries.map((entry, index) => (
                      <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: 8, borderBottom: index < valueEntries.length - 1 ? '1px solid var(--border)' : undefined }}>
                        <span className="mono" style={{ color: '#fbbf24', fontSize: 12, overflowWrap: 'anywhere' }}>{entry.key}</span>
                        <span className="mono" style={{ color: '#d1d1d1', fontSize: 12, overflowWrap: 'anywhere' }}>{entry.value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre className="json-editor" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
                    {value?.secretString ?? value?.secretBinary ?? '(empty)'}
                  </pre>
                )}
                {value?.versionId && (
                  <span style={{ fontSize: 11, color: '#5f7080' }}>Version: {value.versionId}</span>
                )}
                {isBinary ? (
                  <span style={{ fontSize: 12, color: '#8d9cad' }}>
                    Binary secrets are read-only here; editing would overwrite the binary value with text.
                  </span>
                ) : (
                  <button className="button" onClick={startEditing} style={{ alignSelf: 'flex-start' }}>
                    <Save size={13} />
                    Edit value
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="tag-drawer-footer">
        {deleteConfirm ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', padding: '8px', background: 'rgba(239,68,68,0.08)', borderRadius: 4, border: '1px solid rgba(239,68,68,0.3)' }}>
            <span style={{ fontSize: 12, color: '#f87171' }}>Delete this secret?</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-2)' }}>
              <input type="checkbox" checked={forceDelete} onChange={(e) => setForceDelete(e.target.checked)} />
              Force delete (no 7-day recovery window)
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="button danger" onClick={() => deleteMut.mutate({ id: secretId!, force: forceDelete })} disabled={deleteMut.isPending}>
                {deleteMut.isPending ? <Loader2 size={12} className="spin" /> : 'Yes, delete'}
              </button>
              <button className="button" onClick={() => setDeleteConfirm(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="button danger" style={{ marginLeft: 'auto' }} onClick={() => setDeleteConfirm(true)}>
            <Trash2 size={13} />
            Delete
          </button>
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
          <h2>Secrets Manager</h2>
          <span className="info-link">
            <Info size={11} />
            {query.data ? `${query.data.length} secrets` : 'Encrypted secrets'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="button" onClick={() => void query.refetch()}>
            <RefreshCw size={13} />
            Refresh
          </button>
          <button className="button primary" onClick={() => setCreating((v) => !v)}>
            <Plus size={13} />
            Create secret
          </button>
        </div>
      </div>

      <div className="input-row">
        <Search size={14} color="#8d9cad" />
        <input
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or description…"
        />
      </div>

      <div className="content">
        {creating && <CreateSecretForm onClose={() => setCreating(false)} />}

        <div className="table-panel">
          <div className="widget-header">
            <h3>Secrets</h3>
          </div>
          {query.isError ? (
            <EmptyState icon={KeyRound} title="Cannot load secrets" description="Secrets Manager did not respond from the Floci endpoint." />
          ) : query.isLoading ? (
            <div className="empty"><p>Loading secrets…</p></div>
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
                    <tr
                      key={id}
                      style={{ cursor: 'pointer', background: selected === id ? 'var(--raised)' : undefined }}
                      onClick={() => setSelected(selected === id ? null : id)}
                    >
                      <td className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <KeyRound size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                        {secret.name}
                      </td>
                      <td style={{ color: '#8d9cad' }}>{secret.description ?? '—'}</td>
                      <td style={{ color: '#8d9cad' }}>{secret.lastChangedDate ? timeAgo(secret.lastChangedDate) : '—'}</td>
                      <td>{secret.tags.length || '—'}</td>
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
