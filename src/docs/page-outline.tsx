import { AppLink } from '@opencroft/client/app'
import { cn } from 'cn'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'

import { type PanelTab, PanelTabStrip } from '@/components/ui/layouts/panel-tab-strip'
import { headingQuery } from './doc-routes'
import type { LogEntry, TocItem } from './types'

export type OutlineTab = 'toc' | 'history'

const OUTLINE_TABS: PanelTab[] = [
  { id: 'toc', label: 'On this page' },
  { id: 'history', label: 'History' },
]

/**
 * Both tabs say "nothing here" through this one element, so the two messages
 * sit at the same place in the panel and read in the same voice.
 */
function OutlineEmpty({ children }: { children: ReactNode }) {
  return <p className='text-xs text-muted-foreground'>{children}</p>
}

const INDICATOR_TRANSITION =
  'top 350ms cubic-bezier(0.22, 1, 0.36, 1), height 350ms cubic-bezier(0.22, 1, 0.36, 1), opacity 150ms'

/**
 * The page's headings, h3s nested under their h2. Which one is highlighted is
 * not decided here: the tracking hook paints it into the list it is handed
 * through `listRef`, including when this list mounts after the reader has
 * already scrolled.
 */
function TocList({
  items,
  listRef,
  onHeadingClick,
}: {
  items: TocItem[]
  listRef: (list: HTMLUListElement | null) => void
  onHeadingClick: (id: string) => void
}) {
  const groups: { h2: TocItem; children: TocItem[] }[] = []
  let current: { h2: TocItem; children: TocItem[] } | null = null

  for (const item of items) {
    if (item.level === 2) {
      current = { h2: item, children: [] }
      groups.push(current)
    } else if (current) {
      current.children.push(item)
    }
  }

  return (
    <ul ref={listRef} className='m-0 list-none pl-4 relative'>
      <span
        data-toc-indicator
        className='absolute left-0 w-0.5 bg-primary rounded-full will-change-transform'
        style={{ top: 0, height: 0, opacity: 0, transition: INDICATOR_TRANSITION }}
      />
      {groups.map(({ h2, children }) => (
        <li key={h2.id} className='mb-1'>
          <AppLink
            to={headingQuery(h2.id)}
            replace
            onClick={() => onHeadingClick(h2.id)}
            data-toc-id={h2.id}
            className='block text-xs leading-relaxed py-0.5 -ml-4 pl-4 text-muted-foreground hover:text-foreground transition-colors'
          >
            {h2.text}
          </AppLink>
          {children.length > 0 && (
            <ul className='m-0 list-none'>
              {children.map((h3) => (
                <li key={h3.id}>
                  <AppLink
                    to={headingQuery(h3.id)}
                    replace
                    onClick={() => onHeadingClick(h3.id)}
                    data-toc-id={h3.id}
                    className='block text-xs leading-relaxed py-0.5 -ml-4 pl-8 text-muted-foreground hover:text-foreground transition-colors'
                  >
                    {h3.text}
                  </AppLink>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}

function HistoryList({
  log,
  viewingRef,
  onViewRef,
  onBackToCurrent,
}: {
  log: LogEntry[]
  viewingRef: string | null
  onViewRef: (sha: string) => void
  onBackToCurrent: () => void
}) {
  return (
    <>
      {viewingRef && (
        <button
          type='button'
          onClick={onBackToCurrent}
          className='flex items-center gap-1 text-xs text-primary hover:underline mb-2'
        >
          <ArrowLeft className='size-3' /> Back to current
        </button>
      )}
      {log.length === 0 ? (
        <OutlineEmpty>No history</OutlineEmpty>
      ) : (
        <ul className='m-0 list-none space-y-1 p-0'>
          {log.map((entry) => (
            <li key={entry.sha}>
              <button
                type='button'
                onClick={() => onViewRef(entry.sha)}
                className={cn(
                  'w-full text-left px-2 py-1.5 -mx-2 rounded-md text-xs transition-colors',
                  'hover:bg-accent/50',
                  viewingRef === entry.sha && 'bg-accent',
                )}
              >
                <p className='font-medium truncate'>{entry.message}</p>
                <p className='text-muted-foreground text-[10px]'>
                  {entry.author} · {new Date(entry.date).toLocaleDateString()}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export interface PageOutlineProps {
  tab: OutlineTab
  onTabChange: (tab: OutlineTab) => void
  tocItems: TocItem[]
  /** The table of contents' list, for the tracking hook to highlight in. */
  registerToc: (list: HTMLUListElement | null) => void
  onHeadingClick: (id: string) => void
  fileLog: LogEntry[]
  viewingRef: string | null
  onViewRef: (sha: string) => void
  onBackToCurrent: () => void
  /** Called after an entry has been chosen, for a surface that should get out of the way. */
  onChosen?: () => void
}

/**
 * "On this page" and "History" for the open document. The same panel sits in
 * the inline aside on a wide App and in the sheet on a narrow one; it is
 * mounted in only one of them at a time.
 */
export function PageOutline({
  tab,
  onTabChange,
  tocItems,
  registerToc,
  onHeadingClick,
  fileLog,
  viewingRef,
  onViewRef,
  onBackToCurrent,
  onChosen,
}: PageOutlineProps) {
  return (
    <div className='flex flex-col'>
      <div className='sticky top-0 z-10 bg-background'>
        <PanelTabStrip
          tabs={OUTLINE_TABS}
          activeId={tab}
          onSelect={(id) => onTabChange(id === 'history' ? 'history' : 'toc')}
        />
      </div>
      <div className='px-4 py-2'>
        {tab === 'toc' ? (
          tocItems.length > 0 ? (
            <TocList
              items={tocItems}
              listRef={registerToc}
              onHeadingClick={(id) => {
                onHeadingClick(id)
                onChosen?.()
              }}
            />
          ) : (
            <OutlineEmpty>No headings</OutlineEmpty>
          )
        ) : (
          <HistoryList
            log={fileLog}
            viewingRef={viewingRef}
            onViewRef={(sha) => {
              onViewRef(sha)
              onChosen?.()
            }}
            onBackToCurrent={onBackToCurrent}
          />
        )}
      </div>
    </div>
  )
}
