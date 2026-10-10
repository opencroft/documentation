// Ranked search over documentation pages held in memory. Pure: the caller
// loads the pages; nothing here reads git or the host.

import vm from 'node:vm'

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const FENCE_RE = /^\s*(`{3,}|~{3,})/

/** One page, split into lines, with the section each line sits in. */
export interface Page {
  path: string
  /** The first H1, or null when the page has none. */
  title: string | null
  lines: string[]
  /** For each line, the text of the heading it falls under (null before the first one). */
  sections: (string | null)[]
  /** Indexes of the lines that are headings. */
  headingLines: Set<number>
}

/** What to look for: one word or phrase of a query, or a whole pattern. */
export interface Matcher {
  /** As the caller wrote it, for telling them which words a page lacks. */
  label: string
  /** The matched spans of each of `texts`, in order. */
  findAll(texts: string[]): Array<Array<[number, number]>>
}

/** A line chosen to show why a page matched. `ranges` are the matched spans, as [start, end) offsets. */
export interface Snippet {
  line: number
  text: string
  section: string | null
  ranges: Array<[number, number]>
}

export interface Hit {
  page: Page
  score: number
  /** Labels of the matchers the page does not contain; empty when it contains them all. */
  missing: string[]
  snippets: Snippet[]
}

// Dropped from a query unless nothing else is left: a page rarely says
// "how to", and requiring every word would otherwise rule it out.
const STOP_WORDS = new Set(
  'a an and are as at be by can do does for from how i in into is it of on or should the this to use what when where which who why with'.split(
    ' ',
  ),
)

// Field weights: a word in the title or a heading says more about what a page
// is for than one in its body, and a pattern match inside a longer word
// ("check" in "ShieldCheck") says less.
const TITLE_WEIGHT = 3
const PATH_WEIGHT = 1.5
const HEADING_WEIGHT = 1.5
const INNER_WORD_WEIGHT = 0.25
const BODY_SATURATION = 1.5
const SECTION_BONUS = 0.5

// A stem shorter than this matches the start of unrelated words ("using" → "us"
// finds "user"), so such a word is searched as typed.
const MIN_STEM = 4

// The time one pattern may spend matching, over every page searched. Its
// regular expression runs on the server's own thread, and nested quantifiers
// can backtrack for minutes on one line.
const PATTERN_BUDGET_MS = 1000

export function parsePage(path: string, content: string): Page {
  const lines = content.split('\n')
  const sections: (string | null)[] = []
  const headingLines = new Set<number>()
  let title: string | null = null
  let section: string | null = null
  let fence: string | null = null
  lines.forEach((line, i) => {
    const fenceMark = line.match(FENCE_RE)
    if (fenceMark) {
      const char = fenceMark[1][0]
      fence = fence === null ? char : fence === char ? null : fence
    } else if (fence === null) {
      const heading = line.match(HEADING_RE)
      if (heading) {
        section = heading[2]
        headingLines.add(i)
        if (heading[1].length === 1 && title === null) {
          title = heading[2]
        }
      }
    }
    sections.push(section)
  })
  return { path, title, lines, sections, headingLines }
}

/**
 * The `git grep` arguments, before the commit, that list every line of every
 * markdown page: an empty pattern matches every line. Exits non-zero when
 * there is no markdown at all.
 */
export const PAGES_GREP_ARGS = ['grep', '-I', '-n', '--null', '-e', '']

/**
 * The pages in the output of `git <PAGES_GREP_ARGS> <commit> -- '*.md'`: one
 * record per line, `<commit>:<path>` NUL `<line number>` NUL `<text>`.
 */
export function pagesFromGrep(commit: string, listing: string): Page[] {
  const prefix = `${commit}:`
  const linesByPath = new Map<string, string[]>()
  for (const record of listing.split('\n')) {
    const pathEnd = record.indexOf('\0')
    const numberEnd = record.indexOf('\0', pathEnd + 1)
    if (pathEnd < 0 || numberEnd < 0 || !record.startsWith(prefix)) {
      continue
    }
    const path = record.slice(prefix.length, pathEnd)
    const lines = linesByPath.get(path) ?? []
    lines[Number(record.slice(pathEnd + 1, numberEnd)) - 1] = record.slice(numberEnd + 1)
    linesByPath.set(path, lines)
  }
  return [...linesByPath].map(([path, lines]) => parsePage(path, Array.from(lines, (line) => line ?? '').join('\n')))
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matchRanges(text: string, re: RegExp): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const m of text.matchAll(re)) {
    if (m[0].length > 0) {
      ranges.push([m.index, m.index + m[0].length])
    }
  }
  return ranges
}

/**
 * The forms a word is searched by, with its common endings cut off, so
 * "worktrees" finds "worktree" and "deploying" finds "deploy". Each form is at
 * least MIN_STEM letters, and one of them is a prefix of the word, so the word
 * as typed always finds itself.
 */
function stems(word: string): string[] {
  if (word.length < 5 || !/^\p{L}+$/u.test(word)) {
    return [word]
  }
  const cut = word.endsWith('ies')
    ? // "policies" → "policy", and "policie" for "series" and "cookies", whose singular keeps the "ie".
      [`${word.slice(0, -3)}y`, word.slice(0, -1)]
    : /(?:s|x|ch|sh)es$/.test(word)
      ? [word.slice(0, -2)]
      : word.endsWith('ing')
        ? [word.slice(0, -3)]
        : word.endsWith('ed')
          ? [word.slice(0, -2)]
          : word.endsWith('s') && !word.endsWith('ss')
            ? [word.slice(0, -1)]
            : []
  const forms = cut.filter((form) => form.length >= MIN_STEM)
  return forms.some((form) => word.startsWith(form)) ? forms : [...forms, word]
}

/**
 * The words and "quoted phrases" of a query, each matched case-insensitively
 * as plain text at the start of a word, so "review" finds "reviewer" but not
 * "preview". Punctuation around a word is dropped, inside it kept
 * (`check:baseline`, `docs.search`). Common words are dropped while others
 * remain.
 */
export function parseQuery(query: string): Matcher[] {
  const words: string[] = []
  for (const m of query.matchAll(/"([^"]+)"|(\S+)/g)) {
    const typed = (m[1] ?? m[2]).trim()
    // A token of nothing but that punctuation (a code fence) is searched as typed.
    const word = typed.replace(/^[\s.,;:!?()[\]{}'"`]+|[\s.,;:!?()[\]{}'"`]+$/g, '') || typed
    if (word && !words.some((w) => w.toLowerCase() === word.toLowerCase())) {
      words.push(word)
    }
  }
  const kept = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()))
  return (kept.length > 0 ? kept : words).map((word) => {
    const forms = stems(word.toLowerCase()).map(escapeRegExp).join('|')
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${forms})`, 'giu')
    return { label: word, findAll: (texts) => texts.map((text) => matchRanges(text, re)) }
  })
}

// Runs in a context of its own so that `timeout` can stop it mid-match.
const PATTERN_SCAN = new vm.Script(`texts.map((text) => {
  const ranges = []
  for (const m of text.matchAll(re)) {
    if (m[0].length > 0) ranges.push([m.index, m.index + m[0].length])
  }
  return ranges
})`)

/**
 * A regular expression (JavaScript syntax), matched case-insensitively. A
 * leading `(?i)` is accepted and ignored, since matching is case-insensitive
 * already. Throws with the parser's message when it does not compile.
 */
export function parsePattern(pattern: string): Matcher {
  const source = pattern.replace(/^\(\?i\)/, '')
  let re: RegExp
  try {
    re = new RegExp(source, 'giu')
  } catch (error) {
    throw new Error(`Invalid pattern ${JSON.stringify(pattern)}: ${(error as Error).message}`)
  }
  const context = vm.createContext({ re, texts: [] as string[] })
  let spent = 0
  return {
    label: pattern,
    findAll: (texts) => {
      context.texts = texts
      const started = performance.now()
      let found: Array<Array<[number, number]>>
      try {
        found = PATTERN_SCAN.runInContext(context, { timeout: Math.max(1, Math.ceil(PATTERN_BUDGET_MS - spent)) })
      } catch (error) {
        if ((error as { code?: string }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
          throw new Error(
            `Pattern ${JSON.stringify(pattern)} was stopped after ${PATTERN_BUDGET_MS} ms: it backtracks too much, usually through nested quantifiers such as (a+)+. Simplify it, or pass query.`,
          )
        }
        throw error
      } finally {
        spent += performance.now() - started
      }
      // Copied out of the context's realm, so the arrays are ordinary ones here.
      return Array.from(found, (ranges) => Array.from(ranges, ([start, end]): [number, number] => [start, end]))
    },
  }
}

function isWordStart(text: string, at: number): boolean {
  return at === 0 || !/[\p{L}\p{N}]/u.test(text[at - 1])
}

/** How strongly a line matches: 1 per match at the start of a word, less inside one. */
function lineWeight(text: string, ranges: Array<[number, number]>): number {
  let weight = 0
  for (const [start] of ranges) {
    weight += isWordStart(text, start) ? 1 : INNER_WORD_WEIGHT
  }
  return weight
}

interface TermOnPage {
  /** Line index → ranges, for the lines it occurs on. */
  lines: Map<number, Array<[number, number]>>
  /** Field-weighted strength, before the term's rarity is applied. */
  strength: number
}

function termOnPage(page: Page, matcher: Matcher): TermOnPage | null {
  const found = matcher.findAll([...page.lines, page.title ?? '', page.path])
  const lines = new Map<number, Array<[number, number]>>()
  let body = 0
  let inHeading = false
  page.lines.forEach((text, i) => {
    const ranges = found[i]
    if (ranges.length > 0) {
      lines.set(i, ranges)
      body += lineWeight(text, ranges)
      inHeading ||= page.headingLines.has(i)
    }
  })
  const inTitle = found[page.lines.length].length > 0
  const inPath = found[page.lines.length + 1].length > 0
  if (lines.size === 0 && !inPath) {
    return null
  }
  const strength =
    (inTitle ? TITLE_WEIGHT : 0) +
    (inPath ? PATH_WEIGHT : 0) +
    (inHeading ? HEADING_WEIGHT : 0) +
    body / (body + BODY_SATURATION)
  return { lines, strength }
}

interface CandidateLine {
  line: number
  score: number
  terms: Set<number>
  ranges: Array<[number, number]>
}

/**
 * The best lines of a page for the terms it matched. Each pick prefers a line
 * showing a term no earlier pick showed, so together they account for every
 * term; among those, the line with the most (and rarest) terms, then the
 * earliest.
 */
function pickSnippets(page: Page, found: Array<{ term: TermOnPage; idf: number }>, perPage: number): Snippet[] {
  const candidates = new Map<number, CandidateLine>()
  found.forEach(({ term, idf }, t) => {
    for (const [i, ranges] of term.lines) {
      const candidate = candidates.get(i) ?? {
        line: i,
        score: page.headingLines.has(i) ? SECTION_BONUS : 0,
        terms: new Set<number>(),
        ranges: [],
      }
      candidate.score += idf * Math.min(1, lineWeight(page.lines[i], ranges))
      candidate.terms.add(t)
      candidate.ranges.push(...ranges)
      candidates.set(i, candidate)
    }
  })
  const shown = new Set<number>()
  const fresh = (c: CandidateLine) => [...c.terms].reduce((sum, t) => sum + (shown.has(t) ? 0 : found[t].idf), 0)
  const picked: CandidateLine[] = []
  while (picked.length < perPage && candidates.size > 0) {
    const [best] = [...candidates.values()].sort((a, b) => fresh(b) - fresh(a) || b.score - a.score || a.line - b.line)
    picked.push(best)
    candidates.delete(best.line)
    for (const t of best.terms) {
      shown.add(t)
    }
  }
  return picked.map(({ line, ranges }) => ({
    line: line + 1,
    text: page.lines[line],
    section: page.sections[line],
    ranges: mergeRanges(ranges),
  }))
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: Array<[number, number]> = []
  for (const [start, end] of sorted) {
    const last = out.at(-1)
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end)
    } else {
      out.push([start, end])
    }
  }
  return out
}

/** The largest number of distinct terms that share one section of the page, weighted by rarity. */
function bestSectionWeight(page: Page, found: Array<{ term: TermOnPage; idf: number }>): number {
  const bySection = new Map<string | null, number>()
  for (const { term, idf } of found) {
    const sections = new Set([...term.lines.keys()].map((i) => page.sections[i]))
    for (const section of sections) {
      bySection.set(section, (bySection.get(section) ?? 0) + idf)
    }
  }
  return Math.max(0, ...bySection.values())
}

/**
 * Pages ranked for `matchers`. A page holding every matcher ranks above any
 * that lacks one; among equals, by BM25-style weight (rarer terms count more,
 * repeats count less, title/heading/path count more), plus a bonus when the
 * terms meet in one section. Pages holding none are left out.
 */
export function rankPages(pages: Page[], matchers: Matcher[], perPage: number): Hit[] {
  const perPageTerms = pages.map((page) => matchers.map((matcher) => termOnPage(page, matcher)))
  const idf = matchers.map((_, t) => {
    const df = perPageTerms.filter((terms) => terms[t] !== null).length
    return Math.log(1 + (pages.length - df + 0.5) / (df + 0.5))
  })
  const ranked: Array<Hit & { coverage: number }> = []
  pages.forEach((page, p) => {
    const found: Array<{ term: TermOnPage; idf: number }> = []
    const missing: string[] = []
    perPageTerms[p].forEach((term, t) => {
      if (term) {
        found.push({ term, idf: idf[t] })
      } else {
        missing.push(matchers[t].label)
      }
    })
    if (found.length === 0) {
      return
    }
    const score =
      found.reduce((sum, { term, idf }) => sum + idf * term.strength, 0) +
      (found.length > 1 ? SECTION_BONUS * bestSectionWeight(page, found) : 0)
    ranked.push({ page, score, missing, snippets: pickSnippets(page, found, perPage), coverage: found.length })
  })
  ranked.sort((a, b) => b.coverage - a.coverage || b.score - a.score || a.page.path.localeCompare(b.page.path))
  return ranked.map(({ coverage: _coverage, ...hit }) => hit)
}
