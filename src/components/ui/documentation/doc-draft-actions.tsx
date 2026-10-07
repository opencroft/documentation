import { useId } from 'react'
import { Check, GitCompareArrows, Loader2, X } from 'lucide-react'
import { cn } from 'cn'

import { Button } from '../button'
import { Textarea } from '../textarea'

export type DocDraftPending = 'publish' | 'discard'

export interface DocDraftActionsProps {
  /** The description of the change; the host commits it as the message. */
  description: string
  onDescriptionChange: (description: string) => void
  onDiscard?: () => void
  onPublish?: () => void
  /** Opens the draft against the published page, or closes it again when
   *  `changesOpen`: the button is a toggle. Without it there is no Changes
   *  button. */
  onToggleChanges?: () => void
  /** The changes are on show: the Changes button reads as pressed, and
   *  pressing it again goes back to editing. */
  changesOpen?: boolean
  /** The act in flight, if any. Both buttons hold still while one runs. */
  pending?: DocDraftPending | null
  /** Why the last publish or discard failed. Shown above the buttons, in the
   *  bar, so it is in view wherever the page is scrolled to. */
  failure?: string | null
  className?: string
}

// The bar under a page being edited: the description first, at the full width
// of the row, then Changes and the two acts. Changes comes first and quietest:
// it only looks, and it is what someone does before deciding between the
// other two. Discard sits before Publish, so the act that reaches the
// published page is the last one in the row.
//
// It is drawn as a bar -- a top rule over the background -- because the host
// pins it to the bottom of the page area, outside what scrolls, so the acts
// are in view however long the page is. The description grows with what is
// typed only up to a few lines and then scrolls inside itself: the bar's
// height is taken from the page, and a long description must not take the
// page with it.
export function DocDraftActions({
  description,
  onDescriptionChange,
  onDiscard,
  onPublish,
  onToggleChanges,
  changesOpen = false,
  pending = null,
  failure = null,
  className,
}: DocDraftActionsProps) {
  const id = useId()
  const busy = pending != null

  return (
    <div data-slot='doc-draft-actions' className={cn('flex flex-col gap-3 border-t bg-background py-3', className)}>
      <div className='flex flex-col gap-1.5'>
        <label htmlFor={id} className='text-sm font-medium'>
          Description of the change
        </label>
        <Textarea
          id={id}
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder='What changed, and why'
          rows={3}
          className='max-h-32'
        />
      </div>
      {failure ? (
        <p role='alert' className='text-sm text-destructive'>
          {failure}
        </p>
      ) : null}
      <div className='flex justify-end gap-2'>
        {onToggleChanges ? (
          <Button
            size='sm'
            variant={changesOpen ? 'secondary' : 'ghost'}
            aria-pressed={changesOpen}
            onClick={onToggleChanges}
          >
            <GitCompareArrows /> Changes
          </Button>
        ) : null}
        <Button size='sm' variant='outline' onClick={onDiscard} disabled={busy}>
          {pending === 'discard' ? <Loader2 className='animate-spin' /> : <X />}
          {pending === 'discard' ? 'Discarding…' : 'Discard'}
        </Button>
        <Button size='sm' onClick={onPublish} disabled={busy}>
          {pending === 'publish' ? <Loader2 className='animate-spin' /> : <Check />}
          {pending === 'publish' ? 'Publishing…' : 'Publish'}
        </Button>
      </div>
    </div>
  )
}
