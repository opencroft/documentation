// The documentation tree a reader browses: every published page, plus the
// pages that exist only as a draft in the working tree, marked as such so the
// reading view can say a page is not published instead of showing its draft.

export interface DocEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  /** A file with no published version yet: it exists only in the working tree. */
  draft?: boolean
  children?: DocEntry[]
}

function isListed(path: string): boolean {
  const segments = path.split('/')
  return path.endsWith('.md') && !segments.some((s) => s === '' || s.startsWith('.'))
}

function sortEntries(entries: DocEntry[]): DocEntry[] {
  return entries.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
}

/**
 * The tree of `.md` pages in `published` and `working` (repository-relative
 * paths): directories first, then names in locale order, anything under a
 * dot-directory left out. A path only in `working` is a draft.
 */
export function buildDocTree(published: string[], working: string[]): DocEntry[] {
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
    const dir: DocEntry = { name: dirPath.slice(slash + 1), path: dirPath, type: 'directory', children: [] }
    directories.set(dirPath, dir)
    childrenOf(slash < 0 ? '' : dirPath.slice(0, slash)).push(dir)
    return dir.children as DocEntry[]
  }

  for (const path of all) {
    const slash = path.lastIndexOf('/')
    const file: DocEntry = { name: path.slice(slash + 1), path, type: 'file' }
    if (!publishedSet.has(path)) {
      file.draft = true
    }
    childrenOf(slash < 0 ? '' : path.slice(0, slash)).push(file)
  }

  const sortDeep = (entries: DocEntry[]): DocEntry[] => {
    for (const entry of entries) {
      if (entry.children) {
        sortDeep(entry.children)
      }
    }
    return sortEntries(entries)
  }
  return sortDeep(root)
}
