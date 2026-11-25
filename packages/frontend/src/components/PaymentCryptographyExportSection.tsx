import {useEffect, useMemo, useRef, useState} from "react";
import {useMutation} from "@tanstack/react-query";
import {Check, Copy, Download} from "lucide-react";
import {exportPaymentCryptographyKey} from "@/api/cloudProxyClient";
import {namesOf} from "@/lib/displayName";
import {pairingsPublished, wrappingKeysFor} from "@/lib/paymentCryptographyWrapping";
import {COPY_REFUSED_MESSAGE, useCopyToClipboard} from "@/lib/useCopyToClipboard";
import type {CloudProvider} from "@/types/cloud";
import type {CloudResource} from "@/types/resource";
import type {ServiceSchema} from "@/types/schema";

interface PaymentCryptographyExportSectionProps {
  cloud: CloudProvider;
  /** The key that was read, when it was read. */
  resource?: CloudResource;
  /**
   * The rows of the service's own list, which name the keys a wrapping key may
   * be chosen from.
   *
   * <p>They are not the rows the table shows: those are the ones the search box
   * and the facet narrowed, and a wrapping key is a key of the account whether
   * the table is showing it or not.
   */
  resources?: CloudResource[];
  /** The list of the account's keys is still being read. */
  resourcesLoading?: boolean;
  /** The list of the account's keys could not be read. */
  resourcesError?: boolean;
  /** The service's schema, which publishes the pairings the service allows. */
  schema?: ServiceSchema;
  runtimeReachable: boolean;
  /** The key itself could not be read, so nothing is known of its material. */
  keyUnreadable?: boolean;
}

/**
 * The material a key leaves under.
 *
 * <p>The form the console offers is the TR-31 block the service wraps with a key
 * the account holds. The wrapping key has to be one the service allows: a key
 * encryption key that may wrap, and at least as strong as the key it carries, which
 * is the reference's own matrix.
 */
export function PaymentCryptographyExportSection({
  cloud,
  resource,
  resources,
  resourcesLoading,
  resourcesError,
  schema,
  runtimeReachable,
  keyUnreadable,
}: PaymentCryptographyExportSectionProps) {
  const [wrappingKey, setWrappingKey] = useState("");
  const {copied, copyFailed, copy, reset: resetCopy} = useCopyToClipboard();
  const activeRequest = useRef<AbortController | null>(null);
  const resourceId = resource?.id;

  // The material of a key the reader has left is not wanted any more, so the
  // request for it is cancelled when the section goes away or the key changes.
  useEffect(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [resourceId]);

  const allowed = useMemo(
    () => (resource ? wrappingKeysFor(resource, resources, schema) : []),
    [resource, resources, schema],
  );

  const exportMut = useMutation({
    // The material is the most secret thing this console holds, so it does not
    // stay in the mutation cache once the section that shows it is gone.
    gcTime: 0,
    mutationFn: async (target: CloudResource) => {
      activeRequest.current?.abort();
      const controller = new AbortController();
      activeRequest.current = controller;
      try {
        return await exportPaymentCryptographyKey(
          cloud,
          target.service,
          target.id,
          {wrappingKeyArn: wrappingKey},
          controller.signal,
        );
      } catch (error) {
        // The reader went away, so the refusal is not about them.
        if (controller.signal.aborted) return null;
        throw error;
      }
    },
  });

  const material = exportMut.data?.keyMaterial ?? "";

  if (keyUnreadable) {
    // The key was not read, so nothing is known of the material it leaves
    // under: the console says that rather than speaking about a key it has
    // not read.
    return (
      <section className="inspector-section">
        <p className="metric-label">Export</p>
        <p className="muted compact-text">
          The key could not be read, so its material is unknown.
        </p>
      </section>
    );
  }
  if (!resource) return null;

  // The API publishes whether the key may leave. A key it said nothing about is
  // neither able to leave nor unable to, so the console does not work the state
  // out for itself.
  const exportable =
    typeof resource.metadata.exportable === "boolean" ? resource.metadata.exportable : null;

  return (
    <section className="inspector-section">
      <p className="metric-label">Export</p>
      <p className="muted compact-text">
        The key leaves under a TR-31 block the service wraps with a key of this account.
      </p>
      <div className="input-row inspector-input-row">
        <select
          className="input"
          aria-label="Wrapping key"
          disabled={exportMut.isPending}
          value={wrappingKey}
          onChange={(event) => {
            setWrappingKey(event.target.value);
            // The material of the last export is not the material of this one, so
            // it goes rather than being left on the screen under another key.
            exportMut.reset();
            // The copy state belongs to the material under the button, so it
            // goes with it.
            resetCopy();
          }}
        >
          <option value="">Choose a wrapping key</option>
          {allowed.map((row) => (
            <option key={row.id} value={row.id}>
              {/* The name the operator knows the key by leads, because an ARN
                  is not something an operator remembers. */}
              {namesOf(row).length > 0 ? `${namesOf(row).join(", ")} · ` : ""}
              {row.metadata.keyUsage ? `${String(row.metadata.keyUsage)} · ` : ""}
              {row.metadata.keyAlgorithm ? `${String(row.metadata.keyAlgorithm)} · ` : ""}
              {row.name}
            </option>
          ))}
        </select>
        <button
          className="button small"
          type="button"
          disabled={
            !runtimeReachable ||
            exportMut.isPending ||
            // The chosen key has to be one of the keys the service still
            // offers, or the request asks it to wrap under a key it refuses.
            !allowed.some((row) => row.id === wrappingKey) ||
            exportable !== true
          }
          onClick={() => {
            // A copy that was made of another material is not a copy of this
            // one, so the state goes before the new material arrives.
            resetCopy();
            exportMut.mutate(resource);
          }}
        >
          <Download size={12} />
          Export key
        </button>
      </div>
      {exportable === false && (
        <p className="muted compact-text">
          This key is not exportable, so its material does not leave. A key that
          has to be shared is made exportable when it is made.
        </p>
      )}
      {exportable === null && (
        <p className="muted compact-text">
          The service did not say whether the key may leave, so the export is not
          offered.
        </p>
      )}
      {allowed.length === 0 && (
        <p className="muted compact-text">
          {candidatesSentence(resources, resourcesLoading, resourcesError, schema)}
        </p>
      )}
      {material && (
        <>
          <textarea
            className="textarea code-textarea"
            readOnly
            rows={6}
            value={material}
            aria-label="Exported key material"
          />
          <button className="button small" type="button" onClick={() => void copy(material)}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
            Copy material
          </button>
          <span className="muted compact-text" role="status">
            {copied ? "Copied" : ""}
          </span>
          {copyFailed && (
            <p className="form-error" role="alert">
              {COPY_REFUSED_MESSAGE}
            </p>
          )}
        </>
      )}
      {exportMut.error instanceof Error && (
        <p className="form-error" role="alert">
          {exportMut.error.message}
        </p>
      )}
    </section>
  );
}

/**
 * What the console says about the keys that may carry this one.
 *
 * <p>The list of the account's keys is not read yet, is being read, and could not
 * be read are three different states, and only the last of them is a statement
 * about the account. The console says which one it is in rather than claiming
 * that the account holds no key that may carry this one.
 */
function candidatesSentence(
  resources: CloudResource[] | undefined,
  loading: boolean | undefined,
  failed: boolean | undefined,
  schema: ServiceSchema | undefined,
): string {
  if (failed) {
    return "The keys of this account could not be read, so it is not known which of them may carry this one.";
  }
  if (loading || resources === undefined) {
    return "The keys of this account have not been read yet, so it is not known which of them may carry this one.";
  }
  if (!pairingsPublished(schema)) {
    return "The service has not published which keys may carry this one, so the console cannot offer one.";
  }
  return "No key of this account may carry this one: a wrapping key has to be a key encryption key that may wrap, and at least as strong as the key it carries.";
}
