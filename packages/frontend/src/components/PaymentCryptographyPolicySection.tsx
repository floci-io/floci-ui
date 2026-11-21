import {useEffect, useState} from "react";
import {useMutation, useQueryClient} from "@tanstack/react-query";
import {ShieldCheck, Trash2} from "lucide-react";
import {setPaymentCryptographyKeyPolicy} from "@/api/cloudProxyClient";
import {getAccountId} from "@/lib/accountStore";
import type {CloudProvider} from "@/types/cloud";
import type {CloudResource} from "@/types/resource";

interface PaymentCryptographyPolicySectionProps {
  cloud: CloudProvider;
  resource: CloudResource;
  runtimeReachable: boolean;
}

/**
 * The resource-based policy of a key.
 *
 * <p>A policy is what lets another account use the key, and the reference refuses
 * one that grants public access.
 */
export function PaymentCryptographyPolicySection({
  cloud,
  resource,
  runtimeReachable,
}: PaymentCryptographyPolicySectionProps) {
  const queryClient = useQueryClient();
  // Captured now: an account switch while the request is in flight must not
  // refresh another account's resources.
  const accountId = getAccountId();
  const held = typeof resource.metadata.keyPolicy === "string" ? resource.metadata.keyPolicy : "";
  const [policy, setPolicy] = useState(held);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setPolicy(held);
    setEditing(false);
  }, [held, resource.id]);

  const save = useMutation({
    mutationFn: (next: string) =>
      setPaymentCryptographyKeyPolicy(cloud, resource.service, resource.id, { policy: next }),
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({
        queryKey: ["cloud-resource", accountId, cloud, resource.service, resource.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ["cloud-resources", accountId, cloud, resource.service],
      });
    },
  });

  const remove = useMutation({
    mutationFn: () => setPaymentCryptographyKeyPolicy(cloud, resource.service, resource.id, { policy: "" }),
    onSuccess: () => {
      setEditing(false);
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
      <p className="metric-label">Key Policy</p>
      {editing ? (
        <>
          <textarea
            className="textarea code-textarea"
            rows={8}
            value={policy}
            aria-label="Key policy"
            onChange={(event) => setPolicy(event.target.value)}
          />
          <button
            className="button small primary"
            type="button"
            disabled={save.isPending || policy.trim() === ""}
            onClick={() => save.mutate(policy)}
          >
            Save policy
          </button>{" "}
          <button
            className="button small"
            type="button"
            onClick={() => {
              // The draft is gone: the policy the key holds is what the editor
              // shows the next time it is opened.
              setPolicy(held);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <p className="muted compact-text">
            {held
              ? "The policy that lets another account use this key."
              : "No policy: the key is used only by the account that holds it."}
          </p>
          <button
            className="button small"
            type="button"
            disabled={!runtimeReachable}
            onClick={() => setEditing(true)}
          >
            <ShieldCheck size={12} />
            {held ? "Edit policy" : "Attach a policy"}
          </button>{" "}
          {held && (
            <button
              className="button small"
              type="button"
              disabled={!runtimeReachable || remove.isPending}
              onClick={() => remove.mutate()}
            >
              <Trash2 size={12} />
              Remove policy
            </button>
          )}
        </>
      )}
      {(save.error instanceof Error || remove.error instanceof Error) && (
        <p className="form-error" role="alert">
          {(save.error ?? remove.error) instanceof Error
            ? ((save.error ?? remove.error) as Error).message
            : ""}
        </p>
      )}
    </section>
  );
}
