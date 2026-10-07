// Where a new page goes: its file is named from its title, inside a folder
// picked from the documentation tree. '' is the repository's root folder.

import { slugify } from './slug.ts'
import type { DocEntry } from './types'

export interface FolderNode {
  name: string
  path: string
  children: FolderNode[]
}

/** The file a page titled `title` is saved as, `<slug>.md`; null when the title has nothing to spell one with. */
export function docFileName(title: string): string | null {
  const slug = slugify(title)
  return slug ? `${slug}.md` : null
}

/**
 * What already holds the name `slug` inside `folder`, among `taken` paths: a
 * page `<slug>.md`, a folder `<slug>`, or nothing. The tree shows a page
 * without its `.md`, so a page and a folder beside it would carry the same
 * label; either one takes the name.
 */
export function nameHolder(taken: Set<string>, folder: string, slug: string): 'page' | 'folder' | null {
  if (taken.has(joinPath(folder, `${slug}.md`))) {
    return 'page'
  }
  return taken.has(joinPath(folder, slug)) ? 'folder' : null
}

/** `name` inside `folder`. */
export function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name
}

/** The folder holding `docPath`; the root when there is no page. */
export function folderOf(docPath: string | null): string {
  return docPath ? docPath.slice(0, Math.max(docPath.lastIndexOf('/'), 0)) : ''
}

/** The folders that contain `path`, outermost first; none for the root or a top-level entry. */
export function ancestorsOf(path: string): string[] {
  const parts = path ? path.split('/') : []
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
}

/** Every path the tree holds, pages and folders alike. */
export function treePaths(entries: DocEntry[]): Set<string> {
  const paths = new Set<string>()
  const visit = (list: DocEntry[]) => {
    for (const entry of list) {
      paths.add(entry.path)
      visit(entry.children ?? [])
    }
  }
  visit(entries)
  return paths
}

/**
 * The tree's folders, plus `added` ones that exist nowhere yet (a folder is
 * only written once a page is saved into it), each level in name order.
 */
export function folderTree(entries: DocEntry[], added: string[]): FolderNode[] {
  const root: FolderNode[] = []
  const byPath = new Map<string, FolderNode>()

  const place = (path: string): FolderNode[] => {
    if (!path) {
      return root
    }
    const known = byPath.get(path)
    if (known) {
      return known.children
    }
    const slash = path.lastIndexOf('/')
    const node: FolderNode = { name: path.slice(slash + 1), path, children: [] }
    byPath.set(path, node)
    place(slash < 0 ? '' : path.slice(0, slash)).push(node)
    return node.children
  }

  const visit = (list: DocEntry[]) => {
    for (const entry of list) {
      if (entry.type === 'directory') {
        place(entry.path)
        visit(entry.children ?? [])
      }
    }
  }
  visit(entries)
  for (const path of added) {
    place(path)
  }

  const sortDeep = (nodes: FolderNode[]): FolderNode[] => {
    nodes.sort((a, b) => a.name.localeCompare(b.name))
    for (const node of nodes) {
      sortDeep(node.children)
    }
    return nodes
  }
  return sortDeep(root)
}
