import type {CloudResource} from "@/types/resource";

/**
 * The rule that a resource is a payment key, kept in one place.
 *
 * <p>The panel holds it and the call site that mounts the panel reads it, so the
 * two cannot drift apart and the panel cannot end up saying nothing where a
 * section was expected.
 */
export function isPaymentKey(resource: CloudResource | undefined): resource is CloudResource {
  return resource?.service === "paymentcryptography" && resource.type === "key";
}
