import {useState} from "react";
import {Check, Copy, KeyRound} from "lucide-react";
import type {CloudResource} from "@/types/resource";

interface PaymentCryptographyCertificateSectionProps {
  resource: CloudResource;
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
  const certificate =
    typeof resource.metadata.publicKeyCertificate === "string"
      ? resource.metadata.publicKeyCertificate
      : "";

  if (!certificate) {
    return (
      <section className="table-panel">
        <div className="dynamic-stage-header">
          <div>
            <p className="eyebrow">Payment Cryptography</p>
            <h2>
              <KeyRound size={15} /> Public Key Certificate
            </h2>
            <p className="muted compact-text">{certificateReason(resource)}</p>
          </div>
        </div>
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
    <section className="table-panel">
      <div className="dynamic-stage-header">
        <div>
          <p className="eyebrow">Payment Cryptography</p>
          <h2>
            <KeyRound size={15} /> Public Key Certificate
          </h2>
          <p className="muted compact-text">
            The public half of the key, signed into a certificate by the service.
          </p>
        </div>
      </div>
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

/**
 * Why there is no certificate to show.
 *
 * <p>A key of a pair has a certificate, a symmetric key has no public half at
 * all, and a read that failed is neither of those: each says so in its own
 * words, so the console never tells a caller that a key has no certificate when
 * the certificate was simply not read.
 */
function certificateReason(resource: CloudResource): string {
  if (resource.metadata.publicKeyCertificateUnavailable === true) {
    return "The certificate could not be read.";
  }
  if (resource.metadata.keyClass !== "ASYMMETRIC_KEY_PAIR") {
    return "This key has no public half, so it has no certificate.";
  }
  return "The service has not signed a certificate for this key.";
}
