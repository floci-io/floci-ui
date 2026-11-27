import type {CloudResource} from "@/types/resource";

/**
 * The names a resource is known by.
 *
 * <p>An operator remembers a name and a tag, and nothing else. A key of a
 * payment operator has no name of its own, so the alias that names it is what
 * the operator knows it by, and an ARN is what they can neither remember nor
 * read aloud.
 *
 * <p>The API publishes the names beside the resource, so the console does not
 * work out which alias names which key for itself. The name is read as an own
 * property, because a name inherited from the prototype is not a state the API
 * published.
 */
export function namesOf(resource: CloudResource | undefined): string[] {
  const metadata = resource?.metadata;
  if (!metadata || !Object.prototype.hasOwnProperty.call(metadata, "names")) return [];
  const names = metadata.names;
  // The member holds a list of names, so anything else is not a set of names
  // the API published.
  if (!Array.isArray(names)) return [];
  return names.filter((each): each is string => typeof each === "string" && each !== "");
}

/**
 * The names of a resource, as one label.
 *
 * <p>The names are joined the same way everywhere they are shown, so a change
 * to the way they are joined cannot show a resource under two different
 * labels.
 */
export function namesLabel(names: string[]): string {
  return names.join(", ");
}

/**
 * The name a resource is known by.
 *
 * <p>A resource that was given names is named by them, and a resource that was
 * given none is named by its own name. A resource that was given names and has
 * an identity of its own is named by both, so a key that an alias names and
 * the alias itself are not shown under the same label.
 */
export function displayNameOf(resource: CloudResource | undefined): string {
  const names = namesOf(resource);
  const identity = resource?.name || resource?.id || "";
  if (names.length === 0) return identity;
  const label = namesLabel(names);
  if (identity === label) return label;
  return identity ? `${label} · ${identity}` : label;
}
