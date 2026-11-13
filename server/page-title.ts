// A page's title is its first line, a level-1 heading. No host imports, so it
// runs under `node --test` directly.

import type { Git } from './tree-commit.ts'

const H1 = /^ {0,3}#(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/

/** The text of a level-1 ATX heading line, '' for an empty one; null when the line is not one. */
function headingText(line: string): string | null {
  const match = H1.exec(line)
  if (!match) {
    return null
  }
  // `# #` is an empty heading whose closing sequence is all that is left.
  return (match[1] ?? '').replace(/^#+$/, '').trim()
}

/**
 * The page's title: the text of the level-1 heading its first non-blank line
 * must be. '' when that heading is empty; null when the page does not start
 * with one.
 */
export function pageTitle(markdown: string): string | null {
  for (const line of markdown.split('\n')) {
    if (line.trim()) {
      return headingText(line.replace(/\r$/, ''))
    }
  }
  return null
}

/**
 * Each page's title at `ref`, read in one pass: `git grep` gives every page's
 * first non-blank line, which `pageTitle` reads as the editor does. A page
 * that does not start with a title is absent.
 */
export async function titlesAt(git: Git, ref: string): Promise<Map<string, string>> {
  const output = await git('grep', '-I', '-z', '-m', '1', '-e', '[^[:space:]]', ref, '--', '*.md').catch(
    // Every page is blank: grep exits non-zero.
    () => '',
  )
  const titles = new Map<string, string>()
  for (const line of output.split('\n')) {
    const nul = line.indexOf('\0')
    if (nul < 0 || !line.startsWith(`${ref}:`)) {
      continue
    }
    const title = pageTitle(line.slice(nul + 1))
    if (title) {
      titles.set(line.slice(ref.length + 1, nul), title)
    }
  }
  return titles
}

/** A title made from a page's file name, for a page that has no title yet: `getting-started.md` → `Getting started`. */
export function titleFromFileName(fileName: string): string {
  const words = fileName.replace(/\.md$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : fileName
}

/** The page as the editor opens it: starting with its title, made from `fileName` when it has none. */
export function withTitle(markdown: string, fileName: string): string {
  if (pageTitle(markdown) !== null) {
    return markdown
  }
  const heading = `# ${titleFromFileName(fileName)}\n`
  return markdown.trim() ? `${heading}\n${markdown}` : heading
}
