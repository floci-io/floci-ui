import {lazyPanel} from "@/lib/lazyPanel";
import type {CloudProvider} from "@/types/cloud";
import type {CloudResource} from "@/types/resource";

const PaymentCryptographyCertificateSection = lazyPanel(() =>
  import("@/components/PaymentCryptographyCertificateSection").then(
    (m) => m.PaymentCryptographyCertificateSection,
  ),
);

interface PaymentCryptographyPanelProps {
  cloud: CloudProvider;
  resource?: CloudResource;
  runtimeReachable: boolean;
}

/**
 * The panels a payment key has of its own.
 *
 * <p>Everything else a key shows comes from the schema, but the certificate of a
 * key's public half does not, so it has a section of its own.
 */
export function PaymentCryptographyPanel({
  cloud,
  resource,
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
    </>
  );
}
