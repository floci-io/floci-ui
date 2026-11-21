import {useMemo, useState} from "react";
import {useMutation} from "@tanstack/react-query";
import {Check, Copy, Download} from "lucide-react";
import {exportPaymentCryptographyKey} from "@/api/cloudProxyClient";
import {wrappingKeysFor} from "@/lib/paymentCryptographyWrapping";
import type {CloudProvider} from "@/types/cloud";
import type {CloudResource} from "@/types/resource";
import type {ServiceSchema} from "@/types/schema";

interface PaymentCryptographyExportSectionProps {
  cloud: CloudProvider;
  resource: CloudResource;
  /** The rows of the list, which name the keys a wrapping key may be chosen from. */
  resources?: CloudResource[];
  /** The service's schema, which publishes the pairings the service allows. */
  schema?: ServiceSchema;
  runtimeReachable: boolean;
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
  schema,
  runtimeReachable,
}: PaymentCryptographyExportSectionProps) {
  const [wrappingKey, setWrappingKey] = useState("");
  const [copied, setCopied] = useState(false);

  const allowed = useMemo(
    () => wrappingKeysFor(resource, resources, schema),
    [resource, resources, schema],
  );

  const exportMut = useMutation({
    mutationFn: () =>
      exportPaymentCryptographyKey(cloud, resource.service, resource.id, {
        wrappingKeyArn: wrappingKey,
      }),
  });

  const material = exportMut.data?.keyMaterial ?? "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(material);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="inspector-section">
      <p className="metric-label">Export</p>
      <p className="muted compact-text">
        The key leaves under a TR-31 block the service wraps with a key of this account.
      </p>
      <div
        className="input-row"
        style={{ padding: "8px 0", borderBottom: "none", background: "none" }}
      >
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
            setCopied(false);
          }}
        >
          <option value="">Choose a wrapping key</option>
          {allowed.map((row) => (
            <option key={row.id} value={row.id}>
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
          onClick={() => exportMut.mutate()}
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
          No key of this account may carry this one: a wrapping key has to be a key
          encryption key that may wrap, and at least as strong as the key it carries.
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
          <button className="button small" type="button" onClick={copy}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy material"}
          </button>
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
