import type { CloudResource } from "@/types/resource";

/**
 * Splits a bulk selection into delete waves. A resource whose id sits under
 * another selected id (`dataset/table` under `dataset`) is a child, and
 * children go in the first wave so a parent that must be empty is not refused
 * while its selected children are still being removed. Everything else is
 * independent and shares the last wave.
 */
export function deleteWaves(items: CloudResource[]): CloudResource[][] {
  const children = items.filter((item) =>
    items.some((other) => other.id !== item.id && item.id.startsWith(`${other.id}/`)),
  );
  const rest = items.filter((item) => !children.includes(item));
  return [children, rest].filter((wave) => wave.length > 0);
}
