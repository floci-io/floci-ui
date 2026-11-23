import {useEffect, useRef, useState} from "react";
import {Check, Copy, KeyRound} from "lucide-react";
import type {CloudResource} from "@/types/resource";

interface PaymentCryptographyCertificateSectionProps {
  /** The key that was read, when it was read. */
  resource?: CloudResource;
  /** The key could not be read, so nothing is known of its certificate. */
  unreadable?: boolean;
}

/**
 * The certificate of an asymmetric key's public half.
 *
 * <p>The reference signs the public half into a certificate and hands it out, and
 * a key with no public half has none: the section says which of the states it is
 * rather than showing nothing.
 */
export function PaymentCryptographyCertificateSection({
  resource,
  unreadable,
}: PaymentCryptographyCertificateSectionProps) {
  const [copied, setCopied] = useState<"certificate" | "chain" | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyRequestRef = useRef(0);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) clearTimeout(copyResetTimerRef.current);
    };
  }, []);

  if (unreadable) {
    return (
      <section className="table-panel">
        <div className="dynamic-stage-header">
          <div>
            <p className="eyebrow">Payment Cryptography</p>
            <h2>
              <KeyRound size={15} /> Public Key Certificate
            </h2>
            <p className="muted compact-text">The key could not be read, so its certificate is unknown.</p>
          </div>
        </div>
      </section>
    );
  }

  if (!resource) return null;

  const certificate =
    typeof resource.metadata.publicKeyCertificate === "string"
      ? resource.metadata.publicKeyCertificate
      : "";
  const chain =
    typeof resource.metadata.publicKeyCertificateChain === "string"
      ? resource.metadata.publicKeyCertificateChain
      : "";
  const description = certificate
    ? "The public half of the key, signed into a certificate by the service."
    : certificateReason(resource);

  const copyText = async (text: string, which: "certificate" | "chain") => {
    const request = ++copyRequestRef.current;
    if (copyResetTimerRef.current !== null) {
      clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }
    setCopied(null);
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(text);
      if (request !== copyRequestRef.current) return;
      setCopied(which);
      copyResetTimerRef.current = setTimeout(() => {
        if (request === copyRequestRef.current) setCopied(null);
        copyResetTimerRef.current = null;
      }, 1500);
    } catch {
      if (request !== copyRequestRef.current) return;
      // The clipboard is refused in some contexts and denied by some browsers,
      // and a button that does nothing looks broken, so the failure is said.
      setCopyFailed(true);
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
          <p className="muted compact-text">{description}</p>
        </div>
      </div>
      {certificate && (
        <>
          <textarea
            className="textarea code-textarea"
            readOnly
            rows={6}
            value={certificate}
            aria-label="Public key certificate"
            spellCheck={false}
          />
          <button className="button small" type="button" onClick={() => void copyText(certificate, "certificate")}>
            {copied === "certificate" ? <Check size={12} /> : <Copy size={12} />}
            <span role="status">{copied === "certificate" ? "Copied" : "Copy certificate"}</span>
          </button>
        </>
      )}
      {chain && (
        <>
          <p className="muted compact-text">
            The chain the certificate is signed in, which a reader verifies it against.
          </p>
          <textarea
            className="textarea code-textarea"
            readOnly
            rows={4}
            value={chain}
            aria-label="Public key certificate chain"
            spellCheck={false}
          />
          <button className="button small" type="button" onClick={() => void copyText(chain, "chain")}>
            {copied === "chain" ? <Check size={12} /> : <Copy size={12} />}
            <span role="status">{copied === "chain" ? "Copied" : "Copy chain"}</span>
          </button>
        </>
      )}
      {copyFailed && (
        <p className="form-error" role="alert">
          The clipboard was not available, so nothing was copied.
        </p>
      )}
    </section>
  );
}

/**
 * Why there is no certificate to show.
 *
 * <p>The API names the state a key's certificate is in, so the console only picks
 * the words: a rule the console had to work out for itself is a rule that can
 * drift from the one the API means.
 */
function certificateReason(resource: CloudResource): string {
  switch (resource.metadata.publicKeyCertificateState) {
    case "no-public-half":
      return "This key has no public half, so it has no certificate.";
    case "unsigned":
      return "The service has not signed a certificate for this key.";
    case "unreadable":
      return "The certificate could not be read.";
    case "unknown":
      return "The service did not say what kind of key this is, so it has not said whether it has a public half.";
    default:
      return "The service has not signed a certificate for this key.";
  }
}
