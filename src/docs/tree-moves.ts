// What the Move dialog offers for an entry of the tree, and where the open
// page is after a move. No host imports, so it runs under `node --test`.

import type { DocEntry } from './types'

/** A folder the Move dialog lists; '' is the top level. */
export interface MoveFolder {
  path: string
  title: string
  depth: number
}

/** The title the top level is listed under. */
export const TOP_LEVEL_TITLE = 'Top level'

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

/** Whether `path` is `ancestor` or inside it. */
function within(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`)
}

/** The entries of `folder` ('' is the top level) in the order shown; empty for a folder the tree lacks. */
export function entriesOf(tree: DocEntry[], folder: string): DocEntry[] {
  if (!folder) {
    return tree
  }
  for (const entry of tree) {
    if (entry.type === 'directory' && within(folder, entry.path)) {
      return entry.path === folder ? (entry.children ?? []) : entriesOf(entry.children ?? [], folder)
    }
  }
  return []
}

/** The folders `moving` can go into, in the tree's order: the top level first, a moved folder and what is inside it left out. */
export function moveFolders(tree: DocEntry[], moving: DocEntry): MoveFolder[] {
  const folders: MoveFolder[] = [{ path: '', title: TOP_LEVEL_TITLE, depth: 0 }]
  const visit = (entries: DocEntry[], depth: number) => {
    for (const entry of entries) {
      if (entry.type !== 'directory' || (moving.type === 'directory' && within(entry.path, moving.path))) {
        continue
      }
      folders.push({ path: entry.path, title: entry.title, depth })
      visit(entry.children ?? [], depth + 1)
    }
  }
  visit(tree, 1)
  return folders
}

/** The titles of the entries in `folder` in the order shown, without `moving`. */
export function entryTitles(tree: DocEntry[], folder: string, moving: DocEntry): string[] {
  return entriesOf(tree, folder)
    .filter((entry) => entry.path !== moving.path)
    .map((entry) => entry.title)
}

/** Where `entry` is now: its folder, and its place there among the others. */
export function placeOf(tree: DocEntry[], entry: DocEntry): { folder: string; position: number } {
  const folder = parentOf(entry.path)
  const position = entriesOf(tree, folder).findIndex((sibling) => sibling.path === entry.path)
  return { folder, position: Math.max(position, 0) }
}

/** Where `path` is after what was at `from` moved to `to`; itself when it was not inside it. */
export function movedPath(path: string, from: string, to: string): string {
  return within(path, from) ? to + path.slice(from.length) : path
}
