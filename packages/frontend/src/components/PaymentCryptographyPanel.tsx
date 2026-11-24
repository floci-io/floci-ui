import {
  PaymentCryptographyCertificateSection,
  type PaymentCryptographyCertificateSectionProps,
} from "@/components/PaymentCryptographyCertificateSection";
<<<<<<< HEAD
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
=======
import {PaymentCryptographyExportSection} from "@/components/PaymentCryptographyExportSection";
import {PaymentCryptographyLifecycleSection} from "@/components/PaymentCryptographyLifecycleSection";
import {PaymentCryptographyPolicySection} from "@/components/PaymentCryptographyPolicySection";
import {PaymentCryptographyReplicationSection} from "@/components/PaymentCryptographyReplicationSection";
import {isPaymentKey} from "@/lib/paymentCryptography";
>>>>>>> d83690d (fix(console): the panels are the branch's own, the shared surface is main's)
import type {CloudProvider} from "@/types/cloud";
import type {CloudResource} from "@/types/resource";
import type {ServiceSchema} from "@/types/schema";

interface PaymentCryptographyPanelProps extends PaymentCryptographyCertificateSectionProps {
  cloud: CloudProvider;
  /**
   * The rows of the service's own list, which name the keys a wrapping key may
   * be chosen from.
   */
  resources?: CloudResource[];
  /** The service's schema, which publishes the pairings the service allows. */
  schema?: ServiceSchema;
  runtimeReachable: boolean;
}
<<<<<<< HEAD
>>>>>>> 3a8a552 (feat(paymentcryptography): the panels a payment key has of its own)
>>>>>>> 57a6f43 (feat(paymentcryptography): the panels a payment key has of its own)
=======
>>>>>>> d83690d (fix(console): the panels are the branch's own, the shared surface is main's)

/**
 * The panels a payment key has of its own.
 *
<<<<<<< HEAD
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
=======
>>>>>>> d83690d (fix(console): the panels are the branch's own, the shared surface is main's)
 * <p>Everything else a key shows comes from the schema, but five things are
 * particular to a payment key: the certificate of its public half, whether it
 * may be used, the policy that lets another account use it, the Regions it is
 * replicated to, and the material it leaves under.
 *
 * <p>The panel holds the key the console read, never the row of the table: a row
 * carries none of these, so a panel handed one would speak about a key it has
 * not read.
 */
export function PaymentCryptographyPanel({
  cloud,
  resource,
  keyUnreadable,
  resources,
  schema,
  runtimeReachable,
}: PaymentCryptographyPanelProps) {
  if (resource && !isPaymentKey(resource)) return null;

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
        runtimeReachable={runtimeReachable}
      />
      <PaymentCryptographyPolicySection
        cloud={cloud}
        resource={resource}
        keyUnreadable={keyUnreadable}
        runtimeReachable={runtimeReachable}
      />
      <PaymentCryptographyReplicationSection
        cloud={cloud}
        resource={resource}
        keyUnreadable={keyUnreadable}
        runtimeReachable={runtimeReachable}
      />
      <PaymentCryptographyExportSection
        cloud={cloud}
        resource={resource}
        keyUnreadable={keyUnreadable}
        resources={resources}
<<<<<<< HEAD
>>>>>>> 57a6f43 (feat(paymentcryptography): the panels a payment key has of its own)
=======
        schema={schema}
>>>>>>> 75762b3 (feat(paymentcryptography): the export form offers only the pairings allowed)
        runtimeReachable={runtimeReachable}
      />
    </>
  );
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 3a8a552 (feat(paymentcryptography): the panels a payment key has of its own)
>>>>>>> 57a6f43 (feat(paymentcryptography): the panels a payment key has of its own)
=======
>>>>>>> d83690d (fix(console): the panels are the branch's own, the shared surface is main's)
}
