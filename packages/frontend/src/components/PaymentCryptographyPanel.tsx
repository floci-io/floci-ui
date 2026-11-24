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
import {PaymentCryptographyPolicySection} from "@/components/PaymentCryptographyPolicySection";
import {isPaymentKey} from "@/lib/paymentCryptography";
>>>>>>> e083ec2 (fix(paymentcryptography): the panel holds the certificate and the policy)
import type {CloudProvider} from "@/types/cloud";

interface PaymentCryptographyPanelProps extends PaymentCryptographyCertificateSectionProps {
  cloud: CloudProvider;
  runtimeReachable: boolean;
}
<<<<<<< HEAD
>>>>>>> 77473b1 (feat(paymentcryptography): the policy of a key)
>>>>>>> 2696a26 (feat(paymentcryptography): the policy of a key)
=======
>>>>>>> e083ec2 (fix(paymentcryptography): the panel holds the certificate and the policy)

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
<<<<<<< HEAD
 * <p>Everything else a key shows comes from the schema, but the certificate of a
 * key's public half does not, so it has a section of its own.
>>>>>>> 2696a26 (feat(paymentcryptography): the policy of a key)
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
 * <p>Everything else a key shows comes from the schema, but the policy that lets another account use it.
=======
 * <p>Everything else a key shows comes from the schema, but two things are not:
 * the certificate of a key's public half, and the policy that lets another
 * account use it.
>>>>>>> e083ec2 (fix(paymentcryptography): the panel holds the certificate and the policy)
 *
 * <p>The panel holds the key the console read, never the row of the table: a row
 * carries neither, so a panel handed one would speak about a key it has not
 * read.
 */
export function PaymentCryptographyPanel({
  cloud,
  resource,
  keyUnreadable,
  runtimeReachable,
}: PaymentCryptographyPanelProps) {
  if (resource && !isPaymentKey(resource)) return null;

  return (
<<<<<<< HEAD
<<<<<<< HEAD
    <>
      <PaymentCryptographyPolicySection
        cloud={cloud}
        resource={resource}
>>>>>>> 2696a26 (feat(paymentcryptography): the policy of a key)
        runtimeReachable={runtimeReachable}
      />
    </>
=======
    <PaymentCryptographyPolicySection
      cloud={cloud}
      resource={resource}
      keyUnreadable={keyUnreadable}
      runtimeReachable={runtimeReachable}
    />
>>>>>>> 47f990a (fix(paymentcryptography): the policy panel speaks about the key it read)
  );
<<<<<<< HEAD
=======
>>>>>>> 77473b1 (feat(paymentcryptography): the policy of a key)
>>>>>>> 2696a26 (feat(paymentcryptography): the policy of a key)
=======
    <>
      {resource ? (
        <PaymentCryptographyCertificateSection resource={resource} />
      ) : keyUnreadable ? (
        <PaymentCryptographyCertificateSection keyUnreadable />
      ) : null}
      <PaymentCryptographyPolicySection
        cloud={cloud}
        resource={resource}
        keyUnreadable={keyUnreadable}
        runtimeReachable={runtimeReachable}
      />
    </>
  );
>>>>>>> e083ec2 (fix(paymentcryptography): the panel holds the certificate and the policy)
}
