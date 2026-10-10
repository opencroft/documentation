import { execFile } from '@opencroft/server/system'

import { docsPublishedRef, getDocsRoot, listDocNamespaces } from './docs-git'
import {
  type Hit,
  type Matcher,
  PAGES_GREP_ARGS,
  type Page,
  pagesFromGrep,
  parsePattern,
  parseQuery,
  rankPages,
} from './search-index'

export interface DocSearchMatch {
  line: number
  text: string
  /** The heading the line falls under. */
  heading: string | null
  /** The matched spans of `text`, as [start, end) offsets. */
  ranges: Array<[number, number]>
}

export interface DocSearchResult {
  namespace: string
  path: string
  title: string | null
  /** The query's words this page does not contain; empty when it has them all. */
  missing: string[]
  matches: DocSearchMatch[]
}

export interface DocSearchRequest {
  /** Words and "quoted phrases", in any order. */
  query?: string
  /** A regular expression, instead of `query`. */
  pattern?: string
  /** Pages to return at most. */
  limit: number
  /** Lines to return per page at most. */
  perPage: number
}

export interface DocSearchAnswer {
  /** Each documentation app searched, with how many published pages it holds. */
  searched: Array<{ namespace: string; pages: number }>
  /** What was looked for: the query's words as kept, or the pattern. */
  terms: string[]
  /** False when no page holds every term, and `results` are the closest ones instead. */
  complete: boolean
  /** How many pages `results` was cut from. */
  total: number
  results: DocSearchResult[]
}

interface PublishedPages {
  commit: string
  pages: Page[]
}

// Parsed once per published commit of each source: a search reads every page,
// and the published version only moves when someone publishes or pulls.
const publishedBySource = new Map<string, PublishedPages>()

function git(root: string, ...args: string[]): Promise<string> {
  return execFile('git', ['-c', 'safe.directory=*', '-c', 'core.quotePath=false', '-C', root, ...args])
}

/** Every published markdown page of one source; none when it is not cloned or has no published commit. */
async function publishedPages(sourceId: string): Promise<Page[]> {
  const root = await getDocsRoot(sourceId)
  if (!root) {
    return []
  }
  const ref = await docsPublishedRef(sourceId)
  const commit = (await git(root, 'rev-parse', '--verify', `${ref}^{commit}`).catch(() => '')).trim()
  if (!commit) {
    return []
  }
  const cached = publishedBySource.get(sourceId)
  if (cached?.commit === commit) {
    return cached.pages
  }
  const listing = await git(root, ...PAGES_GREP_ARGS, commit, '--', '*.md').catch(() => '')
  const pages = pagesFromGrep(commit, listing)
  // Not kept when empty: that is also what a failed git grep gives, and the
  // next search should try again rather than report no pages until a publish.
  if (pages.length > 0) {
    publishedBySource.set(sourceId, { commit, pages })
  }
  return pages
}

function matchersOf(request: DocSearchRequest): Matcher[] {
  const query = request.query?.trim()
  const pattern = request.pattern?.trim()
  if (query && pattern) {
    throw new Error('Pass either query (words) or pattern (a regular expression), not both.')
  }
  if (pattern) {
    return [parsePattern(pattern)]
  }
  const matchers = query ? parseQuery(query) : []
  if (matchers.length === 0) {
    throw new Error(
      'Nothing to search for: pass query, the words to find (in any order), or pattern, a regular expression.',
    )
  }
  return matchers
}

/** The documentation apps named, or all of them when `namespaces` is omitted. Unknown names are refused. */
async function sourcesOf(namespaces: string[] | undefined): Promise<Array<{ id: string; namespace: string }>> {
  const all = await listDocNamespaces()
  if (namespaces === undefined) {
    return all
  }
  const unknown = namespaces.filter((namespace) => !all.some((n) => n.namespace === namespace))
  if (unknown.length > 0) {
    throw new Error(
      `No documentation app ${unknown.join(', ')}. Documentation apps: ${all.map((n) => n.namespace).join(', ')}.`,
    )
  }
  return all.filter((n) => namespaces.includes(n.namespace))
}

function resultOf(hit: Hit, namespace: string): DocSearchResult {
  return {
    namespace,
    path: hit.page.path,
    title: hit.page.title,
    missing: hit.missing,
    matches: hit.snippets.map((s) => ({ line: s.line, text: s.text, heading: s.section, ranges: s.ranges })),
  }
}

/**
 * Search the published pages of the documentation apps `namespaces` names
 * (every one when omitted), ranked across all of them together. When some
 * pages hold every term, only those are returned; otherwise the closest pages,
 * each with the terms it lacks. Throws on a request with nothing to search for,
 * a pattern that does not compile, or an unknown app.
 */
export async function searchDocs(
  namespaces: string[] | undefined,
  request: DocSearchRequest,
): Promise<DocSearchAnswer> {
  const matchers = matchersOf(request)
  const sources = await sourcesOf(namespaces)
  const namespaceOf = new Map<Page, string>()
  const searched: DocSearchAnswer['searched'] = []
  for (const source of sources) {
    const pages = await publishedPages(source.id)
    for (const page of pages) {
      namespaceOf.set(page, source.namespace)
    }
    searched.push({ namespace: source.namespace, pages: pages.length })
  }
  const hits = rankPages([...namespaceOf.keys()], matchers, request.perPage)
  const complete = hits.length > 0 && hits[0].missing.length === 0
  const shown = complete ? hits.filter((hit) => hit.missing.length === 0) : hits
  return {
    searched,
    terms: matchers.map((m) => m.label),
    complete,
    total: shown.length,
    results: shown.slice(0, request.limit).map((hit) => resultOf(hit, namespaceOf.get(hit.page) ?? '')),
  }
}
