import { legacy, MarkdownDiffView } from '@opencroft/client'

import { DocMarkdown } from './markdown-content'

const { React } = legacy
const { useCallback } = React

interface DocDiffProps {
  /** The earlier version; empty for a page that did not exist. */
  before: string
  after: string
  currentPath: string | null
  onHeadingClick: (id: string) => void
}

/**
 * The changes from one version of a page to another, on the page as this app
 * draws it: the host's diff view, with every block drawn by the page's own
 * renderer.
 */
export function DocDiff({ before, after, currentPath, onHeadingClick }: DocDiffProps) {
  const renderBlock = useCallback(
    (markdown: string) => (
      <DocMarkdown content={markdown} currentPath={currentPath} onHeadingClick={onHeadingClick} anchors={false} />
    ),
    [currentPath, onHeadingClick],
  )
  // This extension and the host deploy separately. A host that does not offer
  // the diff view yet shows the later version as it is, rather than failing.
  if (MarkdownDiffView === undefined) {
    return <div className='prose-docs'>{renderBlock(after)}</div>
  }
  return <MarkdownDiffView before={before} after={after} renderBlock={renderBlock} proseClassName='prose-docs' />
}
