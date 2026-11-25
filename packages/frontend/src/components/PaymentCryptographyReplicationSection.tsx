import {useEffect, useRef, useState} from "react";
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

/**
 * The Regions a key is replicated to, and the key they belong to.
 *
 * <p>The Regions the key held when the draft began are kept next to the draft,
 * so a change is diffed against them and not against what the service holds
 * now: a Region that arrived while the panel was open is not one the draft ever
 * had, and a save that named the whole set would take it away.
 */
interface ReplicationChange {
  service: string;
  id: string;
  /** The Regions the key held when the draft began. */
  base: string[];
  /** The Regions the panel shows. */
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
  const reported = reportedRegions(resource);
  const kind = typeof resource?.metadata.multiRegionKeyType === "string"
    ? resource.metadata.multiRegionKeyType
    : null;
  const primary = typeof resource?.metadata.primaryRegion === "string"
    ? resource.metadata.primaryRegion
    : null;
  const isReplica = kind === "REPLICA";
  const [region, setRegion] = useState("");
  // The Regions the key held when the draft began, and the Regions the panel
  // shows. The draft begins with the first change and lives as long as the
  // panel does.
  const [draft, setDraft] = useState<{base: string[]; regions: string[]} | null>(null);

  const save = useMutation({
    mutationFn: (change: ReplicationChange) => {
      // The reference's own commands add and remove one Region at a time, so
      // the request says which Region to add and which to remove rather than a
      // set the service has to diff.
      const add = change.regions.filter((each) => !change.base.includes(each));
      const remove = change.base.filter((each) => !change.regions.includes(each));
      return setPaymentCryptographyKeyReplication(cloud, change.service, change.id, {
        addReplicationRegions: add,
        removeReplicationRegions: remove,
      });
    },
    // Captured now: an account switch while the request is in flight must not
    // refresh another account's resources.
    onMutate: () => ({accountId: getAccountId()}),
    onSuccess: (_result, change) => {
      // The key holds the draft's Regions now, so the next change is diffed
      // against them.
      setDraft((current) => (current ? {...current, base: change.regions} : current));
    },
    onError: (_error, change) => {
      // The change did not happen, so the panel shows the Regions the key holds:
      // a Region the service refused is not on screen, and the next change is
      // not sent it again.
      setDraft((current) => (current ? {base: change.base, regions: change.base} : current));
    },
    onSettled: (_result, _error, change, context) => {
      // The Region that was chosen is gone from the input, and the key is read
      // again, so the panel shows what the service now holds.
      setRegion("");
      if (!context) return;
      void queryClient.invalidateQueries({
        queryKey: ["cloud-resource", context.accountId, cloud, change.service, change.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ["cloud-resources", context.accountId, cloud, change.service],
      });
    },
  });

  // The detail is the truth: when it arrives, the draft is reconciled with it,
  // so a Region another client added is not hidden by the draft. A change that
  // is in flight is not discarded.
  const pendingRef = useRef(false);
  useEffect(() => {
    pendingRef.current = save.isPending;
  }, [save.isPending]);
  useEffect(() => {
    if (pendingRef.current) return;
    const held = reportedRegions(resource);
    if (!held) return;
    setDraft((current) => (current ? {base: held, regions: held} : current));
  }, [resource]);

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
  if (!reported) {
    return (
      <UnknownReplication reason="The service did not say which Regions the key is replicated to." />
    );
  }

  const {service, id} = resource;
  // The Regions the panel shows: the draft's, or the detail's while there is
  // no draft.
  const regions = draft?.regions ?? reported;
  // The Regions the key held when the draft began: the removals are diffed
  // against these and not against what the service holds now.
  const base = draft?.base ?? reported;

  /** A change of the Regions, which is saved as it is made. */
  const change = (next: string[]) => {
    setDraft({base, regions: next});
    save.mutate({service, id, base, regions: next});
  };

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
            The Regions the key is replicated to. A key must be exportable to be
            replicated.
          </p>
          {resource.metadata.exportable === false && (
            <p className="muted compact-text">
              This key is not exportable, so it is not replicated to another
              Region. A key that has to be shared is made exportable.
            </p>
          )}
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
                    onClick={() => change(regions.filter((other) => other !== each))}
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="input-row inspector-input-row">
            <input
              className="input"
              aria-label="Region to replicate to"
              placeholder="us-east-2"
              value={region}
              // The input is cleared when the save settles, so it is closed
              // while the request is in flight: a Region typed now would be
              // wiped without a word.
              disabled={save.isPending}
              onChange={(event) => setRegion(event.target.value)}
            />
            <button
              className="button small"
              type="button"
              // A Region the key is already replicated to is not a change: the
              // diff against the Regions the key holds would be empty, and the
              // request would add and remove nothing, so the input would be
              // cleared and the queries refreshed for a write that never
              // happened.
              disabled={
                !runtimeReachable ||
                save.isPending ||
                region.trim() === "" ||
                regions.includes(region.trim()) ||
                // The reference only lets an exportable key be replicated to
                // another Region, so the control is closed for a key that is
                // not exportable rather than the request being refused.
                resource.metadata.exportable === false
              }
              onClick={() => change([...regions, region.trim()])}
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
