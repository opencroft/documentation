import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@opencroft/client/ui'
import { Loader2 } from 'lucide-react'

import type { DocEntry } from './types'

/** Asks before a page, or a folder with everything in it, is deleted; the deletion is published at once. */
export function DeleteDocDialog({
  entry,
  pending,
  failure,
  onCancel,
  onConfirm,
}: {
  entry: DocEntry
  pending: boolean
  /** Why the last try failed; the dialog stays open on it. */
  failure: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const folder = entry.type === 'directory'
  return (
    <AlertDialog open onOpenChange={(open: boolean) => !open && !pending && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{folder ? 'Delete folder?' : 'Delete page?'}</AlertDialogTitle>
          <AlertDialogDescription>
            {folder ? (
              <>
                The folder <span className='font-medium'>{entry.title}</span> (
                <span className='font-mono'>{entry.path}</span>) and every page in it are deleted and the deletion is
                published at once. Their unpublished drafts are dropped too.
              </>
            ) : (
              <>
                The page <span className='font-medium'>{entry.title}</span> (
                <span className='font-mono'>{entry.path}</span>) is deleted and the deletion is published at once. Its
                unpublished draft is dropped too.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failure ? (
          <p role='alert' className='text-sm text-destructive'>
            {failure}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant='destructive' onClick={onConfirm} disabled={pending}>
            {pending ? <Loader2 className='animate-spin' /> : null}
            {pending ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
