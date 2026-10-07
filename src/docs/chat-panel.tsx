import { legacy } from '@opencroft/client'

const { React } = legacy

// Taken off the legacy object rather than as named imports: it spreads the
// whole host and ui surface, while the shims' named-export lists are
// hand-maintained and predate these symbols. Read defensively so a host
// without them renders the browser without the chat instead of failing.
//
// The chat's whole chrome -- launcher, docking, floating window, mobile
// cover -- is the host's ChatDock, the same surface the space canvas mounts.
// The browser contributes only what is its own: the selection bridge and
// which thread is its default.
const HostChatDock = legacy?.ChatDock
const SelectionProvider = legacy?.SelectionProvider
const useSelection = legacy?.useSelection

const chatDockSupported = Boolean(HostChatDock && SelectionProvider && useSelection)

// Long enough that dragging a highlight does not publish per-pixel, short
// enough that the badge follows the reader rather than lagging behind them.
const SELECTION_SETTLE_MS = 250

function fileLabel(file: string): string {
  return file.split('/').pop() || file
}

/**
 * The markdown lines a DOM node was rendered from.
 *
 * Every rendered element carries data-source-line/-end (see the rehype plugin
 * in docs-page). Walking UP to the nearest annotated ancestor is the lookup:
 * a selection usually anchors in a text node, and inline elements inherit the
 * position of the block that contains them.
 */
function sourceLinesOf(node: Node | null, container: HTMLElement | null): { start: number; end: number } | null {
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

/**
 * Publishes what the reader is looking at, and what they have highlighted.
 *
 * THE FILE IS THE CONTEXT; a highlight refines it. With nothing selected the
 * open document is still what a question is about, so it is published on its
 * own.
 *
 * `selectionchange` fires on every caret movement, and every publish writes the
 * scope and re-renders everything reading it — so republishing indiscriminately
 * spends that once per caret move on a highlight nobody has changed. Two guards:
 * settle briefly after the last event, and skip the write when the value has not
 * actually changed.
 */
function DocSelectionBridge({
  containerRef,
  namespace,
  file,
  source,
}: {
  containerRef: { current: HTMLDivElement | null }
  namespace: string
  file: string
  /** The open document's raw markdown, so a highlight is quoted from the file. */
  source: string
}) {
  const { setSelection } = useSelection()
  const lastRef = React.useRef('')

  // Opening a document makes it the context. Keyed on the file alone so it
  // fires when the reader moves to another document and at no other time --
  // re-running it on anything else would overwrite a highlight the reader made
  // in the document they are still in.
  React.useEffect(() => {
    if (!file) {
      return
    }
    const next = {
      label: fileLabel(file),
      content: [`Documentation: ${namespace}`, `File: ${file}`].join('\n'),
    }
    lastRef.current = `${next.label} ${next.content}`
    setSelection(next)
  }, [namespace, file, setSelection])

  // A highlight REPLACES the context. Losing one restores nothing.
  //
  // THE COLLAPSE IS NOT A CLEAR, and that distinction is the whole feature:
  // clicking into the composer to type the question collapses the document's
  // DOM selection, so treating a collapse as "nothing selected" would throw
  // away the very lines the reader highlighted in order to ask about them --
  // there is no way to reach the input with a selection still attached. Only a new
  // highlight replaces what is published, and nothing in this panel clears it:
  // moving to another document publishes that one instead, and leaving the
  // browser unmounts the scope and takes the highlight with it.
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const publish = () => {
      const selection = typeof window === 'undefined' ? null : window.getSelection()
      const text = selection ? selection.toString().trim() : ''
      const anchor = selection?.anchorNode ?? null
      // Only a highlight made INSIDE the document counts. Selecting text in the
      // chat's own transcript must not feed itself back as context.
      if (!text || !anchor || !containerRef.current?.contains(anchor)) {
        return
      }
      // Map the highlight back to the source. A selection spans two ends, and
      // either may sit in a deeper element than the other, so both are resolved
      // and the outer bounds taken.
      const from = sourceLinesOf(anchor, containerRef.current)
      const to = sourceLinesOf(selection?.focusNode ?? null, containerRef.current)
      const span =
        from || to
          ? {
              start: Math.min(from?.start ?? to!.start, to?.start ?? from!.start),
              end: Math.max(from?.end ?? to!.end, to?.end ?? from!.end),
            }
          : null

      // QUOTED FROM THE FILE, NOT FROM THE PAGE. The rendered text has lost the
      // markup it was written with -- emphasis, link targets, list markers, code
      // fences -- so quoting it back gives the agent something that is neither
      // the document's words nor findable in it. With a line span the source is
      // sliced verbatim; without one the rendered text is all there is.
      const quoted = span && source ? source.split('\n').slice(span.start - 1, span.end).join('\n') : ''
      const body = quoted || text
      const where = span
        ? span.start === span.end
          ? `Lines: ${span.start}`
          : `Lines: ${span.start}-${span.end}`
        : null
      const counted = span ? span.end - span.start + 1 : text.split('\n').length
      const next = {
        label: `${file ? fileLabel(file) : namespace}${span ? `:${span.start}` : ''} \u00b7 ${counted} line${counted === 1 ? '' : 's'}`,
        content: [
          `Documentation: ${namespace}`,
          `File: ${file || '(none)'}`,
          ...(where ? [where] : []),
          '',
          body,
        ].join('\n'),
      }
      const key = `${next.label} ${next.content}`
      if (key === lastRef.current) {
        return
      }
      lastRef.current = key
      setSelection(next)
    }

    const schedule = () => {
      if (timer) {
        clearTimeout(timer)
      }
      timer = setTimeout(publish, SELECTION_SETTLE_MS)
    }

    document.addEventListener('selectionchange', schedule)
    return () => {
      if (timer) {
        clearTimeout(timer)
      }
      document.removeEventListener('selectionchange', schedule)
    }
  }, [namespace, file, source, containerRef, setSelection])

  return null
}

interface ChatDockProps {
  /** The group chat to open, or null when there is nothing to scope to. */
  space: string | null
  threadId: string
  /** The documentation repository being browsed. */
  namespace: string
  /** The open file, '' when none. */
  file: string
  /** The open document's raw markdown. */
  source: string
  children: React.ReactNode
}

/**
 * The docs browser, with the host's shared chat surface around it.
 *
 * The whole surface is ONE selection scope: leaving the browser unmounts the
 * provider and the highlight goes with it. Falls back to rendering `children`
 * alone on a host without the chat, so this is safe to mount unconditionally
 * -- and without a repository open there is nothing to scope a conversation
 * to, so no chat is offered until one is.
 */
export function ChatDock({ space, threadId, namespace, file, source, children }: ChatDockProps) {
  const bodyRef = React.useRef<HTMLDivElement | null>(null)

  if (!chatDockSupported || !space) {
    return <>{children}</>
  }

  return (
    <SelectionProvider>
      <HostChatDock space={space} id={threadId} title={`Chat · ${space}`}>
        <DocSelectionBridge containerRef={bodyRef} namespace={namespace} file={file} source={source} />
        <div ref={bodyRef} className='min-h-0 min-w-0 flex-1 overflow-auto'>
          {children}
        </div>
      </HostChatDock>
    </SelectionProvider>
  )
}
