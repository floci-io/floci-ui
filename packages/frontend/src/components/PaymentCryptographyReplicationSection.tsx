import {useState} from "react";
import {useMutation, useQueryClient} from "@tanstack/react-query";
import {Globe2, Plus, Trash2} from "lucide-react";
import {setPaymentCryptographyKeyReplication} from "@/api/cloudProxyClient";
import {getAccountId} from "@/lib/accountStore";
import type {CloudProvider} from "@/types/cloud";
import type {CloudResource} from "@/types/resource";

interface PaymentCryptographyReplicationSectionProps {
  cloud: CloudProvider;
  resource: CloudResource;
  runtimeReachable: boolean;
}

/**
 * The Regions a key is replicated to.
 *
 * <p>A replica is read-only, so the Regions of a replica are the ones its primary
 * holds and the section says so rather than offering the controls.
 */
export function PaymentCryptographyReplicationSection({
  cloud,
  resource,
  runtimeReachable,
}: PaymentCryptographyReplicationSectionProps) {
  const queryClient = useQueryClient();
  // Captured now: an account switch while the request is in flight must not
  // refresh another account's resources.
  const accountId = getAccountId();
  const regions = Array.isArray(resource.metadata.replicationRegions)
    ? (resource.metadata.replicationRegions as string[])
    : [];
  const kind = typeof resource.metadata.multiRegionKeyType === "string"
    ? resource.metadata.multiRegionKeyType
    : null;
  const primary = typeof resource.metadata.primaryRegion === "string"
    ? resource.metadata.primaryRegion
    : null;
  const isReplica = kind === "REPLICA";
  const [region, setRegion] = useState("");

  const save = useMutation({
    mutationFn: (next: string[]) =>
      setPaymentCryptographyKeyReplication(cloud, resource.service, resource.id, {
        replicationRegions: next,
      }),
    onSuccess: () => {
      setRegion("");
      void queryClient.invalidateQueries({
        queryKey: ["cloud-resource", accountId, cloud, resource.service, resource.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ["cloud-resources", accountId, cloud, resource.service],
      });
    },
  });

  return (
    <section className="inspector-section">
      <p className="metric-label">Replication</p>
      {isReplica ? (
        <p className="muted compact-text">
          This key is a replica of the key in {primary ?? "another Region"}, and a replica is
          read-only.
        </p>
      ) : (
        <>
          <p className="muted compact-text">
            The Regions the key is replicated to. A key must be exportable to be replicated.
          </p>
          {regions.length === 0 ? (
            <p className="muted compact-text">The key is replicated to no other Region.</p>
          ) : (
            <div className="metadata-tags">
              {regions.map((each) => (
                <span className="metadata-tag" key={each}>
                  <Globe2 size={12} />
                  <span>{each}</span>
                  <button
                    className="icon-btn"
                    type="button"
                    aria-label={`Stop replicating to ${each}`}
                    disabled={!runtimeReachable || save.isPending}
                    onClick={() => save.mutate(regions.filter((other) => other !== each))}
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="input-row" style={{ padding: "8px 0", borderBottom: "none", background: "none" }}>
            <input
              className="input"
              aria-label="Region to replicate to"
              placeholder="us-east-2"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
            />
            <button
              className="button small"
              type="button"
              disabled={!runtimeReachable || save.isPending || region.trim() === ""}
              onClick={() => save.mutate([...regions, region.trim()])}
            >
              <Plus size={12} />
              Replicate to
            </button>
          </div>
        </>
      )}
      {save.error instanceof Error && (
        <p className="form-error" role="alert">
          {save.error.message}
        </p>
      )}
    </section>
  );
}
