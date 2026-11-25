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
 * The policy the API published for a key, kept in one place.
 *
 * <p>The API owns the state: it publishes the policy where it read one, it
 * publishes none where it read one and there is none, and it publishes nothing
 * at all where it never read one. The name is read as an own property, because
 * a name inherited from the prototype is not a state the API published.
 *
 * <p>The rule lives here so the draft the editor opens with and the sentence
 * the section picks cannot disagree about the policy the key holds.
 */
export function publishedPolicy(
  metadata: CloudResource["metadata"] | undefined,
): string | null | undefined {
  if (!metadata) return undefined;
  if (!Object.prototype.hasOwnProperty.call(metadata, "keyPolicy")) return undefined;
  return typeof metadata.keyPolicy === "string" ? metadata.keyPolicy : null;
}

/**
 * The names a key was given.
 *
 * <p>A key has no name of its own, so an ARN is all the console could offer,
 * and an ARN is not something an operator remembers. An alias is the friendly
 * name for a key, and it is the name the operator knows it by.
 *
 * <p>The API publishes the names with the key, so the console reads them rather
 * than working out which alias names which key. The name is read as an own
 * property, because a name inherited from the prototype is not a state the API
 * published.
 */
export function aliasNamesOf(resource: CloudResource | undefined): string[] {
  const metadata = resource?.metadata;
  if (!metadata || !Object.prototype.hasOwnProperty.call(metadata, "aliasNames")) return [];
  const names = metadata.aliasNames;
  if (!Array.isArray(names)) return [];
  return names.filter((each): each is string => typeof each === "string" && each !== "");
}
