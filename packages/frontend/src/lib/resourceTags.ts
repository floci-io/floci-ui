/**
 * The tags of a resource, and the changes between them.
 *
 * <p>A resource's tags travel in its metadata as a list of key and value pairs,
 * and the adapter's `updateTags` takes a map whose key is the tag's key and whose
 * value is the tag's new value, or null for a tag that is removed.
 */

export interface ResourceTag {
  key: string;
  value: string;
}

/** The tags a resource carries in its metadata. */
export function resourceTags(metadata: Record<string, unknown>): ResourceTag[] {
  const tags = metadata.tags;
  if (!Array.isArray(tags)) return [];
  return tags.flatMap((tag) => {
    if (!tag || typeof tag !== 'object') return [];
    const pair = tag as Record<string, unknown>;
    return typeof pair.key === 'string' && typeof pair.value === 'string'
      ? [{ key: pair.key, value: pair.value }]
      : [];
  });
}

/**
 * The key that two rows of the editor name twice, if any.
 *
 * <p>The editor lets a key be renamed freely, so two rows can end up with the same
 * key, and the changes between the tags would then keep only the last of them. The
 * duplicate is named so the form can refuse to save it.
 */
export function duplicateKey(rows: ResourceTag[]): string | null {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.key === '') continue;
    if (seen.has(row.key)) return row.key;
    seen.add(row.key);
  }
  return null;
}

/**
 * The changes between the tags a resource has and the ones the editor holds.
 *
 * <p>A key that is gone is one whose tag is removed, and a key whose value changed
 * is one that is set again. A tag renamed is the old key removed and the new one
 * set.
 */
export function changesBetween(original: ResourceTag[], edited: ResourceTag[]): Record<string, string | null> {
  const before = new Map(original.map((tag) => [tag.key, tag.value]));
  const after = new Map(edited.filter((row) => row.key !== '').map((row) => [row.key, row.value]));
  // The changes are built through a map and made into an object at the end, so a
  // tag named `__proto__` is an own property of the result. Assigning it to a
  // plain object would reach the inherited setter and lose the tag.
  const changes = new Map<string, string | null>();

  for (const [key, value] of after) {
    if (before.get(key) !== value) changes.set(key, value);
  }
  for (const key of before.keys()) {
    if (!after.has(key)) changes.set(key, null);
  }
  return Object.fromEntries(changes);
}
