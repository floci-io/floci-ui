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
 * <p>The schema publishes the matrix, and a service that publishes none allows
 * every pairing. A matrix that is there but does not name an algorithm says
 * that no key of that algorithm may be carried at all, which is not the same
 * as a matrix that is not there.
 *
 * @returns the algorithms the matrix names, an empty list when the matrix does
 * not name the algorithm, and nothing at all when the service publishes no
 * matrix.
 */
export function allowedAlgorithms(
  schema: ServiceSchema | undefined,
  carriedAlgorithm: string,
): string[] | undefined {
  const rule: PairingRule | undefined = schema?.pairings?.find(
    (each) => each.discriminator === "keyAlgorithm",
  );
  if (!rule) return undefined;
  // The algorithm comes from the service, so a name the prototype chain answers
  // for is not a row of the matrix.
  if (!Object.prototype.hasOwnProperty.call(rule.allowed, carriedAlgorithm)) return [];
  return rule.allowed[carriedAlgorithm];
}

/**
 * The keys that may carry the key being exported.
 *
 * <p>Whether a key may wrap another one is the service's to say, so the state
 * it published with every key is what the console reads. A key with no
 * restrictions may wrap, and the service says so, so the console does not
 * narrow the service's own answer.
 */
export function wrappingKeysFor(
  carried: CloudResource,
  resources: CloudResource[] | undefined,
  schema?: ServiceSchema,
): CloudResource[] {
  const carriedAlgorithm = String(carried.metadata.keyAlgorithm ?? "");
  const allowed = allowedAlgorithms(schema, carriedAlgorithm);

  return (resources ?? []).filter((row) => {
    if (row.type !== "key") return false;
    // A key may not carry itself, and the service refuses a key that does.
    if (row.id === carried.id) return false;
    if (row.metadata.mayWrap !== true) return false;
    const algorithm = String(row.metadata.keyAlgorithm ?? "");
    // A service that publishes no matrix says nothing about what may carry
    // what, so every pairing is allowed. A matrix that does not name the
    // carried algorithm says that no key may carry it.
    if (allowed === undefined) return true;
    return allowed.includes(algorithm);
  });
}
