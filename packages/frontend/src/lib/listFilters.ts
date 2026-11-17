import type { FieldSchema } from "../types/schema";

/**
 * The filters a schema declares that the toolbar can paint. `search` has its own
 * box, and a filter type the toolbar has no control for is left out rather than
 * painted as something it is not.
 */
export function listFiltersOf(filters: FieldSchema[] | undefined): FieldSchema[] {
  return (filters ?? []).filter(
    (filter) => filter.name !== "search" && (filter.type === "select" || filter.type === "text"),
  );
}

/** A filter starts unfiltered unless the schema names a default (Key Vault's `active`). */
export function filterDefault(filter: FieldSchema): string {
  return filter.defaultValue ?? "";
}

/**
 * The options a select offers. A select that is unfiltered by default needs a way
 * back to that state, so one is added when the schema did not list it.
 */
export function filterOptions(filter: FieldSchema): Array<{ label: string; value: string }> {
  const options = filter.options ?? [];
  if (filter.defaultValue !== undefined || options.some((option) => option.value === "")) {
    return options;
  }
  return [{ label: "All", value: "" }, ...options];
}

export function filterValueOf(filter: FieldSchema, chosen: Record<string, string>): string {
  return chosen[filter.name] ?? filterDefault(filter);
}

/** What goes to the API: only filters with a value, so an empty one lists as before. */
export function activeListFilters(
  filters: FieldSchema[],
  chosen: Record<string, string>,
): Record<string, string> | undefined {
  const active: Record<string, string> = {};
  for (const filter of filters) {
    const value = filterValueOf(filter, chosen).trim();
    if (value !== "") active[filter.name] = value;
  }
  return Object.keys(active).length > 0 ? active : undefined;
}
