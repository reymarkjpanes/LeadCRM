import {
  TASK_COLUMN_DEFINITIONS,
  type ColumnConfigItem,
} from "@leadcrm/shared";

/** Recover safely from obsolete or malformed persisted preferences. */
export function normalizeTaskColumns(input: unknown): ColumnConfigItem[] {
  const saved = new Map<string, ColumnConfigItem>();
  if (Array.isArray(input))
    for (const item of input) {
      if (
        item &&
        typeof item.id === "string" &&
        typeof item.visible === "boolean" &&
        Number.isFinite(item.order)
      ) {
        if (!saved.has(item.id)) saved.set(item.id, item);
      }
    }
  return TASK_COLUMN_DEFINITIONS.map((definition) => ({
    id: definition.id,
    visible:
      definition.required ||
      (saved.get(definition.id)?.visible ?? definition.defaultVisible),
    order: saved.get(definition.id)?.order ?? definition.defaultOrder,
  }))
    .sort((a, b) =>
      a.id === "action" ? -1 : b.id === "action" ? 1 : a.order - b.order,
    )
    .map((column, order) => ({ ...column, order }));
}
