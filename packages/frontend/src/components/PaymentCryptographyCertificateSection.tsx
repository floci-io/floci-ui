<<<<<<< HEAD
import {Check, Copy, KeyRound} from "lucide-react";
import {COPY_REFUSED_MESSAGE, useCopyToClipboard} from "@/lib/useCopyToClipboard";
import type {CloudResource} from "@/types/resource";

export interface PaymentCryptographyCertificateSectionProps {
  /** The key that was read, when it was read. */
  resource?: CloudResource;
  /** The key itself could not be read, so nothing is known of its certificate. */
  keyUnreadable?: boolean;
=======
import {useState} from "react";
import {Check, Copy} from "lucide-react";
import type {CloudProvider} from "@/types/cloud";
import type {CloudResource} from "@/types/resource";

interface PaymentCryptographyCertificateSectionProps {
  cloud: CloudProvider;
  resource: CloudResource;
  runtimeReachable: boolean;
>>>>>>> 3a8a552 (feat(paymentcryptography): the panels a payment key has of its own)
}

/**
 * The certificate of an asymmetric key's public half.
 *
 * <p>The reference signs the public half into a certificate and hands it out, and
<<<<<<< HEAD
 * a key with no public half has none: the section says which of the states it is
 * rather than showing nothing.
 */
export function PaymentCryptographyCertificateSection({
  resource,
  keyUnreadable,
}: PaymentCryptographyCertificateSectionProps) {
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
          />
        </>
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
 * <p>Each value keeps its own copy state, so copying the certificate does not
 * tell the reader that the chain was copied as well. The button keeps its name
 * and the outcome is announced beside it, so the name of the button never
 * changes under the reader.
 */
function CopyableValue({
  label,
  value,
  rows,
  copyLabel,
}: {
  label: string;
  value: string;
  rows: number;
  copyLabel: string;
}) {
  const {copied, copyFailed, copy} = useCopyToClipboard();

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
      <button className="button small" type="button" onClick={() => void copy(value)}>
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copyLabel}
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
  // The state travels as metadata, so it is checked against the table with an
  // own-property test: a name inherited from the prototype is not a state.
  return typeof state === "string" && Object.prototype.hasOwnProperty.call(CERTIFICATE_REASONS, state)
    ? CERTIFICATE_REASONS[state as CertificateState]
    : "The service did not say what state the certificate is in.";
}

/**
 * The states the API names a certificate's state by.
 *
 * <p>The API owns the vocabulary, in `cloud-spi/paymentCryptographySchema.ts`, and
 * the console cannot import that package, so the five names are mirrored here the
 * way the schema's own types are mirrored in `types/schema.ts`.
 */
type CertificateState = "unknown" | "no-public-half" | "signed" | "unsigned" | "unreadable";

const CERTIFICATE_REASONS: Record<CertificateState, string> = {
  "no-public-half": "This key has no public half, so it has no certificate.",
  unsigned: "The service has not signed a certificate for this key.",
  unreadable: "The certificate could not be read.",
  unknown: "The service did not say what kind of key this is, so it has not said whether it has a public half.",
  signed: "The service signed a certificate for this key's public half.",
};
=======
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

  if (!certificate) return null;

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
>>>>>>> 3a8a552 (feat(paymentcryptography): the panels a payment key has of its own)
