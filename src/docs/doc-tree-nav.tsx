import { AppLink } from '@opencroft/client/app'
import { Button, ScrollArea } from '@opencroft/client/ui'
import { cn } from 'cn'
import { Pencil } from 'lucide-react'
import { useMemo } from 'react'

import { DocTree, type DocTreeDrop, type DocTreeNode } from '@/components/ui/documentation/doc-tree'
import { docAppPath } from './doc-routes'
import type { DocEntry } from './types'

interface TreeProps {
  entries: DocEntry[]
  selectedPath: string | null
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  /** Files with unpublished changes; shown with a pencil while the filter is on. */
  changedFiles: Set<string>
  onRename: (entry: DocEntry) => void
  onMove: (entry: DocEntry) => void
  onDelete: (path: string) => void
  onDrop: (drop: DocTreeDrop) => void
}

/** The tree's entries as the kit tree draws them; `byPath` collects each entry by its path. */
function nodesOf(entries: DocEntry[], changedFiles: Set<string>, byPath: Map<string, DocEntry>): DocTreeNode[] {
  return entries.map((entry) => {
    byPath.set(entry.path, entry)
    return {
      path: entry.path,
      title: entry.title,
      type: entry.type,
      draft: entry.draft,
      changed: entry.type === 'file' && changedFiles.has(entry.path),
      children: entry.children ? nodesOf(entry.children, changedFiles, byPath) : undefined,
    }
  })
}

/** The sidebar's content: a compact header with the filter, and the tree under it. */
export function DocTreePanel({
  unpublishedOnly,
  onToggleUnpublished,
  entries,
  changedFiles,
  selectedPath,
  expandedPaths,
  onToggle,
  onRename,
  onMove,
  onDelete,
  onDrop,
}: TreeProps & {
  unpublishedOnly: boolean
  onToggleUnpublished: () => void
}) {
  const { nodes, byPath } = useMemo(() => {
    const index = new Map<string, DocEntry>()
    return { nodes: nodesOf(entries, changedFiles, index), byPath: index }
  }, [entries, changedFiles])
  const withEntry = (act: (entry: DocEntry) => void) => (node: DocTreeNode) => {
    const entry = byPath.get(node.path)
    if (entry) {
      act(entry)
    }
  }
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex shrink-0 items-center gap-1 px-4 py-2'>
        <span className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Documentation</span>
        <Button
          size='icon-xs'
          variant={unpublishedOnly ? 'default' : 'ghost'}
          onClick={onToggleUnpublished}
          title='Show unpublished changes only'
          aria-label='Toggle unpublished changes'
          aria-pressed={unpublishedOnly}
          className={cn('ml-auto', !unpublishedOnly && 'text-muted-foreground')}
        >
          <Pencil className='size-3' />
        </Button>
      </div>
      <ScrollArea className='min-h-0 flex-1'>
        <DocTree
          nodes={nodes}
          selectedPath={selectedPath}
          expanded={expandedPaths}
          onToggle={onToggle}
          renderPageLink={(node, link) => <AppLink to={docAppPath(node.path)} {...link} />}
          onRename={withEntry(onRename)}
          onMove={withEntry(onMove)}
          onDelete={(node) => onDelete(node.path)}
          // A filtered tree hides the entries a position counts, so it is not rearranged by dragging.
          onDrop={unpublishedOnly ? undefined : onDrop}
        />
      </ScrollArea>
    </div>
  )
}
