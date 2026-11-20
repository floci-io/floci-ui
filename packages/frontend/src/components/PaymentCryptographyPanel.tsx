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
import type {CloudProvider} from "@/types/cloud";
import type {CloudResource} from "@/types/resource";

const PaymentCryptographyCertificateSection = lazyPanel(() =>
  import("@/components/PaymentCryptographyCertificateSection").then(
    (m) => m.PaymentCryptographyCertificateSection,
  ),
);
const PaymentCryptographyLifecycleSection = lazyPanel(() =>
  import("@/components/PaymentCryptographyLifecycleSection").then(
    (m) => m.PaymentCryptographyLifecycleSection,
  ),
);
const PaymentCryptographyPolicySection = lazyPanel(() =>
  import("@/components/PaymentCryptographyPolicySection").then(
    (m) => m.PaymentCryptographyPolicySection,
  ),
);
const PaymentCryptographyReplicationSection = lazyPanel(() =>
  import("@/components/PaymentCryptographyReplicationSection").then(
    (m) => m.PaymentCryptographyReplicationSection,
  ),
);
const PaymentCryptographyExportSection = lazyPanel(() =>
  import("@/components/PaymentCryptographyExportSection").then(
    (m) => m.PaymentCryptographyExportSection,
  ),
);

interface PaymentCryptographyPanelProps {
  cloud: CloudProvider;
  resource?: CloudResource;
  /** The rows of the list, which name the keys a wrapping key may be chosen from. */
  resources?: CloudResource[];
  runtimeReachable: boolean;
}
>>>>>>> 3a8a552 (feat(paymentcryptography): the panels a payment key has of its own)
>>>>>>> 57a6f43 (feat(paymentcryptography): the panels a payment key has of its own)

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
>>>>>>> 57a6f43 (feat(paymentcryptography): the panels a payment key has of its own)
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
 * <p>Everything else a key shows comes from the schema, but four things are
 * particular to a payment key: the certificate of its public half, whether it may
 * be used, the policy that lets another account use it, and the Regions it is
 * replicated to.
 */
export function PaymentCryptographyPanel({
  cloud,
  resource,
  resources,
  runtimeReachable,
}: PaymentCryptographyPanelProps) {
  const isKey = resource?.service === "paymentcryptography" && resource.type === "key";
  if (!isKey || !resource) return null;

  return (
    <>
      <PaymentCryptographyCertificateSection
        cloud={cloud}
        resource={resource}
        runtimeReachable={runtimeReachable}
      />
      <PaymentCryptographyLifecycleSection
        cloud={cloud}
        resource={resource}
        runtimeReachable={runtimeReachable}
      />
      <PaymentCryptographyPolicySection
        cloud={cloud}
        resource={resource}
        runtimeReachable={runtimeReachable}
      />
      <PaymentCryptographyReplicationSection
        cloud={cloud}
        resource={resource}
        runtimeReachable={runtimeReachable}
      />
      <PaymentCryptographyExportSection
        cloud={cloud}
        resource={resource}
        resources={resources}
>>>>>>> 57a6f43 (feat(paymentcryptography): the panels a payment key has of its own)
        runtimeReachable={runtimeReachable}
      />
    </>
  );
<<<<<<< HEAD
=======
>>>>>>> 3a8a552 (feat(paymentcryptography): the panels a payment key has of its own)
>>>>>>> 57a6f43 (feat(paymentcryptography): the panels a payment key has of its own)
}
