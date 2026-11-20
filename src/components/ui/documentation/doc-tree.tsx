import { type DragEvent, type ReactNode, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ChevronDown, FileText, FolderInput, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { cn } from 'cn'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../dropdown-menu'

/** A page or folder of the tree. */
export interface DocTreeNode {
  path: string
  /** What the row shows: the page's title, the folder's title. */
  title: string
  type: 'file' | 'directory'
  /** A page that is not published yet. */
  draft?: boolean
  /** A published page with unpublished changes, marked with a pencil. */
  changed?: boolean
  /** A folder's entries, in the order shown. */
  children?: DocTreeNode[]
}

/** Where a dragged row was dropped: into `toFolder` ('' is the top level), at `position` among the entries already there. */
export interface DocTreeDrop {
  path: string
  toFolder: string
  position: number
}

/** What a page row's link is drawn with; spread onto the host's own link. */
export interface DocTreeLinkProps {
  className: string
  style: { paddingLeft: string }
  'aria-current': 'page' | undefined
  'data-doc-tree-file': string
  draggable: boolean
  onDragStart: (event: DragEvent) => void
  onDragEnd: () => void
  children: ReactNode
}

export interface DocTreeProps {
  nodes: DocTreeNode[]
  /** The open page's path. */
  selectedPath: string | null
  /** The open folders' paths. */
  expanded: ReadonlySet<string>
  onToggle: (path: string) => void
  /** A page row's link, drawn by the host so it navigates the host's way. A plain `<a>` when not given. */
  renderPageLink?: (node: DocTreeNode, link: DocTreeLinkProps) => ReactNode
  /** Rename… in a folder's menu. */
  onRename?: (node: DocTreeNode) => void
  /** Move… in every row's menu. */
  onMove?: (node: DocTreeNode) => void
  /** Delete in every row's menu. */
  onDelete?: (node: DocTreeNode) => void
  /** A row dragged to a new place. Without it rows are not dragged. */
  onDrop?: (drop: DocTreeDrop) => void
  className?: string
}

type Zone = 'before' | 'after' | 'into'

const INDICATOR_TRANSITION =
  'top 350ms cubic-bezier(0.22, 1, 0.36, 1), height 350ms cubic-bezier(0.22, 1, 0.36, 1), opacity 150ms'

const ROW =
  'flex w-full min-w-0 items-center gap-1 rounded-sm py-1.5 pr-8 text-left text-sm transition-colors hover:bg-accent/50'

// The row's menu button: in view while the row is hovered or holds focus, and
// always where nothing hovers, so a finger can reach it.
const MENU_BUTTON =
  'absolute top-1/2 right-1 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-popup-open:opacity-100 [@media(hover:none)]:opacity-100'

function subscribeFinePointer(onChange: () => void) {
  const query = window.matchMedia('(pointer: fine)')
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** Rows are dragged only with a fine pointer; a finger moves them from the menu. */
function useFinePointer(): boolean {
  return useSyncExternalStore(
    subscribeFinePointer,
    () => window.matchMedia('(pointer: fine)').matches,
    () => false,
  )
}

function indent(depth: number) {
  return { paddingLeft: `${depth * 12 + 4}px` }
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

/** Whether `path` is `ancestor` or inside it. */
function within(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`)
}

/** Where in a row the pointer is: its top or bottom quarter, or for a folder its middle. */
function zoneAt(event: DragEvent, node: DocTreeNode): Zone {
  const rect = event.currentTarget.getBoundingClientRect()
  const at = (event.clientY - rect.top) / rect.height
  if (node.type === 'directory') {
    return at < 0.25 ? 'before' : at > 0.75 ? 'after' : 'into'
  }
  return at < 0.5 ? 'before' : 'after'
}

/** The drop that putting `dragged` at `zone` of `target` (among `siblings`) means. */
function dropAt(dragged: string, target: DocTreeNode, zone: Zone, siblings: DocTreeNode[]): DocTreeDrop {
  if (zone === 'into') {
    const children = (target.children ?? []).filter((child) => child.path !== dragged)
    return { path: dragged, toFolder: target.path, position: children.length }
  }
  const others = siblings.filter((sibling) => sibling.path !== dragged)
  const index = others.findIndex((sibling) => sibling.path === target.path)
  return { path: dragged, toFolder: parentOf(target.path), position: zone === 'before' ? index : index + 1 }
}

interface RowMenu {
  onRename?: () => void
  onMove?: () => void
  onDelete?: () => void
}

function hasItems(menu: RowMenu): boolean {
  return Boolean(menu.onRename || menu.onMove || menu.onDelete)
}

function ContextItems({ onRename, onMove, onDelete }: RowMenu) {
  return (
    <>
      {onRename ? (
        <ContextMenuItem onClick={onRename}>
          <Pencil /> Rename…
        </ContextMenuItem>
      ) : null}
      {onMove ? (
        <ContextMenuItem onClick={onMove}>
          <FolderInput /> Move…
        </ContextMenuItem>
      ) : null}
      {onDelete ? (
        <>
          {onRename || onMove ? <ContextMenuSeparator /> : null}
          <ContextMenuItem variant='destructive' onClick={onDelete}>
            <Trash2 /> Delete
          </ContextMenuItem>
        </>
      ) : null}
    </>
  )
}

function DropdownItems({ onRename, onMove, onDelete }: RowMenu) {
  return (
    <>
      {onRename ? (
        <DropdownMenuItem onClick={onRename}>
          <Pencil /> Rename…
        </DropdownMenuItem>
      ) : null}
      {onMove ? (
        <DropdownMenuItem onClick={onMove}>
          <FolderInput /> Move…
        </DropdownMenuItem>
      ) : null}
      {onDelete ? (
        <>
          {onRename || onMove ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem variant='destructive' onClick={onDelete}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  )
}

/** A row with its menu: on the ⋯ button, and on a right-click or long press anywhere on the row. */
function MenuRow({ title, menu, children }: { title: string; menu: RowMenu; children: ReactNode }) {
  // A long press opens the menu while the finger is still down. The lift that
  // ends the press is a tap to the browser, and its click would close the menu
  // and act on the row under the finger, so that lift is cancelled.
  const openedByPress = useRef(false)
  if (!hasItems(menu)) {
    return <div className='group/row relative'>{children}</div>
  }
  return (
    <ContextMenu
      onOpenChange={(open) => {
        openedByPress.current = open
      }}
    >
      <ContextMenuTrigger
        className='group/row relative'
        onTouchStart={() => {
          openedByPress.current = false
        }}
        onTouchEnd={(event) => {
          if (openedByPress.current) {
            event.preventDefault()
          }
        }}
      >
        {children}
        <DropdownMenu>
          <DropdownMenuTrigger className={MENU_BUTTON} aria-label={`Actions for ${title}`}>
            <MoreHorizontal className='size-4' />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownItems {...menu} />
          </DropdownMenuContent>
        </DropdownMenu>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextItems {...menu} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

interface LevelProps extends DocTreeProps {
  depth: number
  canDrag: boolean
  dragged: string | null
  setDragged: (path: string | null) => void
  target: { path: string; zone: Zone } | null
  setTarget: (target: { path: string; zone: Zone } | null) => void
}

function TreeLevel({ nodes, depth, ...tree }: LevelProps & { nodes: DocTreeNode[] }) {
  const { selectedPath, expanded, onToggle, renderPageLink, onRename, onMove, onDelete, onDrop } = tree
  const { canDrag, dragged, setDragged, target, setTarget } = tree

  const dropProps = (node: DocTreeNode) => {
    if (!canDrag || dragged === null || within(node.path, dragged)) {
      return {}
    }
    return {
      onDragOver: (event: DragEvent) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const zone = zoneAt(event, node)
        if (target?.path !== node.path || target.zone !== zone) {
          setTarget({ path: node.path, zone })
        }
      },
      onDrop: (event: DragEvent) => {
        event.preventDefault()
        onDrop?.(dropAt(dragged, node, zoneAt(event, node), nodes))
        setDragged(null)
        setTarget(null)
      },
    }
  }

  const dragProps = (node: DocTreeNode) => ({
    draggable: canDrag,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', node.title)
      setDragged(node.path)
    },
    onDragEnd: () => {
      setDragged(null)
      setTarget(null)
    },
  })

  // The line where a dropped row goes, or the folder it goes into.
  const dropMark = (node: DocTreeNode) => {
    if (target?.path !== node.path || dragged === null) {
      return null
    }
    if (target.zone === 'into') {
      return <span aria-hidden className='pointer-events-none absolute inset-0 rounded-sm ring-2 ring-primary ring-inset' />
    }
    return (
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute right-0 h-0.5 rounded-full bg-primary',
          target.zone === 'before' ? '-top-px' : '-bottom-px',
        )}
        style={{ left: indent(depth).paddingLeft }}
      />
    )
  }

  return (
    <ul className='m-0 list-none p-0'>
      {nodes.map((node) => {
        if (node.type === 'directory') {
          const isExpanded = expanded.has(node.path)
          const children = node.children ?? []
          return (
            <li key={node.path} className={cn(dragged === node.path && 'opacity-50')}>
              <MenuRow
                title={node.title}
                menu={{
                  onRename: onRename && (() => onRename(node)),
                  onMove: onMove && (() => onMove(node)),
                  onDelete: onDelete && (() => onDelete(node)),
                }}
              >
                <button
                  type='button'
                  onClick={() => children.length > 0 && onToggle(node.path)}
                  aria-expanded={children.length > 0 ? isExpanded : undefined}
                  className={ROW}
                  style={indent(depth)}
                  {...dragProps(node)}
                  {...dropProps(node)}
                >
                  {children.length > 0 ? (
                    <ChevronDown
                      className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', !isExpanded && '-rotate-90')}
                    />
                  ) : (
                    <span className='w-3.5 shrink-0' />
                  )}
                  <span className='truncate font-medium'>{node.title}</span>
                </button>
                {dropMark(node)}
              </MenuRow>
              {isExpanded && children.length > 0 ? (
                <TreeLevel {...tree} nodes={children} depth={depth + 1} />
              ) : null}
            </li>
          )
        }

        const isSelected = selectedPath === node.path
        const link: DocTreeLinkProps = {
          className: cn(ROW, 'hover:text-foreground', isSelected ? 'text-foreground' : 'text-muted-foreground'),
          style: indent(depth),
          'aria-current': isSelected ? 'page' : undefined,
          'data-doc-tree-file': node.path,
          ...dragProps(node),
          children: (
            <>
              <FileText className='size-3.5 shrink-0 opacity-50' />
              <span className='truncate'>{node.title}</span>
              {node.draft ? (
                <span className='ml-auto shrink-0 rounded border px-1 text-[10px] leading-4 text-muted-foreground'>Draft</span>
              ) : node.changed ? (
                <Pencil className='ml-auto size-3 shrink-0 text-orange-500' />
              ) : null}
            </>
          ),
        }
        return (
          <li key={node.path} className={cn(dragged === node.path && 'opacity-50')} {...dropProps(node)}>
            <MenuRow
              title={node.title}
              menu={{
                onMove: onMove && (() => onMove(node)),
                onDelete: onDelete && (() => onDelete(node)),
              }}
            >
              {renderPageLink ? renderPageLink(node, link) : <a href={`#${node.path}`} {...link} />}
              {dropMark(node)}
            </MenuRow>
          </li>
        )
      })}
    </ul>
  )
}

/*
 * The tree, with the bar that slides beside the open page.
 *
 * The bar is positioned from the DOM rather than from state: where a row sits
 * is only known once it is laid out, and moving it must not re-render the tree.
 * The tree can be shown out of this component's own DOM parent (in a host's
 * sidebar), so the row is found through this component's refs and never by
 * querying the document.
 *
 * A drag is the native one, offered only with a fine pointer: on a touch screen
 * a long press opens the row's menu, and Move… there is how a row is moved.
 */
export function DocTree({ className, ...props }: DocTreeProps) {
  const navRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  const finePointer = useFinePointer()
  const [dragged, setDragged] = useState<string | null>(null)
  const [target, setTarget] = useState<{ path: string; zone: Zone } | null>(null)
  const { selectedPath, nodes, expanded } = props

  // Also when the tree or an open folder changes: rows above the selected one
  // move, and the bar has to follow them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: nodes and expanded are not read; a change to either moves the rows, so the bar is measured again
  useLayoutEffect(() => {
    const nav = navRef.current
    const indicator = indicatorRef.current
    if (!nav || !indicator) {
      return
    }
    const row =
      selectedPath === null
        ? undefined
        : Array.from(nav.querySelectorAll<HTMLElement>('[data-doc-tree-file]')).find(
            (el) => el.dataset.docTreeFile === selectedPath,
          )
    if (!row) {
      indicator.style.opacity = '0'
      return
    }
    indicator.style.opacity = '1'
    indicator.style.top = `${row.getBoundingClientRect().top - nav.getBoundingClientRect().top}px`
    indicator.style.height = `${row.getBoundingClientRect().height}px`
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selectedPath, nodes, expanded])

  return (
    <div ref={navRef} data-slot='doc-tree' className={cn('relative py-1 pr-3', className)}>
      <span
        ref={indicatorRef}
        className='absolute right-0 w-0.5 rounded-full bg-primary will-change-transform'
        style={{ top: 0, height: 0, opacity: 0, transition: INDICATOR_TRANSITION }}
      />
      <TreeLevel
        {...props}
        nodes={nodes}
        depth={0}
        canDrag={finePointer && Boolean(props.onDrop)}
        dragged={dragged}
        setDragged={setDragged}
        target={target}
        setTarget={setTarget}
      />
    </div>
  )
}
