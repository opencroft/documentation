import { Fragment, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from 'cn'

export interface FolderSegment {
  className: string
  children: ReactNode
}

export interface DocPageBarProps {
  /** The page's path in the documentation, folders first: `guides/setup/install.md`. */
  path: string
  /** The link for a folder that has a page of its own, given the folder's path
   *  (`guides/setup`) and the segment's `className` and name to render inside
   *  it. `null`, or no function at all, leaves the folder as plain text. */
  renderFolderLink?: (folder: string, segment: FolderSegment) => ReactNode
  /** The page's actions, at the end of the row. */
  children?: ReactNode
  className?: string
}

// When the row is too narrow for the whole path, the folders give up their room
// first, down to an ellipsis each, so the page's own name is the last to be cut.
const FOLDER = 'min-w-5 shrink-[100] truncate'

const FOLDER_LINK = cn(
  FOLDER,
  'rounded-sm outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50',
)

export function DocPageBar({ path, renderFolderLink, children, className }: DocPageBarProps) {
  const parts = path.split('/').filter(Boolean)
  const folders = parts.slice(0, -1)
  const page = (parts.at(-1) ?? path).replace(/\.md$/, '')

  // The row is a small button's height with or without actions, so the page
  // under it starts at the same place on every view.
  return (
    <div data-slot='doc-page-bar' className={cn('flex min-h-8 items-center gap-2', className)}>
      <nav
        aria-label='Page path'
        title={[...folders, page].join(' / ')}
        className='flex min-w-0 flex-1 items-center gap-1 text-sm text-muted-foreground'
      >
        {folders.map((name, index) => {
          const folder = folders.slice(0, index + 1).join('/')
          const link = renderFolderLink?.(folder, { className: FOLDER_LINK, children: name })
          return (
            <Fragment key={folder}>
              {link ?? <span className={FOLDER}>{name}</span>}
              <ChevronRight aria-hidden className='size-3.5 shrink-0' />
            </Fragment>
          )
        })}
        <span aria-current='page' className='min-w-0 truncate text-foreground'>
          {page}
        </span>
      </nav>
      {children ? <div className='flex shrink-0 items-center gap-2'>{children}</div> : null}
    </div>
  )
}
