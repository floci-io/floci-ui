/**
 * The keys that may carry a key that leaves the service.
 *
 * <p>Three rules, all of them the reference's: the wrapping key has to be a key
 * encryption key that may wrap, it has to be enabled, and it has to be at least as
 * strong as the key it carries. The last is the reference's own matrix, which the
 * service's schema publishes, so the panel and the adapter cannot disagree about
 * it.
 */

import type {CloudResource} from "@/types/resource";
import type {PairingRule, ServiceSchema} from "@/types/schema";

/** The usages a key may have when it wraps another key. */
export const WRAPPING_USAGES = ["TR31_K0_KEY_ENCRYPTION_KEY", "TR31_K1_KEY_BLOCK_PROTECTION_KEY"];

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
    if (row.metadata.enabled === false) return false;
    const usage = String(row.metadata.keyUsage ?? "");
    if (!WRAPPING_USAGES.includes(usage)) return false;
    const modes = row.metadata.keyModesOfUse as Record<string, boolean> | undefined;
    // The service lets a key that may encrypt wrap as well, so a key with neither
    // Wrap nor Encrypt is the one that cannot.
    if (modes && !modes.Wrap && !modes.Encrypt) return false;
    const algorithm = String(row.metadata.keyAlgorithm ?? "");
    // A service that publishes no matrix says nothing about what may carry
    // what, so every pairing is allowed. A matrix that does not name the
    // carried algorithm says that no key may carry it.
    if (allowed === undefined) return true;
    return allowed.includes(algorithm);
  });
}
