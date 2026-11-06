import {useEffect, useRef, useState} from "react";
import {Icon, Loader2, Power} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {powerComputeResource, type ComputePowerAction} from "@/api/cloudProxyClient";
import {capabilityEnabled, capabilityFor} from "@/lib/capabilities";
import type {CloudResource} from "@/types/resource";
import type {CapabilitySchema, ResourceActionName} from "@/types/schema";

interface ComputePowerPanelProps {
  resource?: CloudResource;
  capabilities: Array<CapabilitySchema<ResourceActionName>>;
  onChanged: () => void;
}

const ACTIONS: Array<{action: ComputePowerAction; fallbackLabel: string}> = [
  {action: "start", fallbackLabel: "Start"},
  {action: "stop", fallbackLabel: "Stop"},
  {action: "reboot", fallbackLabel: "Restart"},
];

/** Azure reports `running`, GCP `RUNNING`; anything else counts as not running. */
function isRunning(resource: CloudResource): boolean {
  return resource.status?.toLowerCase() === "running";
}

export function ComputePowerPanel({resource, capabilities, onChanged}: ComputePowerPanelProps) {
  const [pending, setPending] = useState<ComputePowerAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentId = useRef(resource?.id);

  useEffect(() => {
    currentId.current = resource?.id;
    setPending(null);
    setError(null);
  }, [resource?.id]);

  const offered = ACTIONS.map((entry) => ({...entry, capability: capabilityFor(capabilities, entry.action)}))
    .filter((entry) => entry.capability);
  if (!resource || resource.type !== "instance" || offered.length === 0) return null;

  const stateKnown = resource.status != null;
  const running = isRunning(resource);
  // An unknown state (Azure could not read the power state) is not evidence the VM is stopped.
  const appliesNow = (action: ComputePowerAction) => !stateKnown || (action === "start" ? !running : running);

  const run = async (action: ComputePowerAction) => {
    const id = resource.id;
    const stale = () => currentId.current !== id;
    setPending(action);
    setError(null);
    try {
      await powerComputeResource(resource.cloud, id, action);
      onChanged();
    } catch (err) {
      if (!stale()) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!stale()) setPending(null);
    }
  };

  return (
    <section className="table-panel">
      <div className="dynamic-stage-header">
        <div>
          <p className="eyebrow">Instance Actions</p>
          <h2><Icon icon={Power} /> Power state</h2>
          <p className="muted compact-text">Current state: {resource.status ?? "unknown"}</p>
        </div>
      </div>
      <div className="resource-create-inline">
        {offered.map(({action, fallbackLabel, capability}) => (
          <Button title={capability?.reason} variant="secondary"
            key={action}
            type="button"
            disabled={!capabilityEnabled(capability) || pending !== null || !appliesNow(action)}
            onClick={() => void run(action)}
          >
            {pending === action ? <Icon icon={Loader2} size={14} className="spin"/> : null} {capability?.label ?? fallbackLabel}
          </Button>
        ))}
        {error && <p className="form-error">{error}</p>}
      </div>
    </section>
  );
}
