import { ChatDock as HostChatDock, usePublishSelection } from '@opencroft/client/chat'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import {
  type DocView,
  enterVisit,
  type HighlightState,
  type LineSpan,
  recordHighlight,
  type Visit,
  visitSelection,
} from './doc-selection'

// The chat's whole chrome -- launcher, docking, floating window, mobile
// cover -- is the host's ChatDock, the same surface the space canvas mounts.
// The browser contributes only what is its own: the selection it publishes
// and which thread is its default. The selection scope is the host's, mounted
// around the App page.

// Long enough that dragging a highlight does not publish per-pixel, short
// enough that the badge follows the reader rather than lagging behind them.
const SELECTION_SETTLE_MS = 250

/**
 * The markdown lines a DOM node was rendered from.
 *
 * Every rendered element carries data-source-line/-end (see the rehype plugin
 * in docs-page). Walking UP to the nearest annotated ancestor is the lookup:
 * a selection usually anchors in a text node, and inline elements inherit the
 * position of the block that contains them.
 */
function sourceLinesOf(node: Node | null, container: HTMLElement | null): LineSpan | null {
  let el: HTMLElement | null =
    node instanceof HTMLElement ? node : ((node?.parentElement ?? null) as HTMLElement | null)
  while (el && container?.contains(el)) {
    const start = el.getAttribute('data-source-line')
    if (start) {
      const end = el.getAttribute('data-source-line-end') ?? start
      return { start: Number(start), end: Number(end) }
    }
    el = el.parentElement
  }
  return null
}

/** The source lines a DOM selection covers: both ends resolved, the outer bounds taken. */
function spanOf(selection: globalThis.Selection, container: HTMLElement): LineSpan | null {
  const ends = [sourceLinesOf(selection.anchorNode, container), sourceLinesOf(selection.focusNode, container)].filter(
    (lines) => lines !== null,
  )
  if (ends.length === 0) {
    return null
  }
  return {
    start: Math.min(...ends.map((lines) => lines.start)),
    end: Math.max(...ends.map((lines) => lines.end)),
  }
}

/**
 * Publishes what the reader is looking at, and what they have highlighted.
 *
 * THE PAGE IS THE CONTEXT; a highlight refines it. With nothing highlighted
 * the open page is what a question is about, so it is published on its own.
 * Off a page (the search results) nothing is published.
 *
 * `selectionchange` fires on every caret movement, so the highlight is read
 * once the events settle, and `usePublishSelection` compares by value, so a
 * caret move that changes nothing publishes nothing.
 */
function DocSelectionBridge({
  containerRef,
  app,
  file,
  source,
  view,
}: {
  containerRef: { current: HTMLDivElement | null }
  app: string
  file: string
  /** The open page's published markdown, so a highlight is quoted from the file. */
  source: string
  view: DocView
}) {
  // A highlight belongs to the visit it was made in (see enterVisit). The
  // reset happens in the render that first sees the new visit, not in an
  // effect after it, so the previous visit's highlight is never published
  // with the new one.
  const visit: Visit = { path: file, source, view }
  const [stored, setStored] = useState<HighlightState>({ visit, highlight: null })
  const state = enterVisit(stored, visit)
  if (state !== stored) {
    setStored(state)
  }

  usePublishSelection(visitSelection(app, state))

  // A highlight REPLACES the page as the context, until the reader highlights
  // again or leaves the view: another page, the editor, a version's changes,
  // or back from any of them, each of which starts from the page alone.
  //
  // THE COLLAPSE IS NOT A CLEAR, and that distinction is the whole feature:
  // clicking into the composer to type the question collapses the document's
  // DOM selection, so treating a collapse as "nothing selected" would throw
  // away the very lines the reader highlighted in order to ask about them --
  // there is no way to reach the input with a selection still attached. Only a
  // new highlight replaces what is published. Leaving the App unmounts this
  // publisher, which clears what it published.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const read = () => {
      const selection = typeof window === 'undefined' ? null : window.getSelection()
      const text = selection ? selection.toString().trim() : ''
      const container = containerRef.current
      // Only a highlight made INSIDE the document counts. Selecting text in the
      // chat's own transcript must not feed itself back as context.
      if (!selection || !text || !container || !selection.anchorNode || !container.contains(selection.anchorNode)) {
        return
      }
      // QUOTED FROM THE FILE, NOT FROM THE PAGE. The rendered text has lost the
      // markup it was written with -- emphasis, link targets, list markers, code
      // fences -- so the lines are quoted from the source. Only the published
      // page's rendering carries the line map; a highlight anywhere else (the
      // editor, a version's changes) has no lines to name, so its own text
      // travels with the page instead.
      const highlight = { span: spanOf(selection, container), text }
      setStored((current) => recordHighlight(current, { path: file, source, view }, highlight))
    }

    const schedule = () => {
      if (timer) {
        clearTimeout(timer)
      }
      timer = setTimeout(read, SELECTION_SETTLE_MS)
    }

    document.addEventListener('selectionchange', schedule)
    return () => {
      if (timer) {
        clearTimeout(timer)
      }
      document.removeEventListener('selectionchange', schedule)
    }
  }, [file, source, view, containerRef])

  return null
}

interface ChatDockProps {
  /** The group chat to open, or null when there is nothing to scope to. */
  space: string | null
  threadId: string
  /** The documentation App's address, `<space>.<slug>`. */
  namespace: string
  /** The open file, '' when none. */
  file: string
  /** The open page's published markdown. */
  source: string
  /** Which view of the open page is on screen. */
  view: DocView
  children: ReactNode
}

/**
 * The docs browser, with the host's shared chat surface around it. Without a
 * repository open there is nothing to scope a conversation to, so `children`
 * render alone and no chat is offered until one is.
 */
export function ChatDock({ space, threadId, namespace, file, source, view, children }: ChatDockProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null)

  if (!space) {
    return <>{children}</>
  }

  return (
    <HostChatDock space={space} id={threadId} title={`Chat · ${space}`}>
      <DocSelectionBridge containerRef={bodyRef} app={namespace} file={file} source={source} view={view} />
      <div ref={bodyRef} className='min-h-0 min-w-0 flex-1 overflow-auto'>
        {children}
      </div>
    </HostChatDock>
  )
}
