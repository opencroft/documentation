// The App's addresses. A doc page is the file's own path under the instance's
// address (`/guides/intro.md`), and a heading on it is the `heading` query
// (`/guides/intro.md?heading=setup`), so each has a link of its own. The doc
// in its editor is the `edit` query (`/guides/intro.md?edit=true`). Search
// results are a page of their own, `/search?q=…`: no doc can sit at that
// path, since every doc's ends in `.md`. Everything here is App-relative, the
// form the host's App router takes.

import type { DocEntry } from './types'

const HEADING_PARAM = 'heading'
const EDIT_PARAM = 'edit'
const SEARCH_PATH = '/search'
const QUERY_PARAM = 'q'

/** What an App location shows: a doc (at a heading, or in its editor), the search results, or the bare address. */
export type DocsRoute =
  | { page: 'doc'; doc: string; heading: string | null; edit: boolean }
  | { page: 'search'; query: string }
  | { page: 'home' }

export function routeOf(appPath: string, search: URLSearchParams): DocsRoute {
  if (appPath === SEARCH_PATH) {
    return { page: 'search', query: search.get(QUERY_PARAM) ?? '' }
  }
  const doc = docPathOf(appPath)
  return doc === null
    ? { page: 'home' }
    : { page: 'doc', doc, heading: headingOf(search), edit: search.get(EDIT_PARAM) === 'true' }
}

/** The App path of the search results for `query`. */
export function searchAppPath(query: string): string {
  return `${SEARCH_PATH}?${new URLSearchParams({ [QUERY_PARAM]: query })}`
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** The App path of a doc, at one of its headings when `heading` is given. */
export function docAppPath(docPath: string, heading?: string): string {
  const path = `/${docPath.split('/').map(encodeURIComponent).join('/')}`
  return heading ? `${path}${headingQuery(heading)}` : path
}

/** The App path of a doc open in its editor. */
export function docEditAppPath(docPath: string): string {
  return `${docAppPath(docPath)}?${new URLSearchParams({ [EDIT_PARAM]: 'true' })}`
}

/** A heading of the page the App is on, as a bare query. */
export function headingQuery(heading: string): string {
  return `?${new URLSearchParams({ [HEADING_PARAM]: heading })}`
}

/** The doc an App path names; null at the App's bare address. */
export function docPathOf(appPath: string): string | null {
  const segments = appPath.split('/').filter(Boolean).map(decodeSegment)
  return segments.length > 0 ? segments.join('/') : null
}

/** The heading an App location's query names, if any. */
export function headingOf(search: URLSearchParams): string | null {
  return search.get(HEADING_PARAM) || null
}

/** `href` resolved against the directory of the doc at `currentPath`. */
export function resolveRelativeDoc(currentPath: string | null, href: string): string {
  const base = currentPath ? currentPath.split('/').slice(0, -1) : []
  const out = [...base]
  for (const s of href.split('/')) {
    if (!s || s === '.') {
      continue
    }
    if (s === '..') {
      out.pop()
      continue
    }
    out.push(s)
  }
  return out.join('/')
}

/**
 * Where a link written inside the doc at `currentPath` leads, as an App path:
 * `#setup` is a heading of this page, `../guide.md#setup` a heading of another
 * doc. Null for anything that is not a doc or a heading — the caller renders
 * it as a plain link.
 */
export function docLinkTo(currentPath: string | null, href: string): string | null {
  const [pathPart, heading] = href.split('#')
  if (!pathPart) {
    return heading ? headingQuery(heading) : null
  }
  if (!pathPart.endsWith('.md')) {
    return null
  }
  return docAppPath(resolveRelativeDoc(currentPath, pathPart), heading || undefined)
}

function containsFile(entries: DocEntry[], path: string): boolean {
  return entries.some((e) => (e.type === 'file' ? e.path === path : containsFile(e.children ?? [], path)))
}

export function findFirstFile(entries: DocEntry[]): string | null {
  for (const e of entries) {
    if (e.type === 'file') {
      return e.path
    }
    if (e.children) {
      const f = findFirstFile(e.children)
      if (f) {
        return f
      }
    }
  }
  return null
}

/** The page a folder opens: its `index.md`, when the tree has one. */
export function folderPage(entries: DocEntry[], folder: string): string | null {
  const index = `${folder}/index.md`
  return containsFile(entries, index) ? index : null
}

/** The page the App's bare address opens: `preferred` when the tree has it, else its first file. */
export function defaultDoc(entries: DocEntry[], preferred: string | null): string | null {
  return preferred && containsFile(entries, preferred) ? preferred : findFirstFile(entries)
}
