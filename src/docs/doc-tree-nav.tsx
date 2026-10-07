import { AppLink, legacy } from '@opencroft/client'

import { cn } from 'cn'
import { docAppPath } from './doc-routes'
import type { DocEntry } from './types'

const { icons, React, Button, ScrollArea } = legacy
const { useLayoutEffect, useRef } = React

interface TreeProps {
  entries: DocEntry[]
  selectedPath: string | null
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  onDelete: (path: string) => void
  /** Files with unpublished changes; shown with a pencil while the filter is on. */
  changedFiles: Set<string>
}

const INDICATOR_TRANSITION =
  'top 350ms cubic-bezier(0.22, 1, 0.36, 1), height 350ms cubic-bezier(0.22, 1, 0.36, 1), opacity 150ms'

function TreeLevel({ entries, depth, ...tree }: TreeProps & { depth: number }) {
  const { selectedPath, expandedPaths, onToggle, onDelete, changedFiles } = tree
  return (
    <ul className='m-0 list-none p-0'>
      {entries.map((entry) => {
        if (entry.type === 'directory') {
          const isExpanded = expandedPaths.has(entry.path)
          const hasChildren = entry.children && entry.children.length > 0
          return (
            <li key={entry.path}>
              <button
                type='button'
                onClick={() => hasChildren && onToggle(entry.path)}
                className='flex items-center gap-1 w-full text-left text-sm py-1.5 px-2 rounded-sm hover:bg-accent/50 transition-colors'
                style={{ paddingLeft: `${depth * 12 + 4}px` }}
              >
                {hasChildren && (
                  <icons.ChevronDown
                    className={cn(
                      'size-3.5 shrink-0 text-muted-foreground transition-transform',
                      !isExpanded && '-rotate-90',
                    )}
                  />
                )}
                {!hasChildren && <span className='w-3.5 shrink-0' />}
                <span className='truncate font-medium'>{entry.name}</span>
              </button>
              {isExpanded && hasChildren && <TreeLevel {...tree} entries={entry.children!} depth={depth + 1} />}
            </li>
          )
        }

        const isSelected = selectedPath === entry.path
        return (
          <li key={entry.path} className='group/file relative'>
            <AppLink
              to={docAppPath(entry.path)}
              data-sidebar-file={entry.path}
              aria-current={isSelected ? 'page' : undefined}
              className={cn(
                'flex items-center gap-1 w-full text-left text-sm py-1.5 px-2 pr-8 rounded-sm transition-colors',
                'hover:bg-accent/50 hover:text-foreground',
                isSelected ? 'text-foreground' : 'text-muted-foreground',
              )}
              style={{ paddingLeft: `${depth * 12 + 4}px` }}
            >
              <icons.FileText className='size-3.5 shrink-0 opacity-50' />
              <span className='truncate'>{entry.name.replace(/\.md$/, '')}</span>
              {entry.draft ? (
                <span className='ml-auto shrink-0 rounded border px-1 text-[10px] leading-4 text-muted-foreground'>
                  Draft
                </span>
              ) : changedFiles.has(entry.path) ? (
                <icons.Pencil className='ml-auto size-3 shrink-0 text-orange-500' />
              ) : null}
            </AppLink>
            <button
              type='button'
              onClick={(e: React.MouseEvent) => {
                e.preventDefault()
                e.stopPropagation()
                onDelete(entry.path)
              }}
              title='Delete'
              aria-label='Delete'
              className='absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center size-5 rounded-sm text-muted-foreground opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-opacity'
            >
              <icons.Trash2 className='size-3.5' />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The document tree, with the bar that slides beside the open page.
 *
 * The bar is positioned from the DOM rather than from state: where a row sits
 * is only known once it is laid out, and moving it must not re-render the tree.
 * The tree is shown inside the host's sidebar, out of this component's own DOM
 * parent, so the row is found through this component's refs and never by
 * querying the document.
 */
function DocTree(props: TreeProps) {
  const navRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  const { selectedPath, entries, expandedPaths } = props

  // Also when the tree or an open folder changes: rows above the selected one
  // move, and the bar has to follow them.
  useLayoutEffect(() => {
    const nav = navRef.current
    const indicator = indicatorRef.current
    if (!nav || !indicator) {
      return
    }
    const row =
      selectedPath === null
        ? undefined
        : Array.from(nav.querySelectorAll<HTMLElement>('[data-sidebar-file]')).find(
            (el) => el.dataset.sidebarFile === selectedPath,
          )
    if (!row) {
      indicator.style.opacity = '0'
      return
    }
    indicator.style.opacity = '1'
    indicator.style.top = `${row.getBoundingClientRect().top - nav.getBoundingClientRect().top}px`
    indicator.style.height = `${row.getBoundingClientRect().height}px`
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selectedPath, entries, expandedPaths])

  return (
    <div ref={navRef} className='relative py-1 pr-3'>
      <span
        ref={indicatorRef}
        className='absolute right-0 w-0.5 rounded-full bg-primary will-change-transform'
        style={{ top: 0, height: 0, opacity: 0, transition: INDICATOR_TRANSITION }}
      />
      <TreeLevel {...props} depth={0} />
    </div>
  )
}

/** The sidebar's content: a compact header with the filter, and the tree under it. */
export function DocTreePanel({
  unpublishedOnly,
  onToggleUnpublished,
  ...tree
}: TreeProps & {
  unpublishedOnly: boolean
  onToggleUnpublished: () => void
}) {
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
          <icons.Pencil className='size-3' />
        </Button>
      </div>
      <ScrollArea className='min-h-0 flex-1'>
        <DocTree {...tree} />
      </ScrollArea>
    </div>
  )
}
