import {useState} from "react";
import {useMutation, useQueryClient} from "@tanstack/react-query";
import {Globe2, Plus, Trash2} from "lucide-react";
import {setPaymentCryptographyKeyReplication} from "@/api/cloudProxyClient";
import {getAccountId} from "@/lib/accountStore";
import type {CloudProvider} from "@/types/cloud";
import type {CloudResource} from "@/types/resource";

export interface PaymentCryptographyReplicationSectionProps {
  cloud: CloudProvider;
  /** The key that was read, when it was read. */
  resource?: CloudResource;
  /** The key itself could not be read, so nothing is known of its Regions. */
  keyUnreadable?: boolean;
  runtimeReachable: boolean;
}

/** The Regions a key is replicated to, and the key they belong to. */
interface ReplicationChange {
  service: string;
  id: string;
  regions: string[];
}

/**
 * The Regions a key is replicated to.
 *
 * <p>A replica is read-only, so the Regions of a replica are the ones its primary
 * holds and the section says so rather than offering the controls.
 *
 * <p>The Regions are the detail's to say, so the section speaks only of a key it
 * has read: a key that is not read yet and a key that could not be read are told
 * apart, and neither of them is shown as a key with no Regions.
 */
export function PaymentCryptographyReplicationSection({
  cloud,
  resource,
  keyUnreadable,
  runtimeReachable,
}: PaymentCryptographyReplicationSectionProps) {
  const queryClient = useQueryClient();
  // Captured now: an account switch while the request is in flight must not
  // refresh another account's resources.
  const accountId = getAccountId();
  const regions = reportedRegions(resource);
  const kind = typeof resource?.metadata.multiRegionKeyType === "string"
    ? resource.metadata.multiRegionKeyType
    : null;
  const primary = typeof resource?.metadata.primaryRegion === "string"
    ? resource.metadata.primaryRegion
    : null;
  const isReplica = kind === "REPLICA";
  const [region, setRegion] = useState("");

  const save = useMutation({
    mutationFn: (change: ReplicationChange) =>
      setPaymentCryptographyKeyReplication(cloud, change.service, change.id, {
        replicationRegions: change.regions,
      }),
    onSettled: (_result, _error, change) => {
      // The Regions that are gone go first, so a change that fails halfway
      // leaves the panel showing what the service now holds.
      setRegion("");
      void queryClient.invalidateQueries({
        queryKey: ["cloud-resource", accountId, cloud, change.service, change.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ["cloud-resources", accountId, cloud, change.service],
      });
    },
  });

  if (keyUnreadable) {
    return (
      <UnknownReplication reason="The key could not be read, so the Regions it is replicated to are unknown." />
    );
  }
  if (!resource) {
    return (
      <UnknownReplication reason="The key has not been read yet, so the Regions it is replicated to are not known yet." />
    );
  }
  if (!regions) {
    return (
      <UnknownReplication reason="The service did not say which Regions the key is replicated to." />
    );
  }

  return (
    <section className="inspector-section">
      <p className="metric-label">Replication</p>
      {isReplica ? (
        <>
          <p className="muted compact-text">
            This key is a replica of the key in {primary ?? "another Region"}, and a replica is
            read-only.
          </p>
          <p className="muted compact-text">
            The Regions the key is replicated to are those of its primary:{" "}
            {regions.length === 0 ? "none reported" : regions.join(", ")}.
          </p>
        </>
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
                    onClick={() =>
                      save.mutate({
                        service: resource.service,
                        id: resource.id,
                        regions: regions.filter((other) => other !== each),
                      })
                    }
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
              onClick={() =>
                save.mutate({
                  service: resource.service,
                  id: resource.id,
                  regions: [...regions, region.trim()],
                })
              }
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

/** The section's frame, with the reason the Regions of the key are not known. */
function UnknownReplication({reason}: {reason: string}) {
  return (
    <section className="inspector-section">
      <p className="metric-label">Replication</p>
      <p className="muted compact-text">{reason}</p>
    </section>
  );
}

/**
 * The Regions the key holds, as the detail answers them.
 *
 * <p>The detail carries them and the table's row carries none of them, so a key
 * that was not read has no Regions to say.
 */
function reportedRegions(resource: CloudResource | undefined): string[] | undefined {
  const regions = resource?.metadata.replicationRegions;
  if (!Array.isArray(regions)) return undefined;
  return regions.filter((each): each is string => typeof each === "string");
}
