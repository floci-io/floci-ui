import {PaymentCryptographyCertificateSection} from "@/components/PaymentCryptographyCertificateSection";
import type {CloudResource} from "@/types/resource";

interface PaymentCryptographyPanelProps {
  resource?: CloudResource;
}

/**
 * The panels a payment key has of its own.
 *
 * <p>Everything else a key shows comes from the schema, but the certificate of a
 * key's public half does not, so it has a section of its own.
 */
export function PaymentCryptographyPanel({resource}: PaymentCryptographyPanelProps) {
  if (!resource || resource.service !== "paymentcryptography" || resource.type !== "key") return null;

  return <PaymentCryptographyCertificateSection resource={resource} />;
}
