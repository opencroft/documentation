import { legacy } from '@opencroft/client'

const { React } = legacy
const { useLayoutEffect, useState } = React

/**
 * The width of the element `ref` is on, kept current; null until it is first
 * measured.
 *
 * Asked of the element rather than of the window because the window is not
 * what the App has: the host's sidebar and the chat dock each take width from
 * it, and the same window can leave the App room for a side panel or not.
 * Measured before the first paint, so a layout chosen by it is never seen
 * wrong.
 */
export function useElementWidth(ref: { current: HTMLElement | null }): number | null {
  const [width, setWidth] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) {
      return
    }
    setWidth(el.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[entries.length - 1].contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return width
}
