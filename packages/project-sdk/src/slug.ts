import { InvalidSlugError } from './errors.js';

export const MAX_SLUG_LENGTH = 20;
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Folder-name form of a project name: lowercase ASCII, accents removed, every run of other characters becomes one `-`, no leading or trailing `-`,
 * at most 20 characters. Returns '' when nothing is left (a name made only of CJK characters, for example): the project then has no slug.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');
}

/** Throws InvalidSlugError unless `slug` is kebab-case ASCII, 1 to 20 characters (`^[a-z0-9]+(-[a-z0-9]+)*$`). */
export function validateSlug(slug: string): void {
  if (typeof slug === 'string' && slug.length >= 1 && slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug)) {
    return;
  }
  throw new InvalidSlugError(
    `'${String(slug)}' is not a valid slug: it must be kebab-case ASCII (lowercase letters, digits, single '-' between them), 1 to ${MAX_SLUG_LENGTH} characters, ` +
      "matching ^[a-z0-9]+(-[a-z0-9]+)*$ (for example 'shop-front')",
    { slug: String(slug) },
  );
}
