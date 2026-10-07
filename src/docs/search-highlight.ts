/** A run of a line: the words searched for, or what lies between them. */
export interface HighlightSegment {
  text: string
  match: boolean
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * `text` cut into the runs that match `query` and the runs between them, so a
 * result line can mark what was searched for.
 *
 * The match is the search's own: plain text, not a pattern, and case
 * insensitive (the server searches with a fixed-string, ignore-case grep). A
 * query with a `.` or `(` in it must match those characters and nothing else,
 * which is why it is escaped rather than handed to a regular expression raw.
 * The segments always join back into `text`.
 */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const needle = query.trim()
  if (!needle) {
    return [{ text, match: false }]
  }
  const segments: HighlightSegment[] = []
  let last = 0
  for (const m of text.matchAll(new RegExp(escapeRegExp(needle), 'giu'))) {
    const at = m.index ?? 0
    if (at > last) {
      segments.push({ text: text.slice(last, at), match: false })
    }
    segments.push({ text: m[0], match: true })
    last = at + m[0].length
  }
  if (last < text.length) {
    segments.push({ text: text.slice(last), match: false })
  }
  return segments.length > 0 ? segments : [{ text, match: false }]
}
