import {useEffect, useRef, useState} from "react";
import {History, Loader2, RefreshCw} from "lucide-react";
import {
  purgeDeletedCertificateResource,
  purgeDeletedKmsResource,
  purgeDeletedSecretResource,
  recoverCertificateResource,
  recoverKmsResource,
  recoverSecretResource,
  rotateKmsResource,
} from "@/api/cloudProxyClient";
import {useAccountId} from "@/lib/accountStore";
import {formatDateTime} from "@/lib/format";
import type {CloudResource} from "@/types/resource";

interface AzureKeyVaultPanelProps {
  resource?: CloudResource;
  runtimeReachable: boolean;
  /**
   * Called after a change. "removed" means the item has left the list it was selected in
   * (recover or purge); "updated" means it is still there with new content (rotate).
   */
  onChanged: (change: "removed" | "updated") => void;
}

type KeyVaultOperation = (cloud: "azure", id: string, signal?: AbortSignal) => Promise<unknown>;

const KEY_VAULT_KINDS: Record<string, {noun: string; label: string; notice: string; recover: KeyVaultOperation; purge: KeyVaultOperation}> = {
  secrets: {
    noun: "secret", label: "Secret", notice: "Secret values are never shown in the console.",
    recover: recoverSecretResource, purge: purgeDeletedSecretResource,
  },
  kms: {
    noun: "key", label: "Key", notice: "Key material is never shown in the console.",
    recover: recoverKmsResource, purge: purgeDeletedKmsResource,
  },
  certificates: {
    noun: "certificate", label: "Certificate", notice: "Private keys are never shown in the console.",
    recover: recoverCertificateResource, purge: purgeDeletedCertificateResource,
  },
};

interface SecretVersion {
  version: string;
  enabled: boolean;
  createdAt: string | null;
  contentType?: string | null;
  current: boolean | null;
}

export function AzureKeyVaultPanel({resource, runtimeReachable, onChanged}: AzureKeyVaultPanelProps) {
  const accountId = useAccountId();
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setConfirmPurge(false);
    setPending(false);
    setError(null);
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [accountId, resource?.id]);

  if (!resource || resource.cloud !== "azure" || !(resource.service in KEY_VAULT_KINDS)) return null;

  const kind = KEY_VAULT_KINDS[resource.service];
  const isKey = resource.service === "kms";
  const isSecret = resource.service === "secrets";
  const noun = kind.noun;
  const deleted = resource.status === "deleted";
  const versions = secretVersions(resource.metadata.versions);

  const run = async (operation: "recover" | "purge" | "rotate") => {
    if (pending || !runtimeReachable) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setPending(true);
    setError(null);
    try {
      if (operation === "rotate") await rotateKmsResource("azure", resource.id, controller.signal);
      else if (operation === "recover") {
        await kind.recover("azure", resource.id, controller.signal);
      } else await kind.purge("azure", resource.id, controller.signal);
      onChanged(operation === "rotate" ? "updated" : "removed");
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Key Vault operation failed.");
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setPending(false);
        setConfirmPurge(false);
      }
    }
  };

  return (
    <section className="table-panel">
      <div className="dynamic-stage-header">
        <div>
          <p className="eyebrow">Key Vault</p>
          <h2><History size={15}/> {deleted ? `Deleted ${noun}` : `${kind.label} versions`}</h2>
          <p className="muted compact-text">{kind.notice}</p>
        </div>
        {isKey && !deleted && (
          <button className="button" type="button" disabled={!runtimeReachable || pending || resource.status !== "enabled"} onClick={() => void run("rotate")}>
            {pending ? <Loader2 size={13} className="spin"/> : <RefreshCw size={13}/>} Rotate key
          </button>
        )}
      </div>
      {deleted ? (
        <div className="resource-create-inline">
          <p className="muted compact-text">
            Deleted {formatDateTime(resource.metadata.deletedAt) ?? "-"}. It is purged automatically on{" "}
            {formatDateTime(resource.metadata.scheduledPurgeAt) ?? "-"}.
          </p>
          {confirmPurge ? (
            <>
              <p className="error-text compact-text">Purging permanently removes {resource.name} and all of its versions.</p>
              <button className="button danger" type="button" disabled={!runtimeReachable || pending} onClick={() => void run("purge")}>
                {pending ? <Loader2 size={13} className="spin"/> : null} Confirm purge
              </button>
              <button className="button" type="button" disabled={pending} onClick={() => setConfirmPurge(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button className="button primary" type="button" disabled={!runtimeReachable || pending} onClick={() => void run("recover")}>
                {pending ? <Loader2 size={13} className="spin"/> : null} Recover
              </button>
              <button className="button danger" type="button" disabled={!runtimeReachable || pending} onClick={() => setConfirmPurge(true)}>
                Purge
              </button>
            </>
          )}
        </div>
      ) : versions.length === 0 ? (
        <p className="muted compact-text">No versions returned for this {noun}.</p>
      ) : (
        <div className="table-scroll">
          <table className="table resource-table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th>Created</th>
                {isSecret && <th>Content type</th>}
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr key={version.version}>
                  <td>
                    <code>{version.version}</code>
                    {version.current ? <span className="badge neutral"> current</span> : null}
                  </td>
                  <td>{version.enabled ? "enabled" : "disabled"}</td>
                  <td>{formatDateTime(version.createdAt) ?? "-"}</td>
                  {isSecret && <td>{version.contentType ?? "-"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <p className="error-text compact-text">{error}</p>}
    </section>
  );
}

function secretVersions(value: unknown): SecretVersion[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is SecretVersion => (
    typeof entry === "object" && entry !== null && typeof (entry as SecretVersion).version === "string"
  ));
}
