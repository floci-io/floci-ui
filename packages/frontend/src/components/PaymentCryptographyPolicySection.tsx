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
 * The state the API published for the policy of a key.
 *
 * <p>The API owns the state: it publishes the policy where it read one, it
 * publishes none where it did not read one, and it says so when the read
 * failed. The console only picks the sentence.
 */
type PolicyState = "held" | "none" | "unreadable" | "not-read";

/** What the console says for each state the API published. */
const POLICY_SENTENCES: Record<PolicyState, string> = {
  held: "The policy that lets another account use this key.",
  none: "No policy: the key is used only by the account that holds it.",
  unreadable: "The policy could not be read.",
  "not-read": "The policy has not been read yet.",
};

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
  const state = policyState(resource);
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
          <p className="muted compact-text">{POLICY_SENTENCES[state]}</p>
          {(state === "held" || state === "none") && (
            <button
              className="button small"
              type="button"
              disabled={!runtimeReachable}
              onClick={() => setEditing(true)}
            >
              <ShieldCheck size={12} />
              {state === "held" ? "Edit policy" : "Attach a policy"}
            </button>
          )}{" "}
          {state === "held" && (
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

/**
 * The state the metadata of a key publishes for its policy.
 *
 * <p>The names are the API's own, so they are read as own properties: a name
 * inherited from the prototype is not a state the API published.
 */
function policyState(resource: CloudResource): PolicyState {
  const metadata = resource.metadata;
  if (metadata.keyPolicyUnavailable === true) return "unreadable";
  if (!Object.prototype.hasOwnProperty.call(metadata, "keyPolicy")) return "not-read";
  return typeof metadata.keyPolicy === "string" ? "held" : "none";
}
