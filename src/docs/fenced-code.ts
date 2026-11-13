// A fenced block as the page draws it, read from the markdown tree. Kept free
// of host imports so the rule can be tested without the host.

import type { Element } from 'hast'

export interface FencedCode {
  /** The code, without the newline markdown ends every fence with. */
  code: string
  /** The fence's language: the first word of its info string. */
  language?: string
  /**
   * The whole info string (`ts title="app.ts"`), which is what `CodeBlock`
   * takes: its first word labels and colours the block, and a `title=` or
   * `filename=` after it names the file the block downloads as.
   */
  info?: string
}

/**
 * The code inside a fenced block, read from the markdown tree rather than from
 * the rendered children.
 *
 * `pre` is overridden rather than `code` because `code` is also every inline
 * span, and a fence with no language is indistinguishable from inline code by
 * its props alone. The tree says plainly which is which, and it carries the
 * text unescaped, which is what a code block and a copy button both need.
 *
 * The info string arrives in two parts: its first word as the `language-*`
 * class, and the rest as `data.meta` on the `code` element, which no prop
 * carries.
 *
 * Anything that is not exactly one `code` element of plain text — a `pre` a
 * plugin built, a fence something else has already decorated — is not ours to
 * claim, and the caller renders it as it always did.
 */
export function fencedCode(node: Element | undefined): FencedCode | null {
  const only = node?.children?.length === 1 ? node.children[0] : undefined
  if (only?.type !== 'element' || only.tagName !== 'code') {
    return null
  }
  let text = ''
  for (const part of only.children) {
    if (part.type !== 'text') {
      return null
    }
    text += part.value
  }
  const classes = only.properties?.className
  const language = Array.isArray(classes)
    ? classes
        .map(String)
        .find((name) => name.startsWith('language-'))
        ?.slice('language-'.length)
    : undefined
  const meta = (only.data as { meta?: string | null } | undefined)?.meta?.trim()
  // Markdown always ends a fence's content with a newline. Keeping it would add
  // an empty last line to every block, and put one on the clipboard too.
  return { code: text.replace(/\n$/, ''), language, info: meta ? `${language ?? ''} ${meta}` : language }
}
