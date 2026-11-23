import {PaymentCryptographyCertificateSection} from "@/components/PaymentCryptographyCertificateSection";
import type {CloudResource} from "@/types/resource";

interface PaymentCryptographyPanelProps {
  /** The key that was read, when it was read. */
  resource?: CloudResource;
  /** The key could not be read, so nothing is known of its certificate. */
  unreadable?: boolean;
}

/**
 * The panels a payment key has of its own.
 *
 * <p>Everything else a key shows comes from the schema, but the certificate of a
 * key's public half does not, so it has a section of its own.
 */
export function PaymentCryptographyPanel({resource, unreadable}: PaymentCryptographyPanelProps) {
  if (!unreadable && (!resource || resource.service !== "paymentcryptography" || resource.type !== "key")) {
    return null;
  }

  return <PaymentCryptographyCertificateSection resource={resource} unreadable={unreadable} />;
}
