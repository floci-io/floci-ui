<<<<<<< HEAD
import {
  PaymentCryptographyCertificateSection,
  type PaymentCryptographyCertificateSectionProps,
} from "@/components/PaymentCryptographyCertificateSection";
import {PaymentCryptographyLifecycleSection} from "@/components/PaymentCryptographyLifecycleSection";
import {isPaymentKey} from "@/lib/paymentCryptography";
import type {CloudProvider} from "@/types/cloud";

<<<<<<< HEAD
interface PaymentCryptographyPanelProps extends PaymentCryptographyCertificateSectionProps {
  cloud: CloudProvider;
  runtimeReachable: boolean;
}
=======
/** The panel shows what the section shows, so it holds the section's contract. */
type PaymentCryptographyPanelProps = PaymentCryptographyCertificateSectionProps;
=======
import {lazyPanel} from "@/lib/lazyPanel";
import type {PaymentCryptographyReplicationSectionProps} from "@/components/PaymentCryptographyReplicationSection";

const PaymentCryptographyReplicationSection = lazyPanel(() =>
  import("@/components/PaymentCryptographyReplicationSection").then((m) => m.PaymentCryptographyReplicationSection),
);

<<<<<<< HEAD
interface PaymentCryptographyPanelProps {
  cloud: CloudProvider;
  resource?: CloudResource;
  runtimeReachable: boolean;
}
>>>>>>> e30cba0 (feat(paymentcryptography): the Regions a key is replicated to)
<<<<<<< HEAD
>>>>>>> 73a94ac (feat(paymentcryptography): the Regions a key is replicated to)
=======
=======
/** The panel shows what the section shows, so it holds the section's contract. */
type PaymentCryptographyPanelProps = PaymentCryptographyReplicationSectionProps;
>>>>>>> b8a9162 (fix(paymentcryptography): the panel speaks only of a key it has read)
>>>>>>> ef53cd8 (fix(paymentcryptography): the panel speaks only of a key it has read)

/**
 * The panels a payment key has of its own.
 *
<<<<<<< HEAD
 * <p>Everything else a key shows comes from the schema, but two things are not:
 * the certificate of a key's public half, and whether the key may be used.
 *
 * <p>The panel holds the key the console read, never the row of the table: a row
 * carries neither, so a panel handed one would speak about a key it has not
 * read.
=======
<<<<<<< HEAD
 * <p>Everything else a key shows comes from the schema, but the certificate of a
 * key's public half does not, so it has a section of its own.
>>>>>>> 73a94ac (feat(paymentcryptography): the Regions a key is replicated to)
 */
export function PaymentCryptographyPanel({
  cloud,
  resource,
  keyUnreadable,
  runtimeReachable,
}: PaymentCryptographyPanelProps) {
  if (resource && !isPaymentKey(resource)) return null;

<<<<<<< HEAD
  return (
    <>
      {resource ? (
        <PaymentCryptographyCertificateSection resource={resource} />
      ) : keyUnreadable ? (
        <PaymentCryptographyCertificateSection keyUnreadable />
      ) : null}
      <PaymentCryptographyLifecycleSection
        cloud={cloud}
        resource={resource}
        keyUnreadable={keyUnreadable}
=======
  return <PaymentCryptographyCertificateSection resource={resource} />;
=======
 * <p>Everything else a key shows comes from the schema, but the Regions it is replicated to.
 */
<<<<<<< HEAD
export function PaymentCryptographyPanel({
  cloud,
  resource,
  runtimeReachable,
}: PaymentCryptographyPanelProps) {
  const isKey = resource?.service === "paymentcryptography" && resource.type === "key";
  if (!isKey || !resource) return null;

  return (
    <>
      <PaymentCryptographyReplicationSection
        cloud={cloud}
        resource={resource}
>>>>>>> 73a94ac (feat(paymentcryptography): the Regions a key is replicated to)
        runtimeReachable={runtimeReachable}
      />
    </>
  );
<<<<<<< HEAD
=======
>>>>>>> e30cba0 (feat(paymentcryptography): the Regions a key is replicated to)
<<<<<<< HEAD
>>>>>>> 73a94ac (feat(paymentcryptography): the Regions a key is replicated to)
=======
=======
export function PaymentCryptographyPanel(props: PaymentCryptographyPanelProps) {
  return <PaymentCryptographyReplicationSection {...props} />;
>>>>>>> b8a9162 (fix(paymentcryptography): the panel speaks only of a key it has read)
>>>>>>> ef53cd8 (fix(paymentcryptography): the panel speaks only of a key it has read)
}
