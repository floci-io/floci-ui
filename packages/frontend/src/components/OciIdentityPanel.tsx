import {useEffect, useRef, useState} from "react";
import {ArchiveRestore, Loader2} from "lucide-react";
import {recoverIdentityResource} from "@/api/cloudProxyClient";
import {useAccountId} from "@/lib/accountStore";
import type {CloudResource} from "@/types/resource";

interface OciIdentityPanelProps {
  resource?: CloudResource;
  runtimeReachable: boolean;
  /** Called after a compartment is recovered; it has left the deleted view. */
  onRecovered: () => void;
}

/** Recover for a deleted OCI compartment; every other identity resource has nothing to offer here. */
export function OciIdentityPanel({resource, runtimeReachable, onRecovered}: OciIdentityPanelProps) {
  const accountId = useAccountId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setPending(false);
    setError(null);
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [accountId, resource?.id]);

  if (!resource || resource.cloud !== "oci" || resource.service !== "identity") return null;
  if (resource.type !== "compartment" || resource.status !== "DELETED") return null;

  const recover = async () => {
    if (pending || !runtimeReachable) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setPending(true);
    setError(null);
    try {
      await recoverIdentityResource("oci", resource.id, controller.signal);
      onRecovered();
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not recover the compartment.");
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setPending(false);
      }
    }
  };

  return (
    <section className="table-panel">
      <div className="dynamic-stage-header">
        <div>
          <p className="eyebrow">Identity</p>
          <h2><ArchiveRestore size={15}/> Deleted compartment</h2>
          <p className="muted compact-text">
            Recovering brings {resource.name} back as an active compartment. It keeps the name the delete gave it.
          </p>
        </div>
      </div>
      <div className="resource-create-inline">
        <button className="button primary" type="button" disabled={!runtimeReachable || pending} onClick={() => void recover()}>
          {pending ? <Loader2 size={13} className="spin"/> : null} Recover
        </button>
      </div>
      {error && <p className="error-text compact-text">{error}</p>}
    </section>
  );
}
