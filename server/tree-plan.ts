// What a change to the documentation tree commits: which files and folders
// move, which meta files are written and which links are rewritten. Each
// plan refuses, with the reason in words, what the tree can't take. No host
// imports, so it runs under `node --test` directly.

import { slugify } from '../src/docs/slug.ts'
import { findMentions, rewriteLinks, type UnrewrittenLink } from './doc-links.ts'
import {
  type FolderChild,
  type FolderMeta,
  META_FILE,
  metaPathOf,
  orderChildren,
  parseMeta,
  placeInOrder,
  serializeMeta,
} from './doc-meta.ts'
import { isListed } from './doc-tree.ts'
import { pageTitle } from './page-title.ts'
import { type Rename, renamedPath, type TreeChange } from './tree-commit.ts'

/** The clone as a plan reads it. */
export interface TreeState {
  /** Every file in the last commit. */
  head: string[]
  /** Every file in the working tree, dot-folders left out. */
  working: string[]
  /** Each folder's meta, by folder ('' is the root); a folder without a meta file is absent. */
  metas: Map<string, FolderMeta>
}

/** What a plan commits, before its links are rewritten. */
export interface TreePlan {
  renames: Rename[]
  /** Meta files and pages the commit holds, by path after the renames. */
  published: Map<string, string>
  message: string
  /** Where the page or folder the plan acts on ends up. */
  path: string
}

/** Names a page keeps whatever its title: a folder's own page, and the page a forge shows for a folder. */
const KEPT_NAMES = new Set(['index.md', 'readme.md'])

function dirOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

function baseOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function join(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name
}

function folderLabel(folder: string): string {
  return folder ? `"${folder}"` : 'the top level'
}

/** Every page the tree lists, published or a draft. */
function listedPages(state: TreeState): string[] {
  return [...new Set([...state.head, ...state.working])].filter(isListed)
}

/** A folder's entries the tree shows: its pages, and its subfolders that hold a page. */
function childrenOf(state: TreeState, folder: string): FolderChild[] {
  const prefix = folder ? `${folder}/` : ''
  const children = new Map<string, FolderChild>()
  for (const page of listedPages(state)) {
    if (!page.startsWith(prefix)) {
      continue
    }
    const rest = page.slice(prefix.length)
    const slash = rest.indexOf('/')
    const name = slash < 0 ? rest : rest.slice(0, slash)
    children.set(name, { name, type: slash < 0 ? 'file' : 'directory' })
  }
  return [...children.values()]
}

/** The names of a folder's entries in the order the tree shows them. */
export function shownOrder(state: TreeState, folder: string): string[] {
  return orderChildren(childrenOf(state, folder), state.metas.get(folder)?.order).map((child) => child.name)
}

function isFolder(state: TreeState, path: string): boolean {
  return listedPages(state).some((page) => page.startsWith(`${path}/`))
}

function isPage(state: TreeState, path: string): boolean {
  return listedPages(state).includes(path)
}

/**
 * Whether `name` is taken in `folder` by anything other than `except`: a file
 * or folder of that name, or -- since the tree shows a page without its
 * `.md` -- a page and a folder that would carry the same label.
 */
function nameTaken(state: TreeState, folder: string, name: string, except?: string): boolean {
  const prefix = folder ? `${folder}/` : ''
  const label = name.endsWith('.md') ? name.slice(0, -3) : name
  const clashes = new Set([label, `${label}.md`])
  for (const path of new Set([...state.head, ...state.working])) {
    if (!path.startsWith(prefix)) {
      continue
    }
    const entry = path.slice(prefix.length).split('/')[0]
    if (entry !== except && clashes.has(entry)) {
      return true
    }
  }
  return false
}

/** `folder` as given by a caller: '' for the root; refused when it names no place a folder can be. */
export function cleanFolder(folder: string | undefined): string {
  const clean = (folder ?? '').trim().replace(/^\/+|\/+$/g, '')
  if (clean !== '' && clean.split('/').some((segment) => segment === '' || segment.startsWith('.'))) {
    throw new Error(`"${folder}" is not a folder of the documentation.`)
  }
  return clean
}

function metaText(state: TreeState, folder: string, changes: FolderMeta): string {
  return serializeMeta({ ...state.metas.get(folder), ...changes })
}

/** Whether anything at `path` -- a page, or a folder's files -- is in the last commit. */
function isCommitted(state: TreeState, path: string): boolean {
  return state.head.some((file) => file === path || file.startsWith(`${path}/`))
}

/**
 * The plan with each meta file it writes naming only what its commit holds.
 * A draft-only page is not in git, so the commit's order leaves it out and the
 * tree shows it after the listed entries until it is published; a name the
 * folder doesn't hold is dropped. A meta file this leaves as committed is not
 * written.
 */
function committedOrder(state: TreeState, plan: TreePlan): TreePlan {
  const files = [...state.head.map((file) => renamedPath(file, plan.renames)), ...plan.published.keys()]
  const published = new Map<string, string>()
  for (const [path, text] of plan.published) {
    if (baseOf(path) !== META_FILE) {
      published.set(path, text)
      continue
    }
    const folder = dirOf(path)
    const prefix = folder ? `${folder}/` : ''
    const held = new Set(
      files.filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length).split('/')[0]),
    )
    const meta = parseMeta(text)
    const committed = serializeMeta({ ...meta, order: meta.order?.filter((name) => held.has(name)) })
    const unchanged = state.head.includes(path) && committed === serializeMeta(state.metas.get(folder) ?? {})
    if (!unchanged) {
      published.set(path, committed)
    }
  }
  return { ...plan, published }
}

/**
 * Moves the page or folder at `path` into `toFolder`, at `position` among the
 * entries already there (the end when not given). Within its own folder this
 * reorders it.
 */
export function planMove(state: TreeState, path: string, toFolder: string, position?: number): TreePlan {
  const folder = isFolder(state, path)
  if (!folder && !isPage(state, path)) {
    throw new Error(`There is no page or folder "${path}".`)
  }
  const target = cleanFolder(toFolder)
  const from = dirOf(path)
  const name = baseOf(path)
  const published = new Map<string, string>()

  if (target === from) {
    if (!isCommitted(state, path)) {
      throw new Error(
        `"${name}" isn't published yet, so it can't be placed: it's listed after the published entries, and keeps the place it's given once it's published.`,
      )
    }
    published.set(
      metaPathOf(from),
      metaText(state, from, {
        order: placeInOrder(shownOrder(state, from), name, position ?? Number.POSITIVE_INFINITY),
      }),
    )
    return committedOrder(state, { renames: [], published, message: `Reorder ${from || 'the top level'}`, path })
  }
  if (folder && (target === path || target.startsWith(`${path}/`))) {
    throw new Error("A folder can't be moved into itself.")
  }
  if (nameTaken(state, target, name)) {
    throw new Error(`${folderLabel(target)} already has a page or folder named "${name}".`)
  }

  const to = join(target, name)
  const left = placeInOrder(shownOrder(state, from), name)
  // A folder the move empties keeps its meta as it was.
  if (left.length > 0) {
    published.set(metaPathOf(from), metaText(state, from, { order: left }))
  }
  published.set(
    metaPathOf(target),
    metaText(state, target, {
      order: placeInOrder(shownOrder(state, target), name, position ?? Number.POSITIVE_INFINITY),
    }),
  )
  return committedOrder(state, {
    renames: [{ from: path, to }],
    published,
    message: `Move ${path} to ${target || 'the top level'}`,
    path: to,
  })
}

/** Gives the folder at `path` the title `title`, its name on disk following the title. */
export function planFolderTitle(state: TreeState, path: string, title: string): TreePlan {
  if (!path) {
    throw new Error('The top level has no title.')
  }
  if (!isFolder(state, path)) {
    throw new Error(`There is no folder "${path}".`)
  }
  const clean = title.replace(/\s+/g, ' ').trim()
  if (!clean) {
    throw new Error("A folder's title can't be empty.")
  }
  const name = slugify(clean)
  if (!name) {
    throw new Error(`"${clean}" has no letters or digits to name the folder with.`)
  }
  const parent = dirOf(path)
  const current = baseOf(path)
  const published = new Map<string, string>()
  if (name === current) {
    published.set(metaPathOf(path), metaText(state, path, { title: clean }))
    return committedOrder(state, { renames: [], published, message: `Retitle ${path} "${clean}"`, path })
  }
  if (nameTaken(state, parent, name, current)) {
    throw new Error(`${folderLabel(parent)} already has a page or folder named "${name}".`)
  }
  const to = join(parent, name)
  published.set(metaPathOf(to), metaText(state, path, { title: clean }))
  published.set(
    metaPathOf(parent),
    metaText(state, parent, { order: shownOrder(state, parent).map((entry) => (entry === current ? name : entry)) }),
  )
  return committedOrder(state, {
    renames: [{ from: path, to }],
    published,
    message: `Rename ${path} to ${to}`,
    path: to,
  })
}

/**
 * Checks that the page at `path` can be published as `draft`, and where: the
 * file named after its title. Null when it publishes where it is.
 */
export function planPublish(state: TreeState, path: string, draft: string, message: string): TreePlan | null {
  const title = pageTitle(draft)
  if (title === null) {
    throw new Error('Not published: a page has to start with its title, a level-1 heading ("# Title").')
  }
  if (!title) {
    throw new Error("Not published: the page's title is empty. Write it on the first line.")
  }
  const current = baseOf(path)
  if (KEPT_NAMES.has(current.toLowerCase())) {
    return null
  }
  const slug = slugify(title)
  if (!slug) {
    throw new Error(`Not published: the title "${title}" has no letters or digits to name the page's file with.`)
  }
  const name = `${slug}.md`
  if (name === current) {
    return null
  }
  const folder = dirOf(path)
  if (nameTaken(state, folder, name, current)) {
    throw new Error(
      `Not published: ${folderLabel(folder)} already has a page or folder named "${slug}". Give the page another title.`,
    )
  }
  const to = join(folder, name)
  const published = new Map([[to, draft]])
  published.set(
    metaPathOf(folder),
    metaText(state, folder, { order: shownOrder(state, folder).map((entry) => (entry === current ? name : entry)) }),
  )
  return committedOrder(state, { renames: [{ from: path, to }], published, message, path: to })
}

/** The clone's pages as the link rewrite reads them. */
export interface LinkSources {
  /** A page's text in the last commit. */
  readHead(path: string): Promise<string>
  /** Committed pages that may link to what moves; other committed pages are not read. */
  candidates: string[]
  /** Every page whose working text differs from the last commit -- drafts, and pages only in the working tree -- with that text. */
  drafts: Map<string, string>
}

/**
 * The old paths a page may still mention after `renames`: each page's or
 * folder's path (a folder's ending in `/`), and a page's old file name when
 * the rename changed it.
 */
function mentionNeedles(renames: Rename[]): string[] {
  const needles = new Set<string>()
  for (const { from, to } of renames) {
    if (isListed(from)) {
      needles.add(from)
      if (baseOf(from) !== baseOf(to)) {
        needles.add(baseOf(from))
      }
    } else {
      needles.add(`${from}/`)
    }
  }
  return [...needles]
}

/**
 * The plan as one commit: every relative link to what moves, and from what
 * moves, rewritten in the published pages and in the drafts, and every
 * mention of an old path reported. `publishing` is the page whose draft the
 * plan publishes, which has no draft afterwards.
 */
export async function withLinks(
  state: TreeState,
  plan: TreePlan,
  sources: LinkSources,
  publishing?: string,
): Promise<{ change: TreeChange; unrewritten: UnrewrittenLink[] }> {
  const published = new Map(plan.published)
  const drafts = new Map<string, string>()
  const unrewritten = new Map<string, UnrewrittenLink>()
  const note = (links: UnrewrittenLink[]) => {
    for (const link of links) {
      unrewritten.set(`${link.file}:${link.line}:${link.link}`, link)
    }
  }
  const map = (path: string) => renamedPath(path, plan.renames)
  const hasDraft = (path: string) => sources.drafts.has(path) && path !== publishing

  if (plan.renames.length > 0) {
    const needles = mentionNeedles(plan.renames)
    const moved = state.head.filter((path) => isListed(path) && map(path) !== path)
    const rewritten = new Set([...moved, ...sources.candidates, ...(publishing ? [publishing] : [])])
    for (const from of rewritten) {
      const to = map(from)
      const base = published.get(to) ?? (await sources.readHead(from))
      const { text, unrewritten: left } = rewriteLinks(base, from, to, map)
      note(left)
      note(findMentions(text, to, needles))
      if (text !== base || published.has(to) || (to !== from && hasDraft(from))) {
        published.set(to, text)
      }
    }
    for (const [from, draft] of sources.drafts) {
      if (from === publishing) {
        continue
      }
      const to = map(from)
      const { text, unrewritten: left } = rewriteLinks(draft, from, to, map)
      note(left)
      note(findMentions(text, to, needles))
      if (text !== draft || published.has(to)) {
        drafts.set(to, text)
      }
    }
  }

  return {
    change: { renames: plan.renames, published, drafts, message: plan.message },
    unrewritten: [...unrewritten.values()],
  }
}
