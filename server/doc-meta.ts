// A folder's meta file: its title and the order of its entries. No host
// imports, so it runs under `node --test` directly.

/** The meta file's name inside every folder, the repository's root included. */
export const META_FILE = '_meta.json'

/**
 * What a folder's meta file holds. `order` names the folder's entries as they
 * are shown: a page by its file name (`intro.md`), a subfolder by its name.
 * The root has no title.
 */
export interface FolderMeta {
  title?: string
  order?: string[]
}

/** One entry of a folder, as its meta file names it. */
export interface FolderChild {
  name: string
  type: 'file' | 'directory'
}

/** The meta file of `folder` ('' is the root). */
export function metaPathOf(folder: string): string {
  return folder ? `${folder}/${META_FILE}` : META_FILE
}

/**
 * A meta file's content as a meta. Anything that is not a meta -- no file,
 * broken JSON, fields of the wrong type -- reads as the parts that are, so a
 * hand-edited file never takes the tree down.
 */
export function parseMeta(text: string | null): FolderMeta {
  if (!text) {
    return {}
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return {}
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  const { title, order } = raw as Record<string, unknown>
  const meta: FolderMeta = {}
  if (typeof title === 'string' && title.trim()) {
    meta.title = title.trim()
  }
  if (Array.isArray(order)) {
    meta.order = order.filter((name): name is string => typeof name === 'string')
  }
  return meta
}

/** A meta as its file is written: two-space JSON, a final newline, empty fields left out. */
export function serializeMeta(meta: FolderMeta): string {
  const out: FolderMeta = {}
  if (meta.title) {
    out.title = meta.title
  }
  if (meta.order && meta.order.length > 0) {
    out.order = meta.order
  }
  return `${JSON.stringify(out, null, 2)}\n`
}

function byTypeThenName(a: FolderChild, b: FolderChild): number {
  if (a.type !== b.type) {
    return a.type === 'directory' ? -1 : 1
  }
  return a.name.localeCompare(b.name)
}

/**
 * A folder's entries in the order they are shown: the ones `order` names, in
 * its order, then the rest -- folders first, then pages, each by name. A name
 * in `order` the folder doesn't hold is skipped.
 */
export function orderChildren<T extends FolderChild>(children: T[], order: string[] | undefined): T[] {
  const byName = new Map(children.map((child) => [child.name, child]))
  const listed: T[] = []
  for (const name of order ?? []) {
    const child = byName.get(name)
    if (child) {
      listed.push(child)
      byName.delete(name)
    }
  }
  return [...listed, ...[...byName.values()].sort(byTypeThenName)]
}

/**
 * The names of a folder's entries in the order shown, with `name` taken out
 * and, when `at` is given, put back at that position among the others
 * (clamped to the ends; past the end appends).
 */
export function placeInOrder(shown: string[], name: string, at?: number): string[] {
  const others = shown.filter((entry) => entry !== name)
  if (at === undefined) {
    return others
  }
  const index = Math.max(0, Math.min(Math.trunc(at), others.length))
  return [...others.slice(0, index), name, ...others.slice(index)]
}
