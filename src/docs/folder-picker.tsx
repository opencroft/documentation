import { legacy } from '@opencroft/client'

import { cn } from 'cn'
import { ancestorsOf, type FolderNode } from './new-doc'

const { icons, React, Button, Input, Label } = legacy
const { useState } = React

interface FolderPickerProps {
  folders: FolderNode[]
  /** The picked folder; '' is the root. */
  selected: string
  onSelect: (path: string) => void
  /** Why a folder can't be named `name` inside the selected one, or null when it can. */
  folderNameError: (name: string) => string | null
  /** A folder named `name` is wanted inside the selected one. */
  onAddFolder: (name: string) => void
}

const ROW = 'flex min-h-9 items-center gap-1.5 rounded-sm pr-2 text-sm'

function indent(depth: number) {
  return { paddingLeft: `${depth * 16 + 4}px` }
}

/**
 * The documentation's folders as a tree under the root, one of them picked,
 * with a "New folder" action that names a folder inside the picked one in
 * place: Enter or the check adds it, Escape drops it. A name that can't be
 * used says why under the field and is not added.
 */
export function FolderPicker({ folders, selected, onSelect, folderNameError, onAddFolder }: FolderPickerProps) {
  // The picked folder is in view when the picker opens.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(ancestorsOf(selected)))
  const [naming, setNaming] = useState(false)
  const [draftName, setDraftName] = useState('')

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })

  const startNaming = () => {
    setDraftName('')
    setNaming(true)
  }

  const nameError = naming ? folderNameError(draftName) : null

  const addFolder = () => {
    if (nameError) {
      return
    }
    if (draftName.trim()) {
      // The new folder is picked inside this one, so this one stays open to show it.
      setExpanded((prev) => new Set(prev).add(selected))
      onAddFolder(draftName)
    }
    setNaming(false)
  }

  const nameRow = (depth: number) => (
    <li>
      <div className={ROW} style={indent(depth)}>
        <span className='w-6 shrink-0' />
        <icons.FolderPlus className='size-4 shrink-0 text-muted-foreground' />
        <Input
          autoFocus
          aria-label='New folder name'
          aria-invalid={nameError !== null}
          value={draftName}
          placeholder='Folder name'
          className='h-8 min-w-0 flex-1'
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraftName(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addFolder()
            } else if (e.key === 'Escape') {
              // Drops the name only; the dialog around it closes on an Escape that reaches it.
              e.stopPropagation()
              setNaming(false)
            }
          }}
        />
        <Button
          type='button'
          size='icon-sm'
          variant='ghost'
          onClick={addFolder}
          disabled={nameError !== null}
          aria-label='Add folder'
        >
          <icons.Check />
        </Button>
      </div>
      {nameError && (
        <p className='pb-1 text-sm text-destructive' style={indent(depth + 2)}>
          {nameError}
        </p>
      )}
    </li>
  )

  const folder = (node: FolderNode, depth: number) => {
    const isRoot = node.path === ''
    const isSelected = node.path === selected
    const namingHere = naming && isSelected
    const hasChildren = node.children.length > 0
    // The root is always open; a folder getting a new child opens to show where it goes.
    const isOpen = isRoot || namingHere || expanded.has(node.path)
    const Icon = isRoot ? icons.House : isOpen && hasChildren ? icons.FolderOpen : icons.Folder
    return (
      <li key={node.path}>
        <div className={cn(ROW, isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50')} style={indent(depth)}>
          {hasChildren && !isRoot ? (
            <button
              type='button'
              onClick={() => toggle(node.path)}
              aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
              aria-expanded={isOpen}
              className='inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground'
            >
              <icons.ChevronDown className={cn('size-3.5 transition-transform', !isOpen && '-rotate-90')} />
            </button>
          ) : (
            <span className='w-6 shrink-0' />
          )}
          <button
            type='button'
            onClick={() => {
              onSelect(node.path)
              setNaming(false)
            }}
            aria-current={isSelected ? 'true' : undefined}
            className='flex min-h-9 min-w-0 flex-1 items-center gap-1.5 text-left'
          >
            <Icon className='size-4 shrink-0 text-muted-foreground' />
            <span className='truncate'>{node.name}</span>
          </button>
        </div>
        {isOpen && (hasChildren || namingHere) && (
          <ul className='m-0 list-none p-0'>
            {namingHere && nameRow(depth + 1)}
            {node.children.map((child) => folder(child, depth + 1))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-center justify-between gap-2'>
        <Label>Folder</Label>
        <Button type='button' variant='ghost' size='sm' onClick={startNaming}>
          <icons.FolderPlus /> New folder
        </Button>
      </div>
      <ul className='m-0 max-h-56 list-none overflow-y-auto rounded-md border p-1'>
        {folder({ name: 'Root', path: '', children: folders }, 0)}
      </ul>
    </div>
  )
}
