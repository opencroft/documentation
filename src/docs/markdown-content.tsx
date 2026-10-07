import { AppLink, CodeBlock, legacy, markdownDirectiveBlocks, MermaidDiagram } from '@opencroft/client'
import type { ComponentProps } from 'react'
import type { ExtraProps } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { docLinkTo } from './doc-routes'
import { rehypeHeadingIds } from './heading-ids'
import type { TocItem } from './types'

const { React } = legacy
const { useCallback } = React

/**
 * Stamp every rendered element with the markdown lines it came from.
 *
 * remark keeps each node's source position, and rehype carries it through to
 * the elements react-markdown renders — so the mapping already exists and only
 * has to be written where the DOM can be asked for it. Without this a reader's
 * highlight can only be reported as rendered text: `**bold**` has become
 * `bold`, a link has lost its target, and a list marker is gone entirely, so
 * quoting it back is neither the document's words nor findable in the file.
 *
 * Written as data attributes rather than kept in a side table because the
 * question is asked FROM a DOM node — walking up to the nearest annotated
 * ancestor is the whole lookup.
 */
function rehypeSourceLines() {
  return (tree: any) => {
    const walk = (node: any) => {
      const start = node?.position?.start?.line
      if (node?.type === 'element' && start) {
        node.properties = node.properties ?? {}
        // hast camelCase -> data-source-line on the rendered element.
        node.properties.dataSourceLine = String(start)
        node.properties.dataSourceLineEnd = String(node.position.end?.line ?? start)
      }
      for (const child of node?.children ?? []) {
        walk(child)
      }
    }
    walk(tree)
  }
}

/** The page's h2/h3 headings, read back from the HTML it rendered. */
export function extractToc(html: string): TocItem[] {
  const items: TocItem[] = []
  const re = /<h([2-3])[^>]*id="([^"]*)"[^>]*>(.*?)<\/h\1>/g
  let m
  while ((m = re.exec(html)) !== null) {
    items.push({ id: m[2], text: m[3].replace(/<[^>]+>/g, ''), level: +m[1] })
  }
  return items
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
 * Anything that is not exactly one `code` element of plain text — a `pre` a
 * plugin built, a fence something else has already decorated — is not ours to
 * claim, and the caller renders it as it always did.
 */
function fencedCode(node: ExtraProps['node']): { code: string; language?: string } | null {
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
  // Markdown always ends a fence's content with a newline. Keeping it would add
  // an empty last line to every block, and put one on the clipboard too.
  return { code: text.replace(/\n$/, ''), language }
}

/**
 * A fenced block, drawn by the components the host shares with every extension:
 * a `mermaid` fence as the picture somebody wrote in text, everything else as
 * highlighted code with a copy control. Both come from `@opencroft/client` so
 * that shiki and mermaid stay one copy on the page.
 *
 * The replacement is WRAPPED, and the wrapper carries the source lines by hand.
 * rehypeSourceLines (above) stamps every element with
 * `dataSourceLine`/`dataSourceLineEnd`, which reach this override as the DOM
 * attribute names `data-source-line`/`data-source-line-end` — and `CodeBlock`
 * and `MermaidDiagram` take `code`/`chart` and a className, so an attribute
 * that is not theirs has nowhere to go and would simply be dropped. Dropping it
 * would take a fenced block out of the document's line map: chat-panel's
 * `sourceLinesOf` walks UP from the selection to the nearest annotated
 * ancestor, and with none inside the block the answer would come from whatever
 * encloses it, or be nothing at all. So the values are read back off the hast
 * node — pairing this code with the plugin ten lines up rather than with a
 * prop-naming convention in between — and put on an element that ENCLOSES the
 * rendered block, which is where that walk can find them.
 *
 * On the box around it: `CodeBlock` draws its own frame, with the fence's
 * language over the code, and takes the prose's code-block spacing; the
 * code inside keeps a long line scrolling sideways instead of wrapping, which
 * keeps the indentation the reader is following. The editor draws its code
 * blocks in the same frame, so no rule is added here.
 *
 * The wrapper passes the block's margins through (`overflow-visible`). The
 * docs prose lets each top-level element scroll sideways on its own, and a box
 * that scrolls keeps its children's margins inside it — this wrapper would then
 * add the code block's margins to the gaps around it, where the editor, which
 * has no wrapper, lets them meet the neighbours' margins. The prose sits in a
 * layer below utilities, so the utility wins without `!important`; the `pre`
 * inside still scrolls on its own.
 *
 * Known and left alone: `.prose-docs > *:first-child { margin-top: 0 }`
 * lands on this wrapper rather than on the code block inside it, so a
 * document that opens with a fence gains the prose's top margin — about half
 * a line. Worth less than reaching into a host stylesheet this extension does
 * not own.
 */
function MarkdownPre({ node, children, ...props }: ComponentProps<'pre'> & ExtraProps) {
  const fence = fencedCode(node)
  if (!fence) {
    return <pre {...props}>{children}</pre>
  }
  return (
    <div
      className='overflow-visible'
      data-source-line={node?.properties?.dataSourceLine}
      data-source-line-end={node?.properties?.dataSourceLineEnd}
    >
      {fence.language === 'mermaid' ? (
        <MermaidDiagram chart={fence.code} />
      ) : (
        <CodeBlock code={fence.code} language={fence.language} />
      )}
    </div>
  )
}

interface DocMarkdownProps {
  content: string
  currentPath: string | null
  /** A link to a heading of this page was clicked. */
  onHeadingClick: (id: string) => void
  /**
   * Stamp the source lines and the heading ids: what the outline, the comments
   * and the chat's quoting find their places on the page by. Only for the page
   * itself -- a copy drawn a block at a time would number its lines from each
   * block and repeat the page's heading ids.
   */
  anchors: boolean
}

/**
 * Markdown drawn as this app draws its pages, without the prose around it: for
 * the page, and for a view that sets the page's blocks in prose of its own.
 */
export function DocMarkdown({ content, currentPath, onHeadingClick, anchors }: DocMarkdownProps) {
  return (
    <ReactMarkdown
      // The host's documentation blocks -- callouts, spoilers, tabs -- so a
      // page shows what the host's editor writes, drawn exactly as the host
      // draws them everywhere else. This page keeps its own renderer for the
      // source-line stamping below.
      //
      // Optional because this extension and the host deploy separately: on a
      // host that does not offer the blocks yet, pages render as they did
      // before rather than failing.
      remarkPlugins={[remarkGfm, ...(markdownDirectiveBlocks?.remarkPlugins ?? [])]}
      rehypePlugins={anchors ? [rehypeSourceLines, rehypeHeadingIds] : []}
      components={{
        ...markdownDirectiveBlocks?.components,
        pre: MarkdownPre,
        a: ({ href, children, ...rest }: any) => {
          if (href && /^https?:/i.test(href)) {
            return (
              <a href={href} target='_blank' rel='noopener noreferrer' {...rest}>
                {children}
              </a>
            )
          }
          const to = href && !/^mailto:/i.test(href) ? docLinkTo(currentPath, href) : null
          if (to === null) {
            return (
              <a href={href} {...rest}>
                {children}
              </a>
            )
          }
          // A heading of this page is a place on it, not another page: it
          // rewrites the entry rather than adding one to walk back through.
          const ownHeading = href.startsWith('#') ? href.slice(1) : null
          return (
            <AppLink
              {...rest}
              to={to}
              replace={ownHeading !== null}
              onClick={ownHeading === null ? undefined : () => onHeadingClick(ownHeading)}
            >
              {children}
            </AppLink>
          )
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

export function MarkdownContent({
  content,
  currentPath,
  onHeadingClick,
  onRendered,
}: {
  content: string
  currentPath: string | null
  /** A link to a heading of this page was clicked. */
  onHeadingClick: (id: string) => void
  onRendered: (html: string) => void
}) {
  const ref = useCallback(
    (n: HTMLDivElement | null) => {
      if (n) {
        onRendered(n.innerHTML)
      }
    },
    [content],
  )
  return (
    <div className='prose-docs' ref={ref}>
      <DocMarkdown content={content} currentPath={currentPath} onHeadingClick={onHeadingClick} anchors />
    </div>
  )
}
