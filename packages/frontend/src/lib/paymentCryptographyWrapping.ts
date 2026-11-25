/**
 * The keys that may carry a key that leaves the service.
 *
 * <p>The rule is the service's: it publishes which of its keys may wrap another
 * one, and it publishes the matrix of what may carry what. The panel reads both
 * of them, so it cannot disagree with the adapter about which key may carry
 * which.
 */

import type {CloudResource} from "@/types/resource";
import type {PairingRule, ServiceSchema} from "@/types/schema";

/**
 * The algorithms the service allows a key of this algorithm to be carried by.
 *
 * <p>The schema publishes the matrix, and a service that publishes none says
 * nothing about what may carry what. A matrix that is there but does not name
 * an algorithm says that no key of that algorithm may be carried at all, which
 * is not the same as a matrix that is not there.
 *
 * @returns the algorithms the matrix names, an empty list when the matrix does
 * not name the algorithm, and nothing at all when the service publishes no
 * matrix.
 */
export function allowedAlgorithms(
  schema: ServiceSchema | undefined,
  carriedAlgorithm: string,
): readonly string[] | undefined {
  // The schema arrives over the network and is not checked before it is read,
  // so the container and the entries are guarded the same way the matrix is.
  const pairings = schema?.pairings;
  if (!Array.isArray(pairings)) return undefined;
  const rule: PairingRule | undefined = pairings.find(
    (each) => Boolean(each) && each.discriminator === "keyAlgorithm",
  );
  if (!rule) return undefined;
  // The schema arrives over the network and is not checked before it is read, so
  // a malformed one leaves the list empty rather than crashing the inspector.
  const allowed = rule.allowed;
  if (!allowed || typeof allowed !== "object") return [];
  // The algorithm comes from the service, so a name the prototype chain answers
  // for is not a row of the matrix.
  if (!Object.prototype.hasOwnProperty.call(allowed, carriedAlgorithm)) return [];
  const row = allowed[carriedAlgorithm];
  // The row is copied, so a caller that changes it does not change what every
  // other caller of the schema believes.
  return Array.isArray(row) ? [...row] : [];
}

/**
 * Whether the service has published which keys may carry which.
 *
 * <p>A service that publishes no matrix says nothing about what may carry
 * what, which is not the same as a service that published one and named no key
 * that may carry this one.
 */
export function pairingsPublished(schema: ServiceSchema | undefined): boolean {
  // The two functions answer alike about a rule that is not usable: a matrix
  // that was not published is not a matrix that was published and named no key.
  const pairings = schema?.pairings;
  if (!Array.isArray(pairings)) return false;
  const rule = pairings.find((each) => Boolean(each) && each.discriminator === "keyAlgorithm");
  return Boolean(rule?.allowed && typeof rule.allowed === "object");
}

/**
 * The keys that may carry the key being exported.
 *
 * <p>Whether a key may wrap another one is the service's to say, so the state
 * it published with every key is what the console reads. A service that
 * publishes no matrix says nothing about what may carry what, and the adapter
 * refuses a weaker key either way, so the console offers nothing rather than a
 * key the service will refuse.
 */
export function wrappingKeysFor(
  carried: CloudResource,
  resources: CloudResource[] | undefined,
  schema?: ServiceSchema,
): CloudResource[] {
  const carriedAlgorithm = String(carried.metadata.keyAlgorithm ?? "");
  const allowed = allowedAlgorithms(schema, carriedAlgorithm);
  // A matrix the console cannot read is not a matrix that allows every
  // pairing, so no key may carry the one.
  if (allowed === undefined) return [];

  return (resources ?? []).filter((row) => {
    if (row.type !== "key") return false;
    // A key may not carry itself, and the service refuses a key that does.
    if (row.id === carried.id) return false;
    if (row.metadata.mayWrap !== true) return false;
    const algorithm = String(row.metadata.keyAlgorithm ?? "");
    return allowed.includes(algorithm);
  });
}
