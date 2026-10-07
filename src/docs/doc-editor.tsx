import { callAppAction, legacy, MarkdownEditor } from '@opencroft/client'

import { DocDraftActions, type DocDraftPending } from '@/components/ui/documentation/doc-draft-actions'

import { cn } from 'cn'
import { DocDiff } from './doc-diff'

const { createPortal, invoke, React } = legacy
const { useRef, useState } = React

interface DocEditorProps {
  /** The App instance; publishing runs as its action, as the signed-in person. */
  instanceId: string
  namespace: string
  filePath: string
  /** The page's shared draft, as `docs.openDraft` names it. */
  document: string
  onPublish: () => void
  onDiscard: () => void
  /** Where the draft bar goes: the page area's own row below its scroller. */
  draftBarSlot: HTMLElement | null
}

/** The draft against the published page; `published` is null for a page never published. */
type DraftChanges = { published: string | null; draft: string }

const ignoreHeading = () => {}

/*
 * The page editor: the host's `MarkdownEditor`, with what to do with the draft
 * in a bar pinned to the bottom of the page area.
 *
 * The editor edits the page's draft together with everyone else who has it
 * open -- their carets and selections show in it, and an agent's edit to the
 * page is played in as it lands. The host holds the shared draft and writes
 * it to the page's file as it changes, so nothing is saved from here; and a
 * page opened and left as it was is not written at all, so opening one makes
 * no draft.
 *
 * Changes shows the draft against the published page, on the page as it
 * renders, in the editor's place. The editor stays mounted behind it, so
 * going back finds it as it was -- undo history and all -- and the bar stays
 * where it is, to publish what was just reviewed. Changes is a toggle in the
 * bar, beside Discard and Publish, not in the editor's toolbar: pressed again
 * it goes back to editing. The changes have no header of their own; the
 * page's path row above them is the page's.
 *
 * The bar is rendered into a slot the page puts after its scroller, not in the
 * page: it stays in view however long the page is, and the page never scrolls
 * behind it -- the editor scrolls the line being typed into view against the
 * scroller's own bottom edge, which a bar laid over the scroller would hide.
 * Its state stays here with the draft it acts on.
 *
 * Publish publishes the whole draft, whoever typed it, with the description of
 * the change as its commit message, and Discard drops it for everyone: the
 * server does both with the draft closed, and the other editors reopen on what
 * is left.
 */
export function DocEditor({ instanceId, namespace, filePath, document, onPublish, onDiscard, draftBarSlot }: DocEditorProps) {
  const [pending, setPending] = useState<DocDraftPending | null>(null)
  const [description, setDescription] = useState('')
  // Why the last publish, discard or look at the changes failed; the draft is as it was.
  const [failure, setFailure] = useState<string | null>(null)
  // The changes on show in the editor's place: 'loading' until both versions have been read.
  const [changes, setChanges] = useState<DraftChanges | 'loading' | null>(null)
  // Which opening of the changes is current, so a read that lands after Back changes nothing.
  const changesSeq = useRef(0)

  const run = async (act: DocDraftPending, action: () => Promise<unknown>, done: () => void, fallback: string) => {
    setPending(act)
    setFailure(null)
    try {
      await action()
    } catch (e) {
      setFailure(e instanceof Error ? e.message : fallback)
      return
    } finally {
      setPending(null)
    }
    done()
  }

  const handlePublish = () =>
    run(
      'publish',
      // As an App action, so the commit names the signed-in person.
      () => callAppAction(instanceId, 'publish', { path: filePath, message: description.trim() || `Update ${filePath}` }),
      () => {
        setDescription('')
        onPublish()
      },
      'Publishing failed.',
    )

  const handleDiscard = () =>
    run('discard', () => invoke('docs.discardByNs', { namespace, path: filePath }), onDiscard, 'Discarding failed.')

  // Read when asked for rather than kept up to date: the draft goes on
  // changing as people type, and the view shows it as it was when opened.
  const showChanges = async () => {
    const seq = ++changesSeq.current
    setChanges('loading')
    setFailure(null)
    try {
      const [published, draft] = await Promise.all([
        invoke<string | null>('docs.readAtRef', { namespace, path: filePath }),
        invoke<string>('docs.readWorking', { namespace, path: filePath }),
      ])
      if (seq === changesSeq.current) {
        setChanges({ published, draft })
      }
    } catch {
      if (seq === changesSeq.current) {
        setChanges(null)
        setFailure("The draft's changes couldn't be read.")
      }
    }
  }

  const backToEditing = () => {
    changesSeq.current++
    setChanges(null)
  }

  return (
    <>
      <MarkdownEditor
        collab={{ document }}
        // The page scrolls, not the editor: it sits in the docs ScrollArea and
        // grows with the document, which is why the toolbar has to stick and why
        // the box wears no border of its own -- and no inset either: the text
        // being edited sits exactly where the rendered page puts it.
        className={cn('border-0 rounded-none', changes !== null && 'hidden')}
        toolbarClassName='sticky top-0 z-10 bg-background'
        contentClassName='prose-docs min-h-[60vh] focus:outline-none'
      />
      {changes === 'loading' && <p className='text-sm text-muted-foreground'>Reading the changes…</p>}
      {changes !== null && changes !== 'loading' && (
        <DocDiff
          before={changes.published ?? ''}
          after={changes.draft}
          currentPath={filePath}
          onHeadingClick={ignoreHeading}
        />
      )}
      {draftBarSlot &&
        createPortal(
          <DocDraftActions
            description={description}
            onDescriptionChange={setDescription}
            onDiscard={handleDiscard}
            onPublish={handlePublish}
            onToggleChanges={changes === null ? showChanges : backToEditing}
            changesOpen={changes !== null}
            pending={pending}
            failure={failure}
          />,
          draftBarSlot,
        )}
    </>
  )
}
