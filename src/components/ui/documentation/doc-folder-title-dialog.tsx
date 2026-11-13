import { type FormEvent, useId, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '../button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../dialog'
import { Input } from '../input'

export interface DocFolderTitleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The folder's title now. */
  initialTitle: string
  /** The folder name on disk a title gives; empty when it gives none. */
  nameOf: (title: string) => string
  /** The rename is being made: the buttons hold still. */
  pending?: boolean
  /** Why the last rename failed. */
  failure?: string | null
  onSave: (title: string) => void
}

/*
 * Renaming a folder from a row's Rename…. What is typed is the folder's
 * title, the words the tree shows; the folder's name on disk follows from it,
 * so that name is shown under the field as it changes -- it is what links and
 * addresses will use. A title that gives no name (only punctuation) cannot be
 * saved. The host makes the rename, says while it is under way, shows why it
 * failed, and closes the dialog when it is done.
 */
export function DocFolderTitleDialog({
  open,
  onOpenChange,
  initialTitle,
  nameOf,
  pending = false,
  failure = null,
  onSave,
}: DocFolderTitleDialogProps) {
  const id = useId()
  const [title, setTitle] = useState(initialTitle)
  const clean = title.replace(/\s+/g, ' ').trim()
  const name = clean ? nameOf(clean) : ''
  const blocked = !clean || !name

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!blocked && !pending) {
      onSave(clean)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className='grid gap-6'>
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
            <DialogDescription>The title is what the documentation shows; the folder is named after it.</DialogDescription>
          </DialogHeader>
          <div className='flex min-w-0 flex-col gap-1.5'>
            <label htmlFor={id} className='text-sm font-medium'>
              Title
            </label>
            <Input id={id} autoFocus value={title} onChange={(event) => setTitle(event.target.value)} aria-invalid={Boolean(clean) && !name} />
            <p className='truncate text-xs text-muted-foreground'>
              {!clean ? 'A folder needs a title.' : name ? `Folder name: ${name}` : 'Use a letter or a digit to name the folder with.'}
            </p>
          </div>
          {failure ? (
            <p role='alert' className='text-sm text-destructive'>
              {failure}
            </p>
          ) : null}
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type='submit' disabled={blocked || pending}>
              {pending ? <Loader2 className='animate-spin' /> : null}
              {pending ? 'Renaming…' : 'Rename'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
