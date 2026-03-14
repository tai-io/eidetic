/**
 * Slug generation for human-readable memory filenames.
 *
 * Pure utility — no dependencies on the rest of the codebase.
 */

const MAX_SLUG_LENGTH = 80;

/**
 * Convert query text to a filesystem-safe slug.
 *
 * - Lowercase, NFD-normalize, strip combining marks (accents)
 * - Replace non-alphanumeric runs with single hyphens
 * - Trim hyphens, truncate to 80 chars at word boundary
 * - Returns "untitled" for empty/all-special input
 */
export function slugify(text: string): string {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // non-alphanum → hyphen
    .replace(/^-+|-+$/g, ''); // trim leading/trailing hyphens

  if (!normalized) return 'untitled';

  if (normalized.length <= MAX_SLUG_LENGTH) return normalized;

  // Truncate at word boundary (hyphens are word boundaries in slugs)
  const truncated = normalized.slice(0, MAX_SLUG_LENGTH);
  const lastHyphen = truncated.lastIndexOf('-');
  if (lastHyphen > 0) {
    return truncated.slice(0, lastHyphen);
  }
  return truncated;
}

/**
 * Resolve slug collisions by appending -2, -3, etc.
 */
export function resolveSlugCollision(slug: string, existing: Set<string>): string {
  if (!existing.has(slug)) return slug;

  let counter = 2;
  while (existing.has(`${slug}-${counter}`)) {
    counter++;
  }
  return `${slug}-${counter}`;
}
