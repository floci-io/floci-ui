import {useState} from "react";
import {Check, Copy} from "lucide-react";
import type {CloudProvider} from "@/types/cloud";
import type {CloudResource} from "@/types/resource";

interface PaymentCryptographyCertificateSectionProps {
  cloud: CloudProvider;
  resource: CloudResource;
  runtimeReachable: boolean;
}

/**
 * The certificate of an asymmetric key's public half.
 *
 * <p>The reference signs the public half into a certificate and hands it out, and
 * a key with no public half has none: the section says so rather than showing
 * nothing.
 */
export function PaymentCryptographyCertificateSection({
  resource,
}: PaymentCryptographyCertificateSectionProps) {
  const [copied, setCopied] = useState(false);
  const certificate = typeof resource.metadata.publicKeyCertificate === "string"
    ? resource.metadata.publicKeyCertificate
    : "";

  if (!certificate) {
    return (
      <section className="inspector-section">
        <p className="metric-label">Public Key Certificate</p>
        <p className="muted compact-text">
          This key has no public half, so it has no certificate.
        </p>
      </section>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(certificate);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="inspector-section">
      <p className="metric-label">Public Key Certificate</p>
      <p className="muted compact-text">
        The public half of the key, signed into a certificate by the service.
      </p>
      <textarea
        className="textarea code-textarea"
        readOnly
        rows={6}
        value={certificate}
        aria-label="Public key certificate"
      />
      <button className="button small" type="button" onClick={copy}>
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? "Copied" : "Copy certificate"}
      </button>
    </section>
  );
}
