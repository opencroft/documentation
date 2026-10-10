/** A run of a line: what the search matched, or what lies between. `start` is its offset in the line. */
export interface HighlightSegment {
  text: string
  match: boolean
  start: number
}

/**
 * `text` cut at the spans the search reported as matched (`[start, end)`
 * offsets, ascending and not overlapping), so a result line can mark them.
 * Spans outside the line are clipped. The segments always join back into
 * `text`.
 */
export function highlightSegments(text: string, ranges: Array<[number, number]>): HighlightSegment[] {
  const segments: HighlightSegment[] = []
  let last = 0
  for (const [from, to] of ranges) {
    const start = Math.max(from, last)
    const end = Math.min(to, text.length)
    if (end <= start) {
      continue
    }
    if (start > last) {
      segments.push({ text: text.slice(last, start), match: false, start: last })
    }
    segments.push({ text: text.slice(start, end), match: true, start })
    last = end
  }
  if (last < text.length || segments.length === 0) {
    segments.push({ text: text.slice(last), match: false, start: last })
  }
  return segments
}
