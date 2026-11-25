import {useMemo, useState} from "react";
import {useMutation} from "@tanstack/react-query";
import {Copy, Download} from "lucide-react";
import {exportPaymentCryptographyKey} from "@/api/cloudProxyClient";
import {aliasNamesOf} from "@/lib/paymentCryptography";
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
  const {copied, copyFailed, copy} = useCopyToClipboard();

  const allowed = useMemo(
    () => (resource ? wrappingKeysFor(resource, resources, schema) : []),
    [resource, resources, schema],
  );

  const exportMut = useMutation({
    mutationFn: (target: CloudResource) =>
      exportPaymentCryptographyKey(cloud, target.service, target.id, {
        wrappingKeyArn: wrappingKey,
      }),
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
  if (!resource) {
    // The key has not been read yet, so the section says that rather than
    // disappearing and coming back once the detail arrives.
    return (
      <section className="inspector-section">
        <p className="metric-label">Export</p>
        <p className="muted compact-text">
          The key has not been read yet, so what it leaves under is not known yet.
        </p>
      </section>
    );
  }

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
          }}
        >
          <option value="">Choose a wrapping key</option>
          {allowed.map((row) => (
            <option key={row.id} value={row.id}>
              {/* The name the operator knows the key by leads, because an ARN
                  is not something an operator remembers. */}
              {aliasNamesOf(row).length > 0 ? `${aliasNamesOf(row).join(", ")} · ` : ""}
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
            wrappingKey === "" ||
            resource.metadata.exportable === false
          }
          onClick={() => exportMut.mutate(resource)}
        >
          <Download size={12} />
          Export key
        </button>
      </div>
      {resource.metadata.exportable === false && (
        <p className="muted compact-text">
          This key is not exportable, so its material does not leave. A key that
          has to be shared is made exportable.
        </p>
      )}
      {allowed.length === 0 && (
        <p className="muted compact-text">
          {candidatesSentence(resources, resourcesLoading, resourcesError, schema)}
        </p>
      )}
      {exportMut.isSuccess && !material && (
        <p className="muted compact-text">
          The service answered the export without any material, so there is nothing to copy.
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
            <Copy size={12} />
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
