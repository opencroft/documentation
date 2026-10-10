import { AppActions, AppLink, AppTitle, useAppNavigate } from '@opencroft/client/app'
import { Button, buttonVariants, Input } from '@opencroft/client/ui'
import { Plus, Search, TableOfContents } from 'lucide-react'
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react'
import { useEffect, useState } from 'react'

import { type DocsRoute, searchAppPath } from './doc-routes'

/**
 * The title the bar shows for where the App is. A page has none: its path is
 * on the row above the page, beside Edit.
 */
export function titleOf(route: DocsRoute): string | null {
  switch (route.page) {
    case 'doc':
      return null
    case 'search':
      return 'Search'
    case 'home':
      return 'Documentation'
  }
}

/**
 * The search box the title bar has room for. It is a plain form: Enter opens
 * the results page, which is where searching happens.
 */
function TitleSearch({ route }: { route: DocsRoute }) {
  const navigate = useAppNavigate()
  const shown = route.page === 'search' ? route.query : ''
  const [value, setValue] = useState(shown)

  // On the results page the box shows the query the page is for; anywhere
  // else it starts empty.
  useEffect(() => {
    setValue(shown)
  }, [shown])

  return (
    <search>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          navigate(searchAppPath(value.trim()))
        }}
        className='relative w-64'
      >
        <Search className='pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground' />
        <Input
          type='text'
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === 'Escape') {
              setValue('')
            }
          }}
          placeholder='Search docs…'
          aria-label='Search docs'
          className='h-7 pl-7 text-xs'
        />
      </form>
    </search>
  )
}

/**
 * What the App puts in the host's title bar: the title of a page that is not
 * a document, search, a new document, and on a narrow App the way to the
 * page's outline.
 *
 * The bar narrows with the window, and `@3xl/title-bar:` is the bar's own width
 * (it is a container), so what fits is decided where the room is: the box
 * where it fits, and otherwise an icon that leads to the page the box would
 * have led to.
 */
export function DocsTitleBar({
  route,
  onNew,
  onOpenOutline,
}: {
  route: DocsRoute
  onNew: () => void
  /** Present only while the outline is not beside the page and there is a page to outline. */
  onOpenOutline: (() => void) | null
}) {
  const title = titleOf(route)
  return (
    <>
      {title ? <AppTitle>{title}</AppTitle> : null}
      <AppActions>
        <div className='hidden @3xl/title-bar:block'>
          <TitleSearch route={route} />
        </div>
        <span className='@3xl/title-bar:hidden'>
          <AppLink
            to='/search'
            aria-label='Search'
            title='Search'
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
          >
            <Search />
          </AppLink>
        </span>
        <Button variant='ghost' size='sm' onClick={onNew} aria-label='New document' title='New document'>
          <Plus />
          <span className='hidden @3xl/title-bar:inline'>New document</span>
        </Button>
        {onOpenOutline ? (
          <Button variant='ghost' size='icon' onClick={onOpenOutline} aria-label='On this page' title='On this page'>
            <TableOfContents />
          </Button>
        ) : null}
      </AppActions>
    </>
  )
}
