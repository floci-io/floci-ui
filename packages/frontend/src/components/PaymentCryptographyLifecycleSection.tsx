import {useMutation, useQueryClient} from "@tanstack/react-query";
import {Power, PowerOff} from "lucide-react";
import {setPaymentCryptographyKeyUsage} from "@/api/cloudProxyClient";
import {getAccountId} from "@/lib/accountStore";
import {getRegion} from "@/lib/regionStore";
import type {CloudProvider} from "@/types/cloud";
import type {CloudResource} from "@/types/resource";

interface PaymentCryptographyLifecycleSectionProps {
  cloud: CloudProvider;
  /** The key that was read, when it was read. */
  resource?: CloudResource;
  /** The key itself could not be read, so nothing is known of its usage. */
  keyUnreadable?: boolean;
  runtimeReachable: boolean;
}

/**
 * Whether a key may be used.
 *
 * <p>Disabling a key is the reversible alternative to deleting it: the key stays
 * readable and does no work until it is enabled again.
 */
export function PaymentCryptographyLifecycleSection({
  cloud,
  resource,
  keyUnreadable,
  runtimeReachable,
}: PaymentCryptographyLifecycleSectionProps) {
  return (
    <section className="inspector-section">
      <p className="metric-label">Usage</p>
      {resource ? (
        <KeyUsage cloud={cloud} resource={resource} runtimeReachable={runtimeReachable} />
      ) : (
        <p className="muted compact-text">
          {keyUnreadable
            ? "The key could not be read, so whether it may be used is unknown."
            : "The key has not been read yet, so whether it may be used is unknown."}
        </p>
      )}
    </section>
  );
}

/**
 * The usage of a key that was read.
 *
 * <p>The key is on screen because its detail was read, so its usage is the usage
 * that detail published.
 */
function KeyUsage({
  cloud,
  resource,
  runtimeReachable,
}: {
  cloud: CloudProvider;
  resource: CloudResource;
  runtimeReachable: boolean;
}) {
  const queryClient = useQueryClient();
  // Captured now: an account or region switch while the request is in flight
  // must not refresh another account's or region's resources.
  const accountId = getAccountId();
  const region = getRegion();
  // The API publishes whether the key may be used. A key it said nothing about
  // is neither in use nor out of use, so the console does not work the state
  // out for itself.
  const enabled =
    typeof resource.metadata.enabled === "boolean" ? resource.metadata.enabled : null;
  const start = typeof resource.metadata.usageStartTimestamp === "string"
    ? resource.metadata.usageStartTimestamp
    : null;
  const stop = typeof resource.metadata.usageStopTimestamp === "string"
    ? resource.metadata.usageStopTimestamp
    : null;

  const toggle = useMutation({
    mutationFn: (next: boolean) =>
      setPaymentCryptographyKeyUsage(cloud, resource.service, resource.id, { enabled: next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["cloud-resource", accountId, region, cloud, resource.service, resource.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ["cloud-resources", accountId, region, cloud, resource.service],
      });
    },
  });

  return (
    <>
      <p className="muted compact-text">{usageSentence(enabled)}</p>
      {enabled !== null && (
        <button
          className="button small"
          type="button"
          disabled={!runtimeReachable || toggle.isPending}
          onClick={() => toggle.mutate(!enabled)}
        >
          {enabled ? <PowerOff size={12} /> : <Power size={12} />}
          {enabled ? "Disable key" : "Enable key"}
        </button>
      )}
      {(start || stop) && (
        <p className="muted compact-text">
          {start ? `In use since ${start}.` : ""} {stop ? `Out of use from ${stop}.` : ""}
        </p>
      )}
      {toggle.error instanceof Error && (
        <p className="form-error" role="alert">
          {toggle.error.message}
        </p>
      )}
    </>
  );
}

/**
 * What the console says about a key's usage.
 *
 * <p>The API names the state a key's usage is in, so the console only chooses the
 * sentence: a state the console worked out for itself is a state that can drift
 * from the one the API means.
 */
function usageSentence(enabled: boolean | null): string {
  if (enabled === null) return "The service did not say whether the key may be used.";
  return enabled
    ? "The key may be used. Disabling it is the reversible alternative to deleting it."
    : "The key is disabled: no operation runs under it until it is enabled again.";
}
