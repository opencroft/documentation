import { invoke } from '@opencroft/client/actions'
import type { AppComponentProps } from '@opencroft/client/app'
import { useAppLocation } from '@opencroft/client/app'
import { BookOpen } from 'lucide-react'
import { useEffect, useState } from 'react'

import { LogoLoader } from '@/components/ui/logo-loader'
import { ChatDock } from './docs/chat-panel'
import { routeOf } from './docs/doc-routes'
import { DocsBrowser } from './docs/docs-page'
import type { NamespaceEntry } from './docs/types'

/**
 * The Documentation App's component: one instance = one repository, locked
 * to the instance's own namespace, with the chat anchored to the SPACE the
 * instance was added to.
 */
export function DocsAppView({ instanceId, spaceSlug }: AppComponentProps) {
  // undefined = still loading; null = the instance has no resolvable namespace.
  const [entry, setEntry] = useState<NamespaceEntry | null | undefined>(undefined)
  const { path, search } = useAppLocation()
  const route = routeOf(path, search)
  const file = route.page === 'doc' ? route.doc : null
  const [source, setSource] = useState('')

  useEffect(() => {
    let cancelled = false
    invoke<NamespaceEntry[]>('docs.listNamespaces')
      .then((list) => {
        if (!cancelled) setEntry(list.find((e) => e.id === instanceId) ?? null)
      })
      .catch(() => {
        if (!cancelled) setEntry(null)
      })
    return () => {
      cancelled = true
    }
  }, [instanceId])

  if (entry === undefined) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LogoLoader size={40} aria-label='Loading documentation' />
      </div>
    )
  }

  if (entry === null) {
    return (
      <div className='flex h-full w-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground'>
        <BookOpen className='size-8 text-muted-foreground/60' />
        <p>This documentation instance could not be loaded.</p>
        <p>It may have been removed, or its repository is still being cloned.</p>
      </div>
    )
  }

  return (
    <ChatDock
      space={spaceSlug}
      threadId={`documentation-${entry.namespace}`}
      namespace={entry.namespace}
      file={file ?? ''}
      source={source}
    >
      <DocsBrowser
        key={entry.namespace}
        instanceId={instanceId}
        namespace={entry.namespace}
        defaultFile='README.md'
        onSourceChange={setSource}
      />
    </ChatDock>
  )
}
