import type { Anchor } from './types'

/*
 * Keeping comment anchors in a rendered document.
 *
 * Host-free on purpose -- no React, no `@opencroft/client` -- so it runs under
 * `node --test` with a DOM from jsdom, and the anchoring can be tested without
 * an extension host.
 */

/** How much text on either side of a quote is kept to tell repeats apart. */
export const MAX_CONTEXT = 40

export interface AnchoredComment {
  id: string
  anchor?: Anchor
}

export interface AnchorPosition {
  id: string
  /** The anchor's top edge, relative to the overlay it is drawn in. */
  top: number
}

/**
 * What counts as the document changing under the anchors.
 *
 * Structure and text only -- deliberately NOT attributes. The open thread marks
 * its own anchor by setting `data-active` on it, and observing attributes would
 * report that as the document changing, re-injecting every anchor and throwing
 * away the mark that had just been made.
 */
const CONTENT_MUTATIONS: MutationObserverInit = { childList: true, subtree: true, characterData: true }

/** `NodeFilter.SHOW_TEXT`, without reaching for a global a test DOM may not install. */
const SHOW_TEXT = 0x4

/**
 * The rendered document an overlay annotates: the `.prose-docs` beside it, in
 * the same parent.
 *
 * Not the page's first `.prose-docs`. With two renderings of a document on
 * one page, each with its own overlay, a page-wide lookup sends both overlays
 * to the first rendering: one anchors its comments into a tree it is not
 * beside, and the two re-anchor that one tree in turn, each one's edit waking
 * the other's observer, with no end once a comment is on the page.
 */
export function contentBeside(wrapper: HTMLElement | null): HTMLElement | null {
  return wrapper?.parentElement?.querySelector<HTMLElement>(':scope > .prose-docs') ?? null
}

function unwrapAnchors(container: HTMLElement): void {
  const wrapped = container.querySelectorAll('.doc-comment-anchor')
  wrapped.forEach((span) => {
    const parent = span.parentNode
    if (!parent) {
      return
    }
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span)
    }
    parent.removeChild(span)
  })
  container.normalize()
}

function findOccurrenceIndex(text: string, anchor: Anchor): number {
  for (let idx = text.indexOf(anchor.quote); idx !== -1; idx = text.indexOf(anchor.quote, idx + 1)) {
    const before = text.slice(Math.max(0, idx - MAX_CONTEXT), idx)
    const after = text.slice(idx + anchor.quote.length, idx + anchor.quote.length + MAX_CONTEXT)
    const okPrefix = !anchor.prefix || before.endsWith(anchor.prefix)
    const okSuffix = !anchor.suffix || after.startsWith(anchor.suffix)
    if (okPrefix && okSuffix) {
      return idx
    }
  }
  // Fall back to first match
  return text.indexOf(anchor.quote)
}

function wrapTextRange(
  container: HTMLElement,
  startOffset: number,
  length: number,
  commentId: string,
): HTMLElement | null {
  const doc = container.ownerDocument
  const walker = doc.createTreeWalker(container, SHOW_TEXT)
  let consumed = 0
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const nodeLen = node.data.length
    if (consumed + nodeLen > startOffset) {
      const localStart = startOffset - consumed
      const localEnd = Math.min(nodeLen, localStart + length)
      const range = doc.createRange()
      range.setStart(node, localStart)
      range.setEnd(node, localEnd)
      const span = doc.createElement('span')
      span.className = 'doc-comment-anchor'
      span.dataset.commentId = commentId
      try {
        range.surroundContents(span)
        return span
      } catch {
        return null
      }
    }
    consumed += nodeLen
  }
  return null
}

export interface Anchorer {
  /** Anchor these comments now, replacing whatever was anchored before. */
  update: (comments: AnchoredComment[]) => void
  stop: () => void
}

/**
 * Keep comment anchors in the document beside `wrapper`, and report where they
 * landed.
 *
 * Anchors live in the rendered DOM, and that DOM is not finished when it first
 * paints: a fenced block renders as plain text and swaps in its highlighted
 * markup once the grammar has arrived, and a mermaid fence becomes a picture
 * the same way. An anchor injected into a block before its swap is thrown away
 * with the markup it was sitting in. So the anchors are re-injected whenever
 * the document changes underneath them -- the trigger is the mutation itself,
 * because no cheap signature of the result would do: `textContent` is the same
 * either side of a highlight swap, and wrapping a span does not change it
 * either.
 *
 * Injecting is itself a mutation of the watched subtree, so the observer is
 * stood down for the duration instead of having its records filtered.
 * `disconnect()` also empties the queue, so nothing done while injecting is
 * delivered late once it is watching again. That only holds while this is the
 * one observer on its document -- which is why it watches the document beside
 * its own overlay, and never a page-wide one.
 *
 * Returns null when there is no document beside `wrapper` to anchor into.
 */
export function anchorComments(
  wrapper: HTMLElement,
  onPositions: (positions: AnchorPosition[]) => void,
): Anchorer | null {
  const content = contentBeside(wrapper)
  const view = content?.ownerDocument.defaultView
  if (!content || !view) {
    return null
  }
  let comments: AnchoredComment[] = []

  const inject = () => {
    observer.disconnect()
    const positions: AnchorPosition[] = []
    try {
      unwrapAnchors(content)
      const fullText = content.textContent ?? ''
      for (const c of comments) {
        if (!c.anchor) {
          continue
        }
        const idx = findOccurrenceIndex(fullText, c.anchor)
        if (idx < 0) {
          continue
        }
        const span = wrapTextRange(content, idx, c.anchor.quote.length, c.id)
        if (!span) {
          continue
        }
        positions.push({ id: c.id, top: span.getBoundingClientRect().top - wrapper.getBoundingClientRect().top })
      }
    } finally {
      observer.observe(content, CONTENT_MUTATIONS)
    }
    positions.sort((a, b) => a.top - b.top)
    onPositions(positions)
  }

  const observer = new view.MutationObserver(inject)
  observer.observe(content, CONTENT_MUTATIONS)
  return {
    update: (next) => {
      comments = next
      inject()
    },
    stop: () => observer.disconnect(),
  }
}
