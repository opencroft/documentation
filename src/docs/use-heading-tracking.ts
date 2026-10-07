import { legacy } from '@opencroft/client'

const { React } = legacy
const { useCallback, useEffect, useRef } = React

const SCROLL_DURATION = 250
const SCROLL_OFFSET = 80
const VIEWPORT = '[data-slot="scroll-area-viewport"]'

const TOC_INDICATOR_TRANSITION =
  'top 350ms cubic-bezier(0.22, 1, 0.36, 1), height 350ms cubic-bezier(0.22, 1, 0.36, 1), opacity 150ms'

/** The heading with `id` among the rendered page's headings. */
function findHeading(root: HTMLElement | null, id: string): HTMLElement | null {
  const all = root?.querySelectorAll<HTMLElement>('.prose-docs [id]') ?? []
  return Array.from(all).find((el) => el.id === id) ?? null
}

/**
 * Show `activeId` in a table-of-contents list: its entry highlighted, and the
 * bar slid beside it. Every entry is reset first, so a list that has just
 * mounted (a sheet opening) needs no knowledge of what was highlighted before.
 */
function paintToc(list: HTMLElement, activeId: string | null, smooth: boolean) {
  for (const link of Array.from(list.querySelectorAll<HTMLElement>('[data-toc-id]'))) {
    const active = link.dataset.tocId === activeId
    link.classList.toggle('text-foreground', active)
    link.classList.toggle('text-muted-foreground', !active)
  }
  const indicator = list.querySelector<HTMLElement>('[data-toc-indicator]')
  if (!indicator) {
    return
  }
  const link = Array.from(list.querySelectorAll<HTMLElement>('[data-toc-id]')).find((l) => l.dataset.tocId === activeId)
  if (!link) {
    indicator.style.opacity = '0'
    return
  }
  // A list that has only just mounted has nothing to slide from.
  indicator.style.transition = smooth ? TOC_INDICATOR_TRANSITION : 'none'
  indicator.style.opacity = '1'
  indicator.style.top = `${link.getBoundingClientRect().top - list.getBoundingClientRect().top}px`
  indicator.style.height = `${link.getBoundingClientRect().height}px`
  link.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'nearest' })
}

/**
 * Which heading of the open page the reader is at, and getting to a heading.
 *
 * The page is mounted once, so everything is looked up from `contentRef` (the
 * content column) and never from `document`; the table of contents may be in a
 * sheet portalled out of the App's own DOM, which is why it announces itself
 * through `registerToc` rather than being found.
 *
 * The highlight is written to the DOM rather than kept in state: it changes on
 * every few pixels of scrolling, and a re-render of the page for each would
 * re-render its markdown with it.
 */
export function useHeadingTracking({
  contentRef,
  renderedHtml,
  selectedPath,
  heading,
}: {
  contentRef: { current: HTMLElement | null }
  /** The HTML the open page rendered; empty until it has. */
  renderedHtml: string
  selectedPath: string | null
  /** The heading the App's address names. */
  heading: string | null
}) {
  const activeRef = useRef<string | null>(null)
  const tocListRef = useRef<HTMLElement | null>(null)
  const headingsRef = useRef<HTMLElement[]>([])
  const scrollingFromClickRef = useRef(false)

  const setActive = useCallback((next: string | null) => {
    if (next === activeRef.current) {
      return
    }
    activeRef.current = next
    if (tocListRef.current) {
      paintToc(tocListRef.current, next, true)
    }
  }, [])

  // The table of contents tells us where its list is when it mounts, and shows
  // the heading the reader is at from its first paint.
  const registerToc = useCallback((list: HTMLElement | null) => {
    tocListRef.current = list
    if (list) {
      paintToc(list, activeRef.current, false)
    }
  }, [])

  // ── Cache heading elements when content renders ───────────────────────────
  useEffect(() => {
    if (!renderedHtml) {
      headingsRef.current = []
      activeRef.current = null
      return
    }
    headingsRef.current = Array.from(
      contentRef.current?.querySelectorAll<HTMLElement>('.prose-docs h2, .prose-docs h3') ?? [],
    )
    activeRef.current = null
    setActive(headingsRef.current[0]?.id ?? null)
  }, [renderedHtml, contentRef, setActive])

  // ── Scroll-based tracking ─────────────────────────────────────────────────
  useEffect(() => {
    if (!renderedHtml) {
      return
    }
    const viewport = contentRef.current?.closest<HTMLElement>(VIEWPORT)
    if (!viewport) {
      return
    }

    const update = () => {
      if (scrollingFromClickRef.current) {
        return
      }
      const headings = headingsRef.current
      if (headings.length === 0) {
        return
      }

      // The last heading that scrolled past the offset.
      let active: string | null = null
      for (const h of headings) {
        if (h.getBoundingClientRect().top - SCROLL_OFFSET <= 0) {
          active = h.id
        } else {
          break
        }
      }
      // At the top with none past the offset, the first heading is the place.
      if (active === null && viewport.scrollTop < 10) {
        active = headings[0].id
      }
      setActive(active)
    }

    const onScroll = () => requestAnimationFrame(update)
    viewport.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => viewport.removeEventListener('scroll', onScroll)
  }, [renderedHtml, contentRef, setActive])

  // ── Smooth scroll to a heading, with animation ────────────────────────────
  const scrollToHeading = useCallback(
    (id: string) => {
      scrollingFromClickRef.current = true
      setActive(id)

      const viewport = contentRef.current?.closest<HTMLElement>(VIEWPORT)
      const el = findHeading(contentRef.current, id)
      if (!viewport || !el) {
        scrollingFromClickRef.current = false
        return
      }

      const start = viewport.scrollTop
      const target = start + el.getBoundingClientRect().top - viewport.getBoundingClientRect().top - SCROLL_OFFSET
      const distance = target - start
      if (distance === 0) {
        scrollingFromClickRef.current = false
        return
      }

      let startTime: number | null = null
      const animate = (timestamp: number) => {
        if (!startTime) {
          startTime = timestamp
        }
        const progress = Math.min((timestamp - startTime) / SCROLL_DURATION, 1)
        const eased = 1 - (1 - progress) ** 5 // ease-out quint
        viewport.scrollTop = start + distance * eased
        if (progress < 1) {
          requestAnimationFrame(animate)
        } else {
          scrollingFromClickRef.current = false
        }
      }
      requestAnimationFrame(animate)
    },
    [contentRef, setActive],
  )

  // ── Scroll to the heading the address names, once its page has rendered ──
  // Once per page and heading: the same page rendering again (a publish, a
  // version from its history) leaves the reader where they are.
  const scrolledToRef = useRef<string | null>(null)
  useEffect(() => {
    scrolledToRef.current = null
  }, [selectedPath])
  useEffect(() => {
    if (heading && renderedHtml && heading !== scrolledToRef.current) {
      scrolledToRef.current = heading
      scrollToHeading(heading)
    }
  }, [heading, renderedHtml, scrollToHeading])

  // A link to the heading already addressed leaves the address as it is, so
  // the effect above does not run; the click scrolls back to it instead.
  const handleHeadingClick = useCallback(
    (id: string) => {
      if (id === heading) {
        scrollToHeading(id)
      }
    },
    [heading, scrollToHeading],
  )

  return { registerToc, handleHeadingClick }
}
