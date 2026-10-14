import { useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useUpdateEc2InstanceTagsMutation } from "@/api/aws/ec2.mutations";
import type { Ec2Tag } from "@/api/aws/ec2.api";

interface Props {
  instanceId: string;
  initialTags: Ec2Tag[];
}

function isAwsTag(tag: Ec2Tag) {
  return /^aws:/i.test(tag.key);
}

export function TagEditor({ instanceId, initialTags }: Props) {
  const [draft, setDraft] = useState<{ base: Ec2Tag[]; rows: Ec2Tag[] } | null>(null);
  const userTags = initialTags.filter((tag) => !isAwsTag(tag));
  const rows = draft?.rows ?? userTags;
  const [err, setErr] = useState("");
  const mutation = useUpdateEc2InstanceTagsMutation();

  function setRows(update: (tags: Ec2Tag[]) => Ec2Tag[]) {
    setDraft((previous) => ({
      base: previous?.base ?? userTags,
      rows: update(previous?.rows ?? userTags),
    }));
  }

  function addRow() {
    setRows((prev) => [...prev, { key: "", value: "" }]);
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function setKey(idx: number, key: string) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, key } : r)));
  }

  function setValue(idx: number, value: string) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, value } : r)));
  }

  function handleSave() {
    const newTags = rows.filter((r) => r.key.trim());
    if (newTags.some(isAwsTag)) {
      setErr("Tag keys starting with 'aws:' are reserved for AWS.");
      return;
    }
    const originalTags = draft?.base ?? userTags;
    const newKeys = new Set(newTags.map((t) => t.key));
    const oldKeys = new Set(originalTags.map((t) => t.key));
    const toAdd = newTags.filter((t) => !oldKeys.has(t.key) || originalTags.find((ot) => ot.key === t.key)?.value !== t.value);
    const toRemove = originalTags.map((t) => t.key).filter((k) => !newKeys.has(k));
    setErr("");
    mutation.mutate(
      { instanceId, toAdd, toRemove },
      {
        onSuccess: () => setDraft((current) => current === draft ? null : current),
        onError: (e) => setErr(e instanceof Error ? e.message : "Save failed."),
      },
    );
  }

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
        {initialTags.filter(isAwsTag).map((tag) => (
          <div key={tag.key} className="field-row" style={{ gap: 4 }}>
            <input className="input" aria-label="AWS-managed tag key" value={tag.key} readOnly style={{ flex: 1 }} />
            <input className="input" aria-label="AWS-managed tag value" value={tag.value} readOnly style={{ flex: 2 }} />
            <span title="AWS-managed tags cannot be edited or removed">AWS-managed</span>
          </div>
        ))}
        {rows.map((tag, idx) => (
          <div key={idx} className="field-row" style={{ gap: 4 }}>
            <input aria-label="Key"
              className="input"
              placeholder="Key"
              value={tag.key}
              disabled={mutation.isPending}
              onChange={(e) => setKey(idx, e.target.value)}
              style={{ flex: 1 }}
            />
            <input aria-label="Value"
              className="input"
              placeholder="Value"
              value={tag.value}
              disabled={mutation.isPending}
              onChange={(e) => setValue(idx, e.target.value)}
              style={{ flex: 2 }}
            />
            <button className="icon-btn danger" onClick={() => removeRow(idx)} title="Remove" disabled={mutation.isPending}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {err && <p style={{ fontSize: 11, color: "var(--status-error)", margin: "0 0 6px" }}>{err}</p>}

      <div style={{ display: "flex", gap: 6 }}>
        <button className="button compact" onClick={addRow} disabled={mutation.isPending}>
          <Plus size={12} />
          Add tag
        </button>
        <button className="button compact primary" onClick={handleSave} disabled={mutation.isPending}>
          {mutation.isPending ? <Loader2 size={12} /> : <Save size={12} />}
          Save tags
        </button>
      </div>
    </div>
  );
}
