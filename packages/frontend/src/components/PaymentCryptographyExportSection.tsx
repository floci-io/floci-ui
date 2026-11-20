import {useState} from "react";
import {useMutation} from "@tanstack/react-query";
import {Check, Copy, Download} from "lucide-react";
import {exportPaymentCryptographyKey} from "@/api/cloudProxyClient";
import type {CloudProvider} from "@/types/cloud";
import type {CloudResource} from "@/types/resource";

interface PaymentCryptographyExportSectionProps {
  cloud: CloudProvider;
  resource: CloudResource;
  resources?: CloudResource[];
  runtimeReachable: boolean;
}

/**
 * The material a key leaves under.
 *
 * <p>The form the console offers is the TR-31 block the service wraps with a key
 * the account holds, and the wrapping key has to be one that may wrap and is at
 * least as strong as the key it carries.
 */
export function PaymentCryptographyExportSection({
  cloud,
  resource,
  resources,
  runtimeReachable,
}: PaymentCryptographyExportSectionProps) {
  const [wrappingKey, setWrappingKey] = useState("");
  const [copied, setCopied] = useState(false);
  const keys = (resources ?? []).filter((row) => row.type === "key");

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
      <div className="input-row" style={{ padding: "8px 0", borderBottom: "none", background: "none" }}>
        <select
          className="input"
          aria-label="Wrapping key"
          value={wrappingKey}
          onChange={(event) => setWrappingKey(event.target.value)}
        >
          <option value="">Choose a wrapping key</option>
          {keys.map((row) => (
            <option key={row.id} value={row.id}>
              {row.metadata.keyUsage ? `${String(row.metadata.keyUsage)} · ` : ""}
              {row.name}
            </option>
          ))}
        </select>
        <button
          className="button small"
          type="button"
          disabled={!runtimeReachable || exportMut.isPending || wrappingKey === ""}
          onClick={() => exportMut.mutate()}
        >
          <Download size={12} />
          Export key
        </button>
      </div>
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
