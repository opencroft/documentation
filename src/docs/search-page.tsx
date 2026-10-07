import { AppLink, legacy, useAppNavigate } from '@opencroft/client'

import { LogoLoader } from '@/components/ui/logo-loader'

import { docAppPath, searchAppPath } from './doc-routes'
import { headingSlug } from './heading-ids'
import { highlightSegments } from './search-highlight'
import type { DocSearchResult } from './types'

const { icons, invoke, React, Input } = legacy
const { useEffect, useState } = React

/** Lines shown per page; the rest are a click away on the page itself. */
const MATCHES_PER_PAGE = 3

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightSegments(text, query).map((segment, i) =>
        // Only position tells the runs apart, and it never changes for a line.
        segment.match ? (
          <mark key={i} className='rounded-sm bg-primary/20 px-0.5 text-foreground'>
            {segment.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{segment.text}</React.Fragment>
        ),
      )}
    </>
  )
}

/** What `docs.search` answered for one query; null until it has. */
function useSearchResults(namespace: string, query: string) {
  const [found, setFound] = useState<{ query: string; results: DocSearchResult[] } | null>(null)

  useEffect(() => {
    if (!query) {
      setFound(null)
      return
    }
    let cancelled = false
    // `literal`: a reader typing `foo(` is looking for that text, not writing a
    // pattern that fails to compile.
    invoke<DocSearchResult[]>('docs.search', { namespace, pattern: query, literal: true })
      .catch(() => [] as DocSearchResult[])
      .then((results) => {
        if (!cancelled) {
          setFound({ query, results })
        }
      })
    return () => {
      cancelled = true
    }
  }, [namespace, query])

  // Results of the previous query are never shown for this one.
  return found?.query === query ? found.results : null
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
  const results = useSearchResults(namespace, query)

  // The address is the source of truth: Back, or a link to another query,
  // changes what the box shows.
  useEffect(() => {
    setValue(rawQuery)
  }, [rawQuery])

  return (
    <div className='flex flex-col gap-6'>
      <form
        role='search'
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault()
          navigate(searchAppPath(value.trim()))
        }}
        className='relative'
      >
        <icons.Search className='pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground' />
        <Input
          autoFocus={!query}
          type='search'
          value={value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
          placeholder='Search docs…'
          aria-label='Search docs'
          className='h-12 pl-12 text-base md:text-base'
        />
      </form>

      {!query ? (
        <p className='text-sm text-muted-foreground'>Type a word or phrase to search every page.</p>
      ) : results === null ? (
        <div className='flex justify-center py-16'>
          <LogoLoader size={40} aria-label='Searching' />
        </div>
      ) : results.length === 0 ? (
        <p className='text-sm text-muted-foreground'>No results for “{query}”</p>
      ) : (
        <>
          <p className='text-sm text-muted-foreground'>
            {results.length === 1 ? '1 page' : `${results.length} pages`} match “{query}”
          </p>
          <ul className='m-0 flex list-none flex-col gap-6 p-0'>
            {results.map((r) => (
              <li key={r.path} className='min-w-0'>
                <AppLink to={docAppPath(r.path)} className='text-base font-medium hover:underline'>
                  {r.title ?? r.path.replace(/\.md$/, '')}
                </AppLink>
                <p className='mt-0.5 truncate text-xs text-muted-foreground'>{r.path}</p>
                <ul className='m-0 mt-2 flex list-none flex-col gap-1.5 p-0'>
                  {r.matches.slice(0, MATCHES_PER_PAGE).map((m) => (
                    <li key={`${m.line}:${m.text}`}>
                      <AppLink
                        to={docAppPath(r.path, m.heading ? headingSlug(m.heading) : undefined)}
                        className='block rounded-sm text-sm text-muted-foreground hover:text-foreground'
                      >
                        {m.heading ? <span className='font-medium text-foreground'>{m.heading} · </span> : null}
                        <Highlighted text={m.text.trim()} query={query} />
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
