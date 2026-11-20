// What the documentation browser publishes as the reader's selection: the
// open page, or the lines highlighted on it, each as a reference to the App's
// own `read` action. The host composes the quote and the block from these
// items (the `Space › App › what` path, the `Read:` call, the 4,000-character
// cap on quoted text); this module only says which page, which lines and
// which text, and how long a highlight lasts.
//
// No React and no host imports, so `node --test` loads it.

import type { Selection } from '@opencroft/client/chat'

/** Source lines of the open page, 1-based and inclusive. */
export interface LineSpan {
  start: number
  end: number
}

/** Which version of the page is on screen: the published one, or its shared draft (editor, never-published page). */
export type ShownVersion = 'published' | 'draft'

/**
 * Which view of the open page is on screen: the published page (the only
 * view with a line map), its shared draft (the editor, or a page never
 * published), or one version's changes from the history, named by its commit.
 */
export type DocView = 'page' | 'draft' | `changes:${string}`

/** The page version a view shows: the draft for the draft, the published page otherwise. */
export function shownVersion(view: DocView): ShownVersion {
  return view === 'draft' ? 'draft' : 'published'
}

/**
 * One visit of one view: the open page, its markdown as published, and the
 * view on screen. A highlight is made in a visit and belongs to it alone.
 */
export interface Visit {
  /** The open page, '' when none (the search results). */
  path: string
  source: string
  view: DocView
}

/** What the reader highlighted: its source lines when the view has a line map, and its text. */
export interface Highlight {
  span: LineSpan | null
  text: string
}

export interface HighlightState {
  visit: Visit
  highlight: Highlight | null
}

function sameVisit(a: Visit, b: Visit): boolean {
  return a.path === b.path && a.source === b.source && a.view === b.view
}

/**
 * The state once `visit` is on screen. Any change of page, of its markdown or
 * of view starts a new visit with nothing highlighted, so coming back to a
 * page, or to the same view of it, starts from the page alone. The same visit
 * returns `state` itself, so a caller can tell nothing changed by identity.
 */
export function enterVisit(state: HighlightState, visit: Visit): HighlightState {
  return sameVisit(state.visit, visit) ? state : { visit, highlight: null }
}

/**
 * The state after a highlight made during `visit`. A highlight read after
 * its visit ended (the settle delay outlived the view) is dropped.
 */
export function recordHighlight(state: HighlightState, visit: Visit, highlight: Highlight): HighlightState {
  return sameVisit(state.visit, visit) ? { visit: state.visit, highlight } : state
}

/**
 * What the visit publishes: nothing off a page; the highlighted lines when
 * the highlight has them; otherwise the page, with any highlighted text.
 */
export function visitSelection(app: string, { visit, highlight }: HighlightState): Selection | null {
  if (!visit.path) {
    return null
  }
  if (highlight?.span && visit.source) {
    return highlightSelection(app, visit.path, visit.source, highlight.span)
  }
  return pageSelection(app, visit.path, shownVersion(visit.view), highlight?.text)
}

const PAGE_NOUN: [singular: string, plural: string] = ['page', 'pages']

/** The page's file name, as the quote shows it. */
export function pageName(path: string): string {
  return path.split('/').pop() || path
}

/**
 * The open page. Its call reads the version the reader sees: `read` answers
 * the published page by default, and a page on screen as its draft is read
 * with `version: "draft"`, since a page never published has no published
 * version at all.
 *
 * `text` is text highlighted where the page has no line map (its editor, a
 * version's changes): it travels with the page, with no line range. The host
 * cuts it to its cap.
 */
export function pageSelection(app: string, path: string, shown: ShownVersion, text?: string): Selection {
  return {
    items: [
      {
        kind: 'app',
        app,
        action: 'read',
        params: shown === 'draft' ? { path, version: 'draft' } : { path },
        name: pageName(path),
        noun: PAGE_NOUN,
        ...(text ? { text } : {}),
      },
    ],
  }
}

/**
 * Lines highlighted on the published page, quoted from `source`, the page's
 * markdown as published. Its call reads the same lines (`read` slices the
 * published page by `offset` and `limit` the way this slices `source`), so
 * the quoted text and the call's answer are the same lines. The text is
 * handed over whole; the host cuts it to its cap.
 */
export function highlightSelection(app: string, path: string, source: string, span: LineSpan): Selection {
  const text = source
    .split('\n')
    .slice(span.start - 1, span.end)
    .join('\n')
  return {
    items: [
      {
        kind: 'app',
        app,
        action: 'read',
        params: { path, offset: span.start, limit: span.end - span.start + 1 },
        name: pageName(path),
        noun: PAGE_NOUN,
        lines: { from: span.start, to: span.end },
        text,
      },
    ],
  }
}
