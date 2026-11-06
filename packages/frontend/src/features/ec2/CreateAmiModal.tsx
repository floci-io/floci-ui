import { useState } from "react";
import {Icon, HardDrive, Loader2} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import { useCreateAmiMutation } from "@/api/aws/ec2.mutations";
import { ModalOverlay } from "@/components/ModalOverlay";
import {Switch} from '@/components/sodium/ui/switch'

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
    <ModalOverlay onClose={onClose}>
      <div className="create-table-modal max-w-105">
        <h2>Create AMI</h2>

        <div className="modal-section">
          <p className="modal-section-title">Image name</p>
          <Input aria-label="Image name"
            className="w-full min-w-0"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="modal-section">
          <p className="modal-section-title">Description, optional</p>
          <Input aria-label="Description"
            className="w-full min-w-0"
            placeholder="e.g. production snapshot"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="modal-section">
          <div className="field-row items-center">
            <Switch checked={noReboot} onCheckedChange={setNoReboot} aria-label="No reboot" />
            <p className="modal-section-title m-0">No reboot, skip instance restart before imaging</p>
          </div>
        </div>

        {err && <p className="type-caption text-fail-text mt-0 mx-0 mb-2">{err}</p>}

        <div className="modal-footer">
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || mutation.isPending}
          >
            {mutation.isPending ? <Icon icon={Loader2} size={14} /> : <Icon icon={HardDrive} size={14} />}
            Create AMI
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}
