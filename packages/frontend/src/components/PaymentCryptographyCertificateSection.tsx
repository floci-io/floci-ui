import {useEffect, useRef, useState} from "react";
import {Check, Copy, KeyRound} from "lucide-react";
import type {CloudResource} from "@/types/resource";

export interface PaymentCryptographyCertificateSectionProps {
  /** The key that was read, when it was read. */
  resource?: CloudResource;
  /** The key itself could not be read, so nothing is known of its certificate. */
  keyUnreadable?: boolean;
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
  keyUnreadable,
}: PaymentCryptographyCertificateSectionProps) {
  const [copied, setCopied] = useState<"certificate" | "chain" | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyRequestRef = useRef(0);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      // A write that resolves after the section is gone is stale, and the
      // request counter is what says so.
      copyRequestRef.current += 1;
      if (copyResetTimerRef.current !== null) clearTimeout(copyResetTimerRef.current);
    };
  }, []);

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

  const certificate =
    typeof resource?.metadata.publicKeyCertificate === "string"
      ? resource.metadata.publicKeyCertificate
      : "";
  const chain =
    typeof resource?.metadata.publicKeyCertificateChain === "string"
      ? resource.metadata.publicKeyCertificateChain
      : "";

  return (
    <section className="table-panel">
      <CertificateHeader
        description={
          keyUnreadable
            ? "The key could not be read, so its certificate is unknown."
            : certificate
              ? "The public half of the key, signed into a certificate by the service."
              : certificateReason(resource)
        }
      />
      {certificate && (
        <CopyableValue
          label="Public key certificate"
          value={certificate}
          rows={6}
          copyLabel="Copy certificate"
          copied={copied === "certificate"}
          onCopy={() => void copyText(certificate, "certificate")}
        />
      )}
      {chain && (
        <>
          <p className="muted compact-text">
            The chain the certificate is signed in, which a reader verifies it against.
          </p>
          <CopyableValue
            label="Public key certificate chain"
            value={chain}
            rows={4}
            copyLabel="Copy chain"
            copied={copied === "chain"}
            onCopy={() => void copyText(chain, "chain")}
          />
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

/** The heading the section carries, whatever it has to say under it. */
function CertificateHeader({description}: {description: string}) {
  return (
    <div className="dynamic-stage-header">
      <div>
        <p className="eyebrow">Payment Cryptography</p>
        <h2>
          <KeyRound size={15} /> Public Key Certificate
        </h2>
        <p className="muted compact-text">{description}</p>
      </div>
    </div>
  );
}

/**
 * A value that is shown and can be copied.
 *
 * <p>The button keeps its name and the outcome is announced beside it, so the
 * name of the button never changes under the reader.
 */
function CopyableValue({
  label,
  value,
  rows,
  copyLabel,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  rows: number;
  copyLabel: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <>
      <textarea
        className="textarea code-textarea"
        readOnly
        rows={rows}
        value={value}
        aria-label={label}
        spellCheck={false}
      />
      <button className="button small" type="button" onClick={onCopy}>
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copyLabel}
      </button>
      <span className="muted compact-text" role="status">
        {copied ? "Copied" : ""}
      </span>
    </>
  );
}

/**
 * Why there is no certificate to show.
 *
 * <p>The API names the state a key's certificate is in, so the console only picks
 * the words: a rule the console had to work out for itself is a rule that can
 * drift from the one the API means.
 */
function certificateReason(resource: CloudResource | undefined): string {
  const state = resource?.metadata.publicKeyCertificateState;
  return typeof state === "string" && state in CERTIFICATE_REASONS
    ? CERTIFICATE_REASONS[state as CertificateState]
    : "The service did not say what state the certificate is in.";
}

/** The states the API names a certificate's state by. */
type CertificateState = "unknown" | "no-public-half" | "signed" | "unsigned" | "unreadable";

const CERTIFICATE_REASONS: Record<CertificateState, string> = {
  "no-public-half": "This key has no public half, so it has no certificate.",
  unsigned: "The service has not signed a certificate for this key.",
  unreadable: "The certificate could not be read.",
  unknown: "The service did not say what kind of key this is, so it has not said whether it has a public half.",
  signed: "The service signed a certificate for this key, but it did not hand it out.",
};
