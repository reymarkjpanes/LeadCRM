/**
 * Filter parser for the `filter[field]=operator:value` query param format.
 *
 * The frontend sends filter conditions as:
 *   filter[status]=in:Hot,Warm
 *   filter[assignedUserId]=in:user1,user2
 *   filter[source]=in:Website,Referral
 *
 * This helper parses those params out of the raw Express query object and
 * converts them into a Prisma-compatible `where` clause fragment.
 *
 * Supported operators: equals | contains | in | not_in | gt | lt | gte | lte
 * is_null and is_not_null are supported but the value is ignored.
 *
 * Only fields in the explicit allowlist are accepted to prevent injection of
 * arbitrary Prisma fields via URL manipulation.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParsedFilter {
  field: string;
  operator: string;
  value: unknown;
}

// ── Parser ────────────────────────────────────────────────────────────────────

/**
 * Extract `filter[*]` entries from an Express query object.
 * Returns an array of { field, operator, value } objects.
 */
export function parseFilterParams(query: Record<string, unknown>): ParsedFilter[] {
  const results: ParsedFilter[] = [];

  for (const [key, rawValue] of Object.entries(query)) {
    const match = key.match(/^filter\[(.+)\]$/);
    if (!match || !match[1]) continue;

    const field   = match[1];
    const encoded = String(rawValue ?? '').trim();
    if (!encoded) continue;

    // Format: "operator:value" or just "operator" (for is_null / is_not_null)
    const colonIdx = encoded.indexOf(':');
    if (colonIdx === -1) {
      // No colon — treat as a valueless operator
      results.push({ field, operator: encoded, value: null });
      continue;
    }

    const operator = encoded.substring(0, colonIdx).trim();
    const valuePart = encoded.substring(colonIdx + 1).trim();

    let value: unknown;
    if (operator === 'in' || operator === 'not_in') {
      value = valuePart.split(',').map((v) => v.trim()).filter(Boolean);
    } else {
      value = valuePart;
    }

    results.push({ field, operator, value });
  }

  return results;
}

/**
 * Build a Prisma `AND` clause array from a list of parsed filters.
 *
 * `allowedFields` restricts which fields can be filtered to prevent
 * arbitrary Prisma field injection from untrusted query params.
 *
 * Field name aliases can be provided to map frontend field names to
 * Prisma field names (e.g. { source: 'source' } since frontend sends
 * 'leadSource' but Prisma model uses 'source').
 */
export function buildPrismaFilters(
  filters: ParsedFilter[],
  allowedFields: Set<string>,
  fieldAliases: Record<string, string> = {},
): Record<string, unknown>[] {
  const clauses: Record<string, unknown>[] = [];

  for (const { field, operator, value } of filters) {
    if (!allowedFields.has(field)) continue; // Silently skip disallowed fields

    const prismaField = fieldAliases[field] ?? field;

    switch (operator) {
      case 'equals':
        clauses.push({ [prismaField]: String(value) });
        break;

      case 'contains':
        clauses.push({ [prismaField]: { contains: String(value), mode: 'insensitive' } });
        break;

      case 'in':
        if (Array.isArray(value) && value.length > 0) {
          clauses.push({ [prismaField]: { in: value as string[] } });
        }
        break;

      case 'not_in':
        if (Array.isArray(value) && value.length > 0) {
          clauses.push({ [prismaField]: { notIn: value as string[] } });
        }
        break;

      case 'gt':
        clauses.push({ [prismaField]: { gt: value } });
        break;

      case 'lt':
        clauses.push({ [prismaField]: { lt: value } });
        break;

      case 'gte':
        clauses.push({ [prismaField]: { gte: value } });
        break;

      case 'lte':
        clauses.push({ [prismaField]: { lte: value } });
        break;

      case 'is_null':
        clauses.push({ [prismaField]: null });
        break;

      case 'is_not_null':
        clauses.push({ [prismaField]: { not: null } });
        break;

      default:
        // Unknown operator — skip safely
        break;
    }
  }

  return clauses;
}
