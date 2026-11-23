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

const PaymentCryptographyExportSection = lazyPanel(() =>
  import("@/components/PaymentCryptographyExportSection").then(
    (m) => m.PaymentCryptographyExportSection,
  ),
);

interface PaymentCryptographyPanelProps {
  cloud: CloudProvider;
  /** The key that was read, when it was read. */
  resource?: CloudResource;
  /** The rows of the service's own list, which name the keys a wrapping key may be chosen from. */
  resources?: CloudResource[];
  /** The service's schema, which publishes the pairings the service allows. */
  schema?: ServiceSchema;
  runtimeReachable: boolean;
  /** The key itself could not be read, so nothing is known of its material. */
  keyUnreadable?: boolean;
}
>>>>>>> e403b6c (feat(paymentcryptography): the material a key leaves under, and the key it comes back in under)
>>>>>>> 4b52260 (feat(paymentcryptography): the material a key leaves under, and the key it comes back in under)

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
>>>>>>> 4b52260 (feat(paymentcryptography): the material a key leaves under, and the key it comes back in under)
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
 * <p>Everything else a key shows comes from the schema, but the material a key
 * leaves under does not, so it has a section of its own.
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
  if (!isKey || !resource) {
    // Nothing was read at all, so the key is unknown: the section says so.
    return keyUnreadable ? (
      <PaymentCryptographyExportSection
        cloud={cloud}
<<<<<<< HEAD
        resource={resource}
        resources={resources}
        schema={schema}
>>>>>>> 4b52260 (feat(paymentcryptography): the material a key leaves under, and the key it comes back in under)
=======
>>>>>>> 75509f0 (fix(paymentcryptography): the panel speaks about the key it has read)
        runtimeReachable={runtimeReachable}
        keyUnreadable
      />
    ) : null;
  }

  return (
    <PaymentCryptographyExportSection
      cloud={cloud}
      resource={resource}
      resources={resources}
      schema={schema}
      runtimeReachable={runtimeReachable}
    />
  );
<<<<<<< HEAD
=======
>>>>>>> e403b6c (feat(paymentcryptography): the material a key leaves under, and the key it comes back in under)
>>>>>>> 4b52260 (feat(paymentcryptography): the material a key leaves under, and the key it comes back in under)
}
