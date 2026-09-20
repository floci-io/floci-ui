import { useState } from "react";
import { HardDrive, Loader2 } from "lucide-react";
import { useCreateAmiMutation } from "@/api/aws/ec2.mutations";

interface Props {
  instanceId: string;
  instanceName: string;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateAmiModal({ instanceId, instanceName, onClose, onCreated }: Props) {
  const [name, setName] = useState(`${instanceName}-ami`);
  const [description, setDescription] = useState("");
  const [noReboot, setNoReboot] = useState(false);
  const [err, setErr] = useState("");

  const mutation = useCreateAmiMutation();

  function handleSubmit() {
    if (!name.trim()) { setErr("Name is required."); return; }
    setErr("");
    mutation.mutate(
      { instanceId, input: { name: name.trim(), description: description || undefined, noReboot } },
      {
        onSuccess: () => { onCreated(); onClose(); },
        onError: (e) => setErr(e instanceof Error ? e.message : "AMI creation failed."),
      },
    );
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="create-table-modal" style={{ maxWidth: 420 }}>
        <h3>Create AMI</h3>

        <div className="modal-section">
          <p className="modal-section-title">Image name</p>
          <input
            className="input"
            style={{ width: "100%", minWidth: "unset" }}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
          />
        </div>

        <div className="modal-section">
          <p className="modal-section-title">Description — optional</p>
          <input
            className="input"
            style={{ width: "100%", minWidth: "unset" }}
            placeholder="e.g. production snapshot"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="modal-section">
          <div className="field-row" style={{ alignItems: "center" }}>
            <label className="toggle-switch" style={{ width: 32, height: 18 }}>
              <input type="checkbox" checked={noReboot} onChange={(e) => setNoReboot(e.target.checked)} />
              <span className="toggle-track" />
            </label>
            <p className="modal-section-title" style={{ margin: 0 }}>No reboot — skip instance restart before imaging</p>
          </div>
        </div>

        {err && <p style={{ fontSize: 12, color: "var(--status-error)", margin: "0 0 8px" }}>{err}</p>}

        <div className="modal-footer">
          <button className="button" onClick={onClose} disabled={mutation.isPending}>Cancel</button>
          <button
            className="button primary"
            onClick={handleSubmit}
            disabled={!name.trim() || mutation.isPending}
          >
            {mutation.isPending ? <Loader2 size={13} /> : <HardDrive size={13} />}
            Create AMI
          </button>
        </div>
      </div>
    </div>
  );
}
