/**
 * Text as a slug: lowercased, letters, marks and digits of any script kept
 * along with `_` and `-`, other characters dropped, and runs of spaces and
 * hyphens joined into one hyphen. Empty when the text has nothing to spell a
 * slug with, e.g. only punctuation.
 */
export function slugify(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}
