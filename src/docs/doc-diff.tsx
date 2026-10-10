import { MarkdownDiffView } from '@opencroft/client/markdown'
import { useCallback } from 'react'

import { DocMarkdown } from './markdown-content'

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
  return <MarkdownDiffView before={before} after={after} renderBlock={renderBlock} proseClassName='prose-docs' />
}
