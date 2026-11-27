import {
  PaymentCryptographyCertificateSection,
  type PaymentCryptographyCertificateSectionProps,
} from "@/components/PaymentCryptographyCertificateSection";
import {PaymentCryptographyExportSection} from "@/components/PaymentCryptographyExportSection";
import {PaymentCryptographyLifecycleSection} from "@/components/PaymentCryptographyLifecycleSection";
import {isPaymentKey} from "@/lib/paymentCryptography";
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
  /** The list of the account's keys is still being read. */
  resourcesLoading?: boolean;
  /** The list of the account's keys could not be read. */
  resourcesError?: boolean;
  /** The service's schema, which publishes the pairings the service allows. */
  schema?: ServiceSchema;
  runtimeReachable: boolean;
}

/**
 * The panels a payment key has of its own.
 *
 * <p>Everything else a key shows comes from the schema, but three things are
 * not: the certificate of a key's public half, whether the key may be used, and
 * the material it leaves under.
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
  resourcesLoading,
  resourcesError,
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
      <PaymentCryptographyExportSection
        cloud={cloud}
        resource={resource}
        keyUnreadable={keyUnreadable}
        resources={resources}
        resourcesLoading={resourcesLoading}
        resourcesError={resourcesError}
        schema={schema}
        runtimeReachable={runtimeReachable}
      />
    </>
  );
}
