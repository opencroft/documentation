import { legacy } from '@opencroft/client'

import { FolderPicker } from './folder-picker'
import { docFileName, folderTree, joinPath, nameHolder, treePaths } from './new-doc'
import { slugify } from './slug'
import type { DocEntry } from './types'

const {
  React,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} = legacy
const { useId, useMemo, useState } = React

interface NewDocDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The whole documentation tree: which folders exist and which names are taken. */
  tree: DocEntry[]
  /** The folder picked when the dialog opens; '' is the root. */
  initialFolder: string
  /** Creates the page; a rejection's message is shown in the dialog. */
  onCreate: (path: string, title: string) => Promise<void>
}

/**
 * New document: the page's title, the file name it gives (`<slug>.md`, shown
 * as it is typed), and the folder the file is saved in. A name already taken
 * in that folder, by a page or by a folder, is an error, and nothing is
 * created until the title or the folder changes. Its state starts over each
 * time it is mounted.
 */
export function NewDocDialog({ open, onOpenChange, tree, initialFolder, onCreate }: NewDocDialogProps) {
  const titleId = useId()
  const [title, setTitle] = useState('')
  const [folder, setFolder] = useState(initialFolder)
  // Folders named here; one is written only when a page is saved into it.
  const [addedFolders, setAddedFolders] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Folders named here take their names too, before anything is written.
  const taken = useMemo(() => new Set([...treePaths(tree), ...addedFolders]), [tree, addedFolders])
  const folders = useMemo(() => folderTree(tree, addedFolders), [tree, addedFolders])

  const fileName = docFileName(title)
  const path = fileName ? joinPath(folder, fileName) : null
  const holder = fileName ? nameHolder(taken, folder, slugify(title)) : null
  const titleError = !title.trim()
    ? null
    : path === null
      ? 'The title needs a letter or a digit to name the file.'
      : holder === 'page'
        ? 'A file with this name already exists.'
        : holder === 'folder'
          ? 'A folder with this name already exists.'
          : createError
  const canCreate = path !== null && titleError === null && !creating

  const pickFolder = (next: string) => {
    setFolder(next)
    setCreateError(null)
  }

  // A folder may not take a page's name. Naming one that exists picks it.
  const folderNameError = (name: string): string | null => {
    if (!name.trim()) {
      return null
    }
    const folderSlug = slugify(name)
    if (!folderSlug) {
      return 'The name needs a letter or a digit.'
    }
    return nameHolder(taken, folder, folderSlug) === 'page' ? 'A page with this name already exists.' : null
  }

  const addFolder = (name: string) => {
    const slug = slugify(name)
    if (!slug) {
      return
    }
    const added = joinPath(folder, slug)
    setAddedFolders((prev) => (prev.includes(added) ? prev : [...prev, added]))
    pickFolder(added)
  }

  const create = async () => {
    if (!canCreate || path === null) {
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      await onCreate(path, title.trim())
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create the page.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New document</DialogTitle>
          <DialogDescription>The title names the page and its file.</DialogDescription>
        </DialogHeader>
        <div className='flex min-w-0 flex-col gap-1.5'>
          <Label htmlFor={titleId}>Title</Label>
          <Input
            id={titleId}
            autoFocus
            value={title}
            placeholder='Getting started'
            aria-invalid={titleError !== null}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setTitle(e.target.value)
              setCreateError(null)
            }}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                create()
              }
            }}
          />
          {titleError ? (
            <p className='text-sm text-destructive'>{titleError}</p>
          ) : path ? (
            <p className='truncate text-sm text-muted-foreground' title={path}>
              Saved as <span className='font-mono'>{path}</span>
            </p>
          ) : null}
        </div>
        <FolderPicker
          folders={folders}
          selected={folder}
          onSelect={pickFolder}
          folderNameError={folderNameError}
          onAddFolder={addFolder}
        />
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!canCreate}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
