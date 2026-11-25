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

/**
 * The names a key was given.
 *
 * <p>A key has no name of its own, so an ARN is all the console could offer,
 * and an ARN is not something an operator remembers. An alias is the friendly
 * name for a key, and it is the name the operator knows it by.
 *
 * <p>The API publishes the names with the key, so the console reads them rather
 * than working out which alias names which key.
 */
export function aliasNamesOf(resource: CloudResource | undefined): string[] {
  const names = resource?.metadata.aliasNames;
  if (!Array.isArray(names)) return [];
  return names.filter((each): each is string => typeof each === "string" && each !== "");
}
