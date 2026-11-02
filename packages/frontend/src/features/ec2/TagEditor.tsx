import { useState } from "react";
import {Icon, Loader2, PlusSquared as Plus, Save, Trash2} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import { useUpdateEc2InstanceTagsMutation } from "@/api/aws/ec2.mutations";
import type { Ec2Tag } from "@/api/aws/ec2.api";
import {Hint} from '@/components/Hint'

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
      <div className="flex flex-col gap-1 mb-2">
        {initialTags.filter(isAwsTag).map((tag) => (
          <div key={tag.key} className="field-row gap-1">
            <Input className="flex-1" aria-label="AWS-managed tag key" value={tag.key} readOnly />
            <Input className="flex-2" aria-label="AWS-managed tag value" value={tag.value} readOnly />
            <span title="AWS-managed tags cannot be edited or removed">AWS-managed</span>
          </div>
        ))}
        {rows.map((tag, idx) => (
          <div key={idx} className="field-row gap-1">
            <Input aria-label="Key"
              className="flex-1"
              placeholder="Key"
              value={tag.key}
              disabled={mutation.isPending}
              onChange={(e) => setKey(idx, e.target.value)}
            />
            <Input className="flex-2" aria-label="Value"
              placeholder="Value"
              value={tag.value}
              disabled={mutation.isPending}
              onChange={(e) => setValue(idx, e.target.value)}
            />
            <Hint label="Remove"><Button variant="ghost" size="icon-sm" onClick={() => removeRow(idx)} aria-label="Remove" disabled={mutation.isPending}>
              <Icon icon={Trash2} size={14} />
            </Button></Hint>
          </div>
        ))}
      </div>

      {err && <p className="type-caption text-fail-text mt-0 mx-0 mb-1.5">{err}</p>}

      <div className="flex gap-1.5">
        <Button variant="secondary" size="sm" onClick={addRow} disabled={mutation.isPending}>
          <Icon icon={Plus} size={14} />
          Add tag
        </Button>
        <Button size="sm" onClick={handleSave} disabled={mutation.isPending}>
          {mutation.isPending ? <Icon icon={Loader2} size={14} /> : <Icon icon={Save} size={14} />}
          Save tags
        </Button>
      </div>
    </div>
  );
}
