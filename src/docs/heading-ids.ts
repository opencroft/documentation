// A heading's id is its address on the page: the `heading` query, the table
// of contents and `#…` links inside docs all name it. Ids are given over the
// whole document at once, so two headings with the same text still get two
// ids, and the same document always gets the same ones.

import { slugify } from './slug.ts'

interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

const HEADING = /^h[1-6]$/

/** When a heading's text leaves nothing to spell an id with, e.g. only punctuation. */
const FALLBACK_SLUG = 'section'

/** A heading's text as an id: its slug, or a fixed one when the text has none. */
export function headingSlug(text: string): string {
  return slugify(text) || FALLBACK_SLUG
}

function textOf(node: HastNode): string {
  return node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(textOf).join('')
}

/**
 * Rehype plugin: gives every heading an `id` from its text. A text that is
 * already taken gets the first free `-1`, `-2`, … suffix, in document order.
 */
export function rehypeHeadingIds() {
  return (tree: HastNode) => {
    const taken = new Set<string>()
    const visit = (node: HastNode) => {
      if (node.type === 'element' && node.tagName && HEADING.test(node.tagName)) {
        const slug = headingSlug(textOf(node))
        let id = slug
        for (let n = 1; taken.has(id); n++) {
          id = `${slug}-${n}`
        }
        taken.add(id)
        node.properties = { ...node.properties, id }
      }
      for (const child of node.children ?? []) {
        visit(child)
      }
    }
    visit(tree)
  }
}
