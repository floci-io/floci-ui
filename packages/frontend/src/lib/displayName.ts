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
 * The name a resource is known by.
 *
 * <p>A resource that was given names is named by them, and a resource that was
 * given none is named by its own name.
 */
export function displayNameOf(resource: CloudResource | undefined): string {
  const names = namesOf(resource);
  if (names.length > 0) return names.join(", ");
  return resource?.name || resource?.id || "";
}
