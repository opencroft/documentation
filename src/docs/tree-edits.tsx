import { callAppAction } from '@opencroft/client/actions'
import { X } from 'lucide-react'
import { type ReactNode, useCallback, useState } from 'react'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DocFolderTitleDialog } from '@/components/ui/documentation/doc-folder-title-dialog'
import { DocMoveDialog } from '@/components/ui/documentation/doc-move-dialog'
import type { DocTreeDrop } from '@/components/ui/documentation/doc-tree'
import { slugify } from './slug.ts'
import { entryTitles, moveFolders, placeOf } from './tree-moves.ts'
import type { DocEntry, TreeChangeAnswer, UnrewrittenLink } from './types'

/** What the tree reports once something in it moved: from where to where, and the links left as written. */
export interface TreeChanged {
  from: string
  to: string
}

interface TreeEditsOptions {
  /** The App instance; the changes run as its actions, as the signed-in person. */
  instanceId: string
  tree: DocEntry[]
  /** Something moved or was renamed, and its commit is published: read the tree again. */
  onChanged: (change: TreeChanged) => Promise<void> | void
}

type Notice = { kind: 'failed'; message: string } | { kind: 'links'; links: UnrewrittenLink[] }

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/** A notice, above the page: why a drag failed, or the links a change left pointing where the page was. */
function NoticeView({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const close = (
    <AlertAction>
      <Button size='icon-xs' variant='ghost' aria-label='Dismiss' onClick={onClose}>
        <X />
      </Button>
    </AlertAction>
  )
  if (notice.kind === 'failed') {
    return (
      <Alert variant='destructive' className='mb-4'>
        <AlertTitle>{notice.message}</AlertTitle>
        {close}
      </Alert>
    )
  }
  return (
    <Alert className='mb-4'>
      <AlertTitle>Some pages still name the old place</AlertTitle>
      <AlertDescription>
        <p>
          These were left as written: links that could not be rewritten, and the old path mentioned in text or in a full
          address. Change them by hand where they should follow:
        </p>
        <ul className='list-disc pl-5'>
          {notice.links.map((link) => (
            <li key={`${link.file}:${link.line}:${link.link}`}>
              <code>{link.file}</code> line {link.line}: <code>{link.link}</code> ({link.reason})
            </li>
          ))}
        </ul>
      </AlertDescription>
      {close}
    </Alert>
  )
}

/**
 * Moving and renaming in the tree: the Move dialog behind a row's Move…, the
 * Rename dialog behind a folder's Rename…, a row dropped by dragging, and the
 * notice either can leave. Each change is committed and published by the
 * server at once; afterwards the tree is read again.
 */
export function useTreeEdits({ instanceId, tree, onChanged }: TreeEditsOptions): {
  startMove: (entry: DocEntry) => void
  startRename: (entry: DocEntry) => void
  drop: (drop: DocTreeDrop) => void
  /** Shows the links a change made elsewhere (a publish under a new title) left as written; none clears the notice. */
  showUnrewritten: (links: UnrewrittenLink[]) => void
  dialogs: ReactNode
  notice: ReactNode
} {
  const [moving, setMoving] = useState<DocEntry | null>(null)
  const [renaming, setRenaming] = useState<DocEntry | null>(null)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  // Each opening of a dialog is a fresh one, starting from the entry's place now.
  const [opening, setOpening] = useState(0)

  // Stable, since the page publishes through it from a memoised handler.
  const showUnrewritten = useCallback(
    (links: UnrewrittenLink[]) => setNotice(links.length > 0 ? { kind: 'links', links } : null),
    [],
  )

  const run = async (from: string, action: string, params: Record<string, unknown>) => {
    const answer = await callAppAction<TreeChangeAnswer>(instanceId, action, params)
    await onChanged({ from, to: answer.path })
    showUnrewritten(answer.unrewrittenLinks)
  }

  const inDialog = async (from: string, action: string, params: Record<string, unknown>, close: () => void) => {
    setPending(true)
    setFailure(null)
    try {
      await run(from, action, params)
      close()
    } catch (error) {
      setFailure(messageOf(error, 'The change could not be made.'))
    } finally {
      setPending(false)
    }
  }

  const open = (set: (entry: DocEntry) => void) => (entry: DocEntry) => {
    setFailure(null)
    setOpening((n) => n + 1)
    set(entry)
  }

  const drop = (target: DocTreeDrop) => {
    setNotice(null)
    run(target.path, 'move', { path: target.path, toFolder: target.toFolder, position: target.position }).catch(
      (error) => setNotice({ kind: 'failed', message: messageOf(error, 'The move could not be made.') }),
    )
  }

  const place = moving ? placeOf(tree, moving) : null
  const dialogs = (
    <>
      {moving && place ? (
        <DocMoveDialog
          key={`move-${opening}`}
          open
          onOpenChange={(next) => !next && setMoving(null)}
          itemTitle={moving.title}
          folders={moveFolders(tree, moving)}
          entriesOf={(folder) => entryTitles(tree, folder, moving)}
          initialFolder={place.folder}
          initialPosition={place.position}
          pending={pending}
          failure={failure}
          onMove={(toFolder, position) =>
            inDialog(moving.path, 'move', { path: moving.path, toFolder, position }, () => setMoving(null))
          }
        />
      ) : null}
      {renaming ? (
        <DocFolderTitleDialog
          key={`rename-${opening}`}
          open
          onOpenChange={(next) => !next && setRenaming(null)}
          initialTitle={renaming.title}
          nameOf={slugify}
          pending={pending}
          failure={failure}
          onSave={(title) =>
            inDialog(renaming.path, 'setFolderTitle', { path: renaming.path, title }, () => setRenaming(null))
          }
        />
      ) : null}
    </>
  )

  return {
    startMove: open(setMoving),
    startRename: open(setRenaming),
    drop,
    showUnrewritten,
    dialogs,
    notice: notice ? <NoticeView notice={notice} onClose={() => setNotice(null)} /> : null,
  }
}
