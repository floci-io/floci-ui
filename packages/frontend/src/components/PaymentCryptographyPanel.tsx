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
import type {ServiceSchema} from "@/types/schema";

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
  /**
   * The key that was read, when it was read.
   *
   * <p>The table's rows carry no state and no enrichment, so the panel is handed
   * the detail of the key that is inspected and never the row: it would speak
   * about a key it has not read.
   */
  resource?: CloudResource;
  /**
   * The rows of the service's own list, which name the keys a wrapping key may
   * be chosen from.
   *
   * <p>They are not the rows the table shows: those are the ones the search box
   * and the facet narrowed, and a wrapping key is a key of the account whether
   * the table is showing it or not.
   */
  resources?: CloudResource[];
  /** The service's schema, which publishes the pairings the service allows. */
  schema?: ServiceSchema;
  runtimeReachable: boolean;
  /** The key itself could not be read, so nothing is known of it. */
  keyUnreadable?: boolean;
}
>>>>>>> 3a8a552 (feat(paymentcryptography): the panels a payment key has of its own)
>>>>>>> 57a6f43 (feat(paymentcryptography): the panels a payment key has of its own)

/**
 * The panels a payment key has of its own.
 *
<<<<<<< HEAD
<<<<<<< HEAD
 * <p>Everything else a key shows comes from the schema, but two things are not:
 * the certificate of a key's public half, and whether the key may be used.
 *
 * <p>The panel holds the key the console read, never the row of the table: a row
 * carries neither, so a panel handed one would speak about a key it has not
 * read.
=======
=======
>>>>>>> badeb69 (feat(paymentcryptography): the certificate of a key's public half)
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
=======
 * <p>Everything else a key shows comes from the schema, but five things are
>>>>>>> debebdc (feat(paymentcryptography): the certificate of a key's public half)
 * particular to a payment key: the certificate of its public half, whether it may
 * be used, the policy that lets another account use it, the Regions it is
 * replicated to, and the material it leaves under.
 *
 * <p>The panel holds the key the console read, never the row of the table: a row
 * carries none of these, so a panel handed one would speak about a key it has
 * not read.
 */
export function PaymentCryptographyPanel({
  cloud,
  resource,
  resources,
  schema,
  runtimeReachable,
  keyUnreadable,
}: PaymentCryptographyPanelProps) {
  const isKey = resource?.service === "paymentcryptography" && resource.type === "key";
  // A resource that was read and is not a key has none of the panels of a key,
  // so the panel says nothing about it.
  if (resource && !isKey) return null;

  return (
    <>
      {/* The certificate is a state the service publishes, so there is nothing to
          say about it until the key has been read, and nothing to say about a
          key that could not be read but the fact that it could not be. */}
      {(resource || keyUnreadable) && (
        <PaymentCryptographyCertificateSection
          resource={resource}
          keyUnreadable={keyUnreadable}
        />
      )}
      <PaymentCryptographyLifecycleSection
        cloud={cloud}
        resource={resource}
        keyUnreadable={keyUnreadable}
        runtimeReachable={runtimeReachable}
      />
      {resource && (
        <PaymentCryptographyPolicySection
          cloud={cloud}
          resource={resource}
          runtimeReachable={runtimeReachable}
        />
      )}
      {resource && (
        <PaymentCryptographyReplicationSection
          cloud={cloud}
          resource={resource}
          runtimeReachable={runtimeReachable}
        />
      )}
      <PaymentCryptographyExportSection
        cloud={cloud}
        resource={resource}
        resources={resources}
<<<<<<< HEAD
>>>>>>> 57a6f43 (feat(paymentcryptography): the panels a payment key has of its own)
=======
        schema={schema}
>>>>>>> 75762b3 (feat(paymentcryptography): the export form offers only the pairings allowed)
        runtimeReachable={runtimeReachable}
        keyUnreadable={keyUnreadable}
      />
    </>
  );
<<<<<<< HEAD
=======
>>>>>>> 3a8a552 (feat(paymentcryptography): the panels a payment key has of its own)
>>>>>>> 57a6f43 (feat(paymentcryptography): the panels a payment key has of its own)
}
