<<<<<<< HEAD
import {
  PaymentCryptographyCertificateSection,
  type PaymentCryptographyCertificateSectionProps,
} from "@/components/PaymentCryptographyCertificateSection";
import {isPaymentKey} from "@/lib/paymentCryptography";

/** The panel shows what the section shows, so it holds the section's contract. */
type PaymentCryptographyPanelProps = PaymentCryptographyCertificateSectionProps;
=======
import {lazyPanel} from "@/lib/lazyPanel";
import {isPaymentKey} from "@/lib/paymentCryptography";
import type {CloudProvider} from "@/types/cloud";
import type {CloudResource} from "@/types/resource";

const PaymentCryptographyLifecycleSection = lazyPanel(() =>
  import("@/components/PaymentCryptographyLifecycleSection").then((m) => m.PaymentCryptographyLifecycleSection),
);

interface PaymentCryptographyPanelProps {
  cloud: CloudProvider;
  /** The key that was read, when it was read. */
  resource?: CloudResource;
  /** The key itself could not be read, so nothing is known of its usage. */
  keyUnreadable?: boolean;
  runtimeReachable: boolean;
}
>>>>>>> 877377b (feat(paymentcryptography): a key may be disabled and enabled again)

/**
 * The panels a payment key has of its own.
 *
<<<<<<< HEAD
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
=======
 * <p>Everything else a key shows comes from the schema, but whether it may be used.
 */
export function PaymentCryptographyPanel({
  cloud,
  resource,
  keyUnreadable,
  runtimeReachable,
}: PaymentCryptographyPanelProps) {
  if (!resource) {
    // Nothing was read at all, so the key's usage is unknown: the section says
    // so rather than the panel speaking about a key it has not read.
    return (
      <PaymentCryptographyLifecycleSection
        cloud={cloud}
        keyUnreadable={keyUnreadable}
        runtimeReachable={runtimeReachable}
      />
    );
  }
  if (!isPaymentKey(resource)) return null;

  return (
    <PaymentCryptographyLifecycleSection
      cloud={cloud}
      resource={resource}
      runtimeReachable={runtimeReachable}
    />
  );
>>>>>>> 877377b (feat(paymentcryptography): a key may be disabled and enabled again)
}
