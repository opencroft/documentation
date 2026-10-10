import type { DocSearchAnswer, DocSearchMatch } from './docs-search'

/** Characters of a matched line shown at most; the rest is a `read` away. */
const EXCERPT_WIDTH = 220
/** Characters kept before the first match when a line is cut. */
const EXCERPT_LEAD = 60

/** The part of a long line around its first match, marked with … where it was cut. */
export function excerpt(match: Pick<DocSearchMatch, 'text' | 'ranges'>): string {
  const { text } = match
  if (text.length <= EXCERPT_WIDTH) {
    return text.trim()
  }
  const first = match.ranges[0]?.[0] ?? 0
  const start = Math.max(0, Math.min(first - EXCERPT_LEAD, text.length - EXCERPT_WIDTH))
  const end = Math.min(text.length, start + EXCERPT_WIDTH)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

/**
 * A search answer as an agent reads it: one numbered entry per page, best
 * first, with the lines that matched, and how to read further. `asked` is how
 * the request is quoted back (the query in quotes, or the pattern).
 */
export function formatAnswer(answer: DocSearchAnswer, asked: string): string {
  const pages = answer.searched.reduce((sum, s) => sum + s.pages, 0)
  const where = answer.searched.map((s) => s.namespace).join(', ')
  const scope = `${pages} published page${pages === 1 ? '' : 's'} of ${where || 'no documentation app'}`
  if (answer.results.length === 0) {
    return [
      `Nothing matches ${asked} in the ${scope}. Drafts are not searched.`,
      'Try other or fewer words, a "quoted phrase" for exact text, or apps: "*" to search every documentation app.',
    ].join('\n')
  }
  const manyApps = answer.searched.length > 1
  const shown =
    answer.total > answer.results.length
      ? `${answer.results.length} of ${answer.total} shown; raise limit for more`
      : `${answer.total} page${answer.total === 1 ? '' : 's'}`
  const out = [
    answer.complete
      ? `Pages matching ${asked}, best first (${shown}). Searched the ${scope}.`
      : `No page has every word of ${asked}. Closest pages, best first, each with the words it lacks (${shown}). Searched the ${scope}.`,
  ]
  answer.results.forEach((result, i) => {
    const title = result.title ? ` — ${result.title}` : ''
    const app = manyApps ? ` [${result.namespace}]` : ''
    const lacks = result.missing.length > 0 ? ` (lacks: ${result.missing.join(', ')})` : ''
    out.push('', `${i + 1}. ${result.path}${title}${app}${lacks}`)
    for (const match of result.matches) {
      const section = match.heading && match.heading !== result.title ? ` § ${match.heading}` : ''
      out.push(`   L${match.line}${section}: ${excerpt(match)}`)
    }
  })
  out.push('', 'Read a page from a line: read {"path": "<path>", "offset": <line>} on its app.')
  return out.join('\n')
}
