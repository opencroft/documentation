import { invoke } from '@opencroft/client/actions'
import { AppLink, useAppNavigate } from '@opencroft/client/app'
import { Input } from '@opencroft/client/ui'
import { Search } from 'lucide-react'
import type { ChangeEvent, FormEvent } from 'react'
import { Fragment, useEffect, useState } from 'react'

import { LogoLoader } from '@/components/ui/logo-loader'
import { docAppPath, searchAppPath } from './doc-routes'
import { headingSlug } from './heading-ids'
import { highlightSegments } from './search-highlight'
import type { DocSearchAnswer, DocSearchMatch } from './types'

function Highlighted({ match }: { match: DocSearchMatch }) {
  return (
    <>
      {highlightSegments(match.text, match.ranges).map((segment) =>
        // Only position tells the runs apart: each is keyed by where it starts.
        segment.match ? (
          <mark key={segment.start} className='rounded-sm bg-primary/20 px-0.5 text-foreground'>
            {segment.text}
          </mark>
        ) : (
          <Fragment key={segment.start}>{segment.text}</Fragment>
        ),
      )}
    </>
  )
}

/** What `docs.search` answered for one query; null until it has. */
function useSearchResults(namespace: string, query: string) {
  const [found, setFound] = useState<{ query: string; answer: DocSearchAnswer | null } | null>(null)

  useEffect(() => {
    if (!query) {
      setFound(null)
      return
    }
    let cancelled = false
    // A search that fails is shown like one that matched nothing; the reader
    // can search again from the same box.
    invoke<DocSearchAnswer>('docs.search', { namespace, query })
      .catch(() => null)
      .then((answer) => {
        if (!cancelled) {
          setFound({ query, answer })
        }
      })
    return () => {
      cancelled = true
    }
  }, [namespace, query])

  // Results of the previous query are never shown for this one.
  return found?.query === query ? found : null
}

/**
 * Search results as a page of their own, laid out the way a search engine does:
 * the query on top, then each page with where it lives and the lines that
 * matched, each one a link to the place it is on.
 */
export function SearchPage({ namespace, query: rawQuery }: { namespace: string; query: string }) {
  const navigate = useAppNavigate()
  const query = rawQuery.trim()
  const [value, setValue] = useState(rawQuery)
  const found = useSearchResults(namespace, query)

  // The address is the source of truth: Back, or a link to another query,
  // changes what the box shows.
  useEffect(() => {
    setValue(rawQuery)
  }, [rawQuery])

  return (
    <div className='flex flex-col gap-6'>
      <search>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            navigate(searchAppPath(value.trim()))
          }}
          className='relative'
        >
          <Search className='pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground' />
          <Input
            autoFocus={!query}
            type='search'
            value={value}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
            placeholder='Search docs…'
            aria-label='Search docs'
            className='h-12 pl-12 text-base md:text-base'
          />
        </form>
      </search>

      {!query ? (
        <p className='text-sm text-muted-foreground'>Type a few words, in any order, to search every page.</p>
      ) : found === null ? (
        <div className='flex justify-center py-16'>
          <LogoLoader size={40} aria-label='Searching' />
        </div>
      ) : !found.answer || found.answer.results.length === 0 ? (
        <p className='text-sm text-muted-foreground'>No results for “{query}”</p>
      ) : (
        <>
          <p className='text-sm text-muted-foreground'>
            {found.answer.complete
              ? `${found.answer.total === 1 ? '1 page matches' : `${found.answer.total} pages match`} “${query}”`
              : `No page has every word of “${query}”. The closest:`}
          </p>
          <ul className='m-0 flex list-none flex-col gap-6 p-0'>
            {found.answer.results.map((r) => (
              <li key={r.path} className='min-w-0'>
                <AppLink to={docAppPath(r.path)} className='text-base font-medium hover:underline'>
                  {r.title ?? r.path.replace(/\.md$/, '')}
                </AppLink>
                <p className='mt-0.5 truncate text-xs text-muted-foreground'>
                  {r.path}
                  {r.missing.length > 0 ? ` · Missing: ${r.missing.join(', ')}` : null}
                </p>
                <ul className='m-0 mt-2 flex list-none flex-col gap-1.5 p-0'>
                  {r.matches.map((m) => (
                    <li key={m.line}>
                      <AppLink
                        to={docAppPath(r.path, m.heading ? headingSlug(m.heading) : undefined)}
                        className='block rounded-sm text-sm text-muted-foreground hover:text-foreground'
                      >
                        {m.heading ? <span className='font-medium text-foreground'>{m.heading} · </span> : null}
                        <Highlighted match={m} />
                      </AppLink>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
