import {
  PaymentCryptographyCertificateSection,
  type PaymentCryptographyCertificateSectionProps,
} from "@/components/PaymentCryptographyCertificateSection";
import {isPaymentKey} from "@/lib/paymentCryptography";

/** The panel shows what the section shows, so it holds the section's contract. */
type PaymentCryptographyPanelProps = PaymentCryptographyCertificateSectionProps;

/**
 * The panels a payment key has of its own.
 *
 * <p>Everything else a key shows comes from the schema, but the certificate of a
 * key's public half does not, so it has a section of its own.
 */
export function PaymentCryptographyPanel({resource, keyUnreadable}: PaymentCryptographyPanelProps) {
  if (!resource) {
    // Nothing was read at all, so the key is unknown: the section says so.
    return keyUnreadable ? <PaymentCryptographyCertificateSection keyUnreadable /> : null;
  }
  if (!isPaymentKey(resource)) return null;

  return <PaymentCryptographyCertificateSection resource={resource} />;
}
