import { useState } from 'react'
import { Check, Folder, House, Loader2 } from 'lucide-react'

import { Button } from '../button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../dialog'

/** A folder something can be moved into, in the tree's order. '' is the top level. */
export interface DocMoveFolder {
  path: string
  title: string
  /** How deep in the tree it is: 0 for the top level, 1 for a folder in it. */
  depth: number
}

export interface DocMoveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The title of the page or folder being moved. */
  itemTitle: string
  /** The folders it can go into, in the tree's order; the host leaves out a moved folder and what is inside it. */
  folders: DocMoveFolder[]
  /** The titles of a folder's entries in the order shown, without the one being moved. */
  entriesOf: (folder: string) => string[]
  /** Where it is now. */
  initialFolder: string
  /** Its place there now, among the others; the end when not given. */
  initialPosition?: number
  /** The move is being made: the buttons hold still. */
  pending?: boolean
  /** Why the last move failed. */
  failure?: string | null
  /** Moves it into `folder` at `position` among the entries there, 0 first. */
  onMove: (folder: string, position: number) => void
}

const OPTION =
  'flex min-h-9 w-full min-w-0 items-center gap-2 rounded-sm px-2 text-left text-sm transition-colors hover:bg-accent/50 aria-checked:bg-accent aria-checked:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring'

/*
 * The dialog behind a row's Move…: the way to move a row with a finger, and
 * the way to put it somewhere far off without dragging it there.
 *
 * Two choices, each a list: the folder, then the place among what is already
 * in that folder. Picking another folder puts the place at its end, which is
 * where something dropped into a folder goes. The dialog holds only the
 * choice; the host makes the move, says when it is under way and why it
 * failed, and closes the dialog when it is done.
 */
export function DocMoveDialog({
  open,
  onOpenChange,
  itemTitle,
  folders,
  entriesOf,
  initialFolder,
  initialPosition,
  pending = false,
  failure = null,
  onMove,
}: DocMoveDialogProps) {
  const [folder, setFolder] = useState(initialFolder)
  const entries = entriesOf(folder)
  const [position, setPosition] = useState(() => initialPosition ?? entriesOf(initialFolder).length)
  const place = Math.min(position, entries.length)

  const pickFolder = (path: string) => {
    setFolder(path)
    setPosition(entriesOf(path).length)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Move “{itemTitle}”</DialogTitle>
          <DialogDescription>Pick the folder, then where in it.</DialogDescription>
        </DialogHeader>
        <div className='grid min-w-0 gap-4 sm:grid-cols-2'>
          <div className='flex min-w-0 flex-col gap-1.5'>
            <span id='doc-move-folder' className='text-sm font-medium'>
              Folder
            </span>
            <div role='radiogroup' aria-labelledby='doc-move-folder' className='max-h-64 overflow-y-auto rounded-md border p-1'>
              {folders.map((option) => (
                <button
                  key={option.path}
                  type='button'
                  role='radio'
                  aria-checked={option.path === folder}
                  onClick={() => pickFolder(option.path)}
                  className={OPTION}
                  style={{ paddingLeft: `${option.depth * 16 + 8}px` }}
                >
                  {option.path === '' ? (
                    <House className='size-4 shrink-0 text-muted-foreground' />
                  ) : (
                    <Folder className='size-4 shrink-0 text-muted-foreground' />
                  )}
                  <span className='truncate'>{option.title}</span>
                  {option.path === folder ? <Check className='ml-auto size-4 shrink-0' /> : null}
                </button>
              ))}
            </div>
          </div>
          <div className='flex min-w-0 flex-col gap-1.5'>
            <span id='doc-move-position' className='text-sm font-medium'>
              Position
            </span>
            <div role='radiogroup' aria-labelledby='doc-move-position' className='max-h-64 overflow-y-auto rounded-md border p-1'>
              {[null, ...entries].map((after, index) => (
                <button
                  key={after === null ? 'top' : `${index}:${after}`}
                  type='button'
                  role='radio'
                  aria-checked={index === place}
                  onClick={() => setPosition(index)}
                  className={OPTION}
                >
                  <span className='truncate'>{after === null ? 'At the top' : `After “${after}”`}</span>
                  {index === place ? <Check className='ml-auto size-4 shrink-0' /> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
        {failure ? (
          <p role='alert' className='text-sm text-destructive'>
            {failure}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => onMove(folder, place)} disabled={pending}>
            {pending ? <Loader2 className='animate-spin' /> : null}
            {pending ? 'Moving…' : 'Move'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
