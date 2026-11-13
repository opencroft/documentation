// The documentation tree a reader browses: every published page, plus the
// pages that exist only as a draft in the working tree, marked as such.
// Each folder is in its meta file's order, under its meta file's title; each
// page under its title.

import { type FolderMeta, orderChildren } from './doc-meta.ts'

export interface DocEntry {
  /** The file or folder name on disk. */
  name: string
  path: string
  type: 'file' | 'directory'
  /** What the tree shows: a page's title, a folder's title from its meta; the name when there is none. */
  title: string
  /** A file with no published version yet: it exists only in the working tree. */
  draft?: boolean
  children?: DocEntry[]
}

/** Whether a repository path is a page the tree lists: a `.md` file outside dot-folders. */
export function isListed(path: string): boolean {
  const segments = path.split('/')
  return path.endsWith('.md') && !segments.some((s) => s === '' || s.startsWith('.'))
}

/** What the tree is labelled with, beside the paths. */
export interface DocTreeLabels {
  /** Each folder's meta, by folder path ('' is the root). */
  metas?: Map<string, FolderMeta>
  /** Each page's title, by path. */
  titles?: Map<string, string>
}

/**
 * The tree of `.md` pages in `published` and `working` (repository-relative
 * paths), anything under a dot-directory left out. A path only in `working`
 * is a draft. Each folder's entries come in its meta's order (see
 * `orderChildren`).
 */
export function buildDocTree(published: string[], working: string[], labels: DocTreeLabels = {}): DocEntry[] {
  const publishedSet = new Set(published.filter(isListed))
  const all = new Set([...publishedSet, ...working.filter(isListed)])
  const root: DocEntry[] = []
  const directories = new Map<string, DocEntry>()

  const childrenOf = (dirPath: string): DocEntry[] => {
    if (!dirPath) {
      return root
    }
    const existing = directories.get(dirPath)
    if (existing) {
      return existing.children as DocEntry[]
    }
    const slash = dirPath.lastIndexOf('/')
    const name = dirPath.slice(slash + 1)
    const title = labels.metas?.get(dirPath)?.title ?? name
    const dir: DocEntry = { name, path: dirPath, type: 'directory', title, children: [] }
    directories.set(dirPath, dir)
    childrenOf(slash < 0 ? '' : dirPath.slice(0, slash)).push(dir)
    return dir.children as DocEntry[]
  }

  for (const path of all) {
    const slash = path.lastIndexOf('/')
    const name = path.slice(slash + 1)
    const file: DocEntry = { name, path, type: 'file', title: labels.titles?.get(path) || name.replace(/\.md$/, '') }
    if (!publishedSet.has(path)) {
      file.draft = true
    }
    childrenOf(slash < 0 ? '' : path.slice(0, slash)).push(file)
  }

  const sortDeep = (folder: string, entries: DocEntry[]): DocEntry[] => {
    for (const entry of entries) {
      if (entry.children) {
        entry.children = sortDeep(entry.path, entry.children)
      }
    }
    return orderChildren(entries, labels.metas?.get(folder)?.order)
  }
  return sortDeep('', root)
}
