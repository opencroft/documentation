// Keeping a page's relative links pointing where they pointed when pages and
// folders move. No host imports, so it runs under `node --test` directly.
//
// A link is found by its destination: an inline link or image (`](dest)`), a
// reference definition (`[id]: dest`), or an HTML `href`/`src`. Fenced code
// and code spans are skipped, so a link written as an example is left as
// written. Only the destination's characters are replaced; the rest of the
// page stays byte for byte.

/** Where a path in the repository is after the move; the path itself when it does not move. */
export type PathMap = (path: string) => string

/**
 * A reference to something that moved that was left as written, with why: a
 * link that could not be rewritten, or the old path mentioned outside a link.
 */
export interface UnrewrittenLink {
  /** The page holding it, at its path after the move. */
  file: string
  /** 1-based line of the page. */
  line: number
  link: string
  reason: string
}

interface Destination {
  /** Offsets in the line. */
  start: number
  end: number
  raw: string
  /** Written as `<dest>`, which allows spaces. */
  angle: boolean
  html: boolean
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const REFERENCE_DEFINITION = /^ {0,3}\[(?:[^\]\\]|\\.)+\]:[ \t]*/
const HTML_LINK = /<(?:a|img|source|video|audio)\b[^>]*?\s(?:href|src)\s*=\s*(["'])(.*?)\1/gi

/** The line with every code span blanked to spaces, so offsets still match it. */
function maskCodeSpans(line: string): string {
  let out = ''
  let i = 0
  while (i < line.length) {
    if (line[i] !== '`') {
      out += line[i++]
      continue
    }
    let run = 1
    while (line[i + run] === '`') {
      run++
    }
    // The span closes at the next run of exactly as many backticks.
    const closer = new RegExp(`(?<!\`)\`{${run}}(?!\`)`, 'g')
    closer.lastIndex = i + run
    const close = closer.exec(line)
    if (!close) {
      out += line.slice(i, i + run)
      i += run
      continue
    }
    const end = close.index + run
    out += ' '.repeat(end - i)
    i = end
  }
  return out
}

/** The markdown destination starting at `at` in `line`, as CommonMark reads one. */
function destinationAt(line: string, at: number): Destination | null {
  if (line[at] === '<') {
    const close = line.indexOf('>', at + 1)
    return close < 0 ? null : { start: at + 1, end: close, raw: line.slice(at + 1, close), angle: true, html: false }
  }
  let depth = 0
  let i = at
  for (; i < line.length; i++) {
    const c = line[i]
    if (c === '\\') {
      i++
    } else if (/\s/.test(c)) {
      break
    } else if (c === '(') {
      depth++
    } else if (c === ')') {
      if (depth === 0) {
        break
      }
      depth--
    }
  }
  return i > at ? { start: at, end: i, raw: line.slice(at, i), angle: false, html: false } : null
}

function destinationsIn(line: string): Destination[] {
  const masked = maskCodeSpans(line)
  const found: Destination[] = []
  const definition = REFERENCE_DEFINITION.exec(masked)
  if (definition) {
    const dest = destinationAt(line, definition[0].length)
    if (dest) {
      found.push(dest)
    }
  }
  const inline = /\]\([ \t]*/g
  for (let m = inline.exec(masked); m; m = inline.exec(masked)) {
    const dest = destinationAt(line, m.index + m[0].length)
    if (dest) {
      found.push(dest)
    }
  }
  HTML_LINK.lastIndex = 0
  for (let m = HTML_LINK.exec(masked); m; m = HTML_LINK.exec(masked)) {
    const end = m.index + m[0].length - 1
    found.push({ start: end - m[2].length, end, raw: line.slice(end - m[2].length, end), angle: false, html: true })
  }
  return found.sort((a, b) => a.start - b.start)
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

/** `relative` resolved against the folder `base`; null when it climbs out of the repository. */
export function resolvePath(base: string, relative: string): string | null {
  const out = base ? base.split('/') : []
  for (const segment of relative.split('/')) {
    if (!segment || segment === '.') {
      continue
    }
    if (segment === '..') {
      if (out.length === 0) {
        return null
      }
      out.pop()
    } else {
      out.push(segment)
    }
  }
  return out.join('/')
}

/** How to get from the folder `base` to `target`, both repository paths. */
export function relativePath(base: string, target: string): string {
  const from = base ? base.split('/') : []
  const to = target ? target.split('/') : []
  let common = 0
  while (common < from.length && common < to.length && from[common] === to[common]) {
    common++
  }
  const parts = [...Array(from.length - common).fill('..'), ...to.slice(common)]
  return parts.length > 0 ? parts.join('/') : '.'
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** A destination that names a file of the repository: its path decoded, and the query or fragment after it. */
interface RepositoryDestination {
  decoded: string
  suffix: string
  /** Written percent-encoded. */
  encoded: boolean
}

/** The repository path a destination names; null for an anchor, a full address or an empty one. */
function repositoryDestination(raw: string): RepositoryDestination | null {
  if (!raw || raw.startsWith('#') || raw.startsWith('//') || SCHEME.test(raw)) {
    return null
  }
  const cut = raw.search(/[?#]/)
  const pathPart = cut < 0 ? raw : raw.slice(0, cut)
  const decoded = decode(pathPart)
  return { decoded, suffix: cut < 0 ? '' : raw.slice(cut), encoded: decoded !== pathPart }
}

type Outcome = { kind: 'keep' } | { kind: 'replace'; text: string } | { kind: 'report'; reason: string }

function rewriteDestination(dest: Destination, fromPath: string, toPath: string, map: PathMap): Outcome {
  const named = repositoryDestination(dest.raw)
  if (!named) {
    return { kind: 'keep' }
  }
  const { decoded, suffix, encoded } = named

  if (decoded.startsWith('/')) {
    const target = resolvePath('', decoded)
    return target !== null && map(target) !== target
      ? { kind: 'report', reason: 'a link from the repository root is not rewritten' }
      : { kind: 'keep' }
  }

  const target = resolvePath(dirOf(fromPath), decoded)
  if (target === null) {
    return { kind: 'keep' }
  }
  const moved = map(target)
  const newBase = dirOf(toPath)
  if (resolvePath(newBase, decoded) === moved) {
    return { kind: 'keep' }
  }
  let path = relativePath(newBase, moved)
  if (decoded.endsWith('/') && !path.endsWith('/')) {
    path += '/'
  }
  if (encoded || dest.html) {
    path = path.split('/').map(encodeURIComponent).join('/')
  }
  const text = `${path}${suffix}`
  // A bare destination cannot hold a space; the angle form can.
  return { kind: 'replace', text: !dest.angle && !dest.html && /\s/.test(text) ? `<${text}>` : text }
}

/** What a mention of an old path is reported with. */
export const MENTION_REASON = 'the old path is mentioned here'

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Where the page `file` still names an old path in its text rather than in a
 * link: a path in backticks or plain text, or an absolute address, which
 * can't be told apart from text that merely looks like one and so is shown,
 * never edited. `needles` are the old paths -- a page's path, a folder's path
 * ending in `/`, or a renamed page's old file name. Relative link
 * destinations are not mentions: those are rewritten, or for what is deleted,
 * found by `linksTo`.
 */
export function findMentions(
  markdown: string,
  file: string,
  needles: string[],
  reason = MENTION_REASON,
): UnrewrittenLink[] {
  if (needles.length === 0) {
    return []
  }
  // A file's path ends at a word boundary; a folder's, ending in `/`, may go on into the folder.
  const alternatives = needles.map((needle) =>
    needle.endsWith('/') ? escapeRegExp(needle) : `${escapeRegExp(needle)}(?![\\p{L}\\p{N}_-])`,
  )
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_.-])(?:${alternatives.join('|')})`, 'gu')
  const found: UnrewrittenLink[] = []
  markdown.split('\n').forEach((line, index) => {
    let text = line
    for (const dest of destinationsIn(line)) {
      if (!SCHEME.test(dest.raw) && !dest.raw.startsWith('//')) {
        text = text.slice(0, dest.start) + ' '.repeat(dest.end - dest.start) + text.slice(dest.end)
      }
    }
    // A match resumes after the last one, so a file name inside a full path
    // that was just reported is not reported again.
    for (const match of text.matchAll(pattern)) {
      found.push({ file, line: index + 1, link: match[0], reason })
    }
  })
  return found
}

/** Calls `visit` with each line of `lines` outside fenced code, and its index. */
function forEachLineOutsideFences(lines: string[], visit: (line: string, index: number) => void): void {
  let fence: { char: string; length: number } | null = null
  lines.forEach((line, index) => {
    const opener = FENCE.exec(line)
    if (fence) {
      if (
        opener &&
        opener[1][0] === fence.char &&
        opener[1].length >= fence.length &&
        !line.slice(opener[0].length).trim()
      ) {
        fence = null
      }
      return
    }
    if (opener) {
      fence = { char: opener[1][0], length: opener[1].length }
      return
    }
    visit(line, index)
  })
}

/** What a link to something deleted is reported with. */
export const DELETED_LINK_REASON = 'it links to what was deleted'

/** What a mention of a deleted path is reported with. */
export const DELETED_MENTION_REASON = 'the deleted path is mentioned here'

/**
 * The links in the page `file` to a path `deleted` holds -- a deleted page, or
 * anything in a deleted folder -- as written, relative ones and ones from the
 * repository root alike. Links in code are examples and left out.
 */
export function linksTo(markdown: string, file: string, deleted: (path: string) => boolean): UnrewrittenLink[] {
  const found: UnrewrittenLink[] = []
  forEachLineOutsideFences(markdown.split('\n'), (line, index) => {
    for (const dest of destinationsIn(line)) {
      const named = repositoryDestination(dest.raw)
      if (!named) {
        continue
      }
      const target = named.decoded.startsWith('/')
        ? resolvePath('', named.decoded)
        : resolvePath(dirOf(file), named.decoded)
      if (target !== null && deleted(target)) {
        found.push({ file, line: index + 1, link: dest.raw, reason: DELETED_LINK_REASON })
      }
    }
  })
  return found
}

/**
 * The page at `fromPath`, moving to `toPath`, with every relative link fixed
 * for `map`: a link to something that moves points at where it goes, and a
 * link from a page that moves still points at what it pointed at. Links that
 * can't be fixed are left as written and listed.
 */
export function rewriteLinks(
  markdown: string,
  fromPath: string,
  toPath: string,
  map: PathMap,
): { text: string; unrewritten: UnrewrittenLink[] } {
  const lines = markdown.split('\n')
  const unrewritten: UnrewrittenLink[] = []

  forEachLineOutsideFences(lines, (line, index) => {
    const found = destinationsIn(line).map((dest) => ({
      dest,
      outcome: rewriteDestination(dest, fromPath, toPath, map),
    }))
    for (const { dest, outcome } of found) {
      if (outcome.kind === 'report') {
        unrewritten.push({ file: toPath, line: index + 1, link: dest.raw, reason: outcome.reason })
      }
    }
    // Right to left, so the offsets still to come stay valid.
    let out = line
    for (const { dest, outcome } of found.reverse()) {
      if (outcome.kind === 'replace') {
        out = out.slice(0, dest.start) + outcome.text + out.slice(dest.end)
      }
    }
    lines[index] = out
  })

  return { text: lines.join('\n'), unrewritten }
}
