// Committing a change to the documentation tree -- pages and folders moved,
// meta files and links rewritten -- while pages have drafts in the clone. No
// host here: `git` runs one git command in the clone, `files` reads and writes
// its working tree, and `push` publishes the commit just made.
//
// A draft is the page's file in the working tree, staged as it is saved, so
// the working tree and the index hold drafts, not what is published. The
// commit therefore names its paths (`git commit --only`): for each one it
// takes the working tree's content, which is set to the published text for the
// commit and put back to the draft after it. Other pages' drafts are not in
// the commit, and the moved pages' drafts move along and stay drafts.
//
// Should anything fail before the push lands, the clone is put back as it was,
// drafts included, and the error is thrown.

export type Git = (...args: string[]) => Promise<string>

/** The clone's working tree, by repository-relative path. */
export interface WorkingFiles {
  /** A file's text; null when there is none. */
  read(path: string): Promise<string | null>
  /** Writes a file, creating its folders. */
  write(path: string, content: string): Promise<void>
  /** Removes a file, if there is one. */
  remove(path: string): Promise<void>
  /** Moves a file or a folder, creating the folders it goes into and removing the ones it leaves empty. */
  rename(from: string, to: string): Promise<void>
}

export interface Rename {
  from: string
  to: string
}

/** One change to the tree, as one commit. */
export interface TreeChange {
  /** Files and folders moved, drafts along with them. */
  renames: Rename[]
  /** What the commit holds at these paths (after the renames), where the working tree holds something else or nothing yet. */
  published: Map<string, string>
  /** Drafts laid over the commit afterwards, at paths after the renames. */
  drafts: Map<string, string>
  message: string
}

function nulSplit(output: string): string[] {
  return output.split('\0').filter(Boolean)
}

/** Where `path` goes under `renames`; itself when it stays. */
export function renamedPath(path: string, renames: Rename[]): string {
  for (const { from, to } of renames) {
    if (path === from) {
      return to
    }
    if (path.startsWith(`${from}/`)) {
      return to + path.slice(from.length)
    }
  }
  return path
}

/** Where `path` came from under `renames`; itself when it did not move. */
function originalPath(path: string, renames: Rename[]): string {
  return renamedPath(
    path,
    renames.map(({ from, to }) => ({ from: to, to: from })),
  )
}

function under(paths: string[], root: string): string[] {
  return paths.filter((path) => path === root || path.startsWith(`${root}/`))
}

/**
 * Makes `change` as one commit by `commitArgs` (the author's git options),
 * pushes it with `push`, and lays the drafts back. Returns the commit's sha,
 * or null when nothing published changed (a draft-only page moved alone).
 */
export async function commitTreeChange(
  git: Git,
  files: WorkingFiles,
  change: TreeChange,
  commitArgs: string[],
  push: () => Promise<void>,
): Promise<string | null> {
  const { renames } = change
  const head = nulSplit(await git('ls-tree', '-r', '-z', '--name-only', 'HEAD'))
  const indexed = nulSplit(await git('ls-files', '-z'))
  const overridden = [...new Set([...change.published.keys(), ...change.drafts.keys()])]

  // What the clone holds before anything changes, to put back on failure.
  const before = new Map<string, string | null>()
  for (const path of overridden) {
    const original = originalPath(path, renames)
    before.set(original, await files.read(original))
  }
  const indexedBefore = renames.flatMap(({ from }) => under(indexed, from))

  const restore = async () => {
    for (const { from, to } of [...renames].reverse()) {
      await files.rename(to, from).catch(() => {})
      await git('rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', to)
    }
    for (const [path, content] of before) {
      if (content === null) {
        await files.remove(path)
        await git('rm', '-q', '--cached', '--ignore-unmatch', '--', path)
      } else {
        await files.write(path, content)
        await git('add', '--', path)
      }
    }
    const restaged = indexedBefore.filter((path) => !before.has(path))
    if (restaged.length > 0) {
      await git('add', '--', ...restaged)
    }
  }

  let committed = false
  try {
    for (const { from, to } of renames) {
      await files.rename(from, to)
      await git('rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', from)
      const moved = under(indexed, from).map((path) => renamedPath(path, [{ from, to }]))
      if (moved.length > 0) {
        await git('add', '--', ...moved)
      }
    }
    for (const [path, content] of change.published) {
      await files.write(path, content)
    }
    if (change.published.size > 0) {
      await git('add', '--', ...change.published.keys())
    }

    const movedHead = renames.flatMap(({ from }) => under(head, from))
    const paths = [
      ...new Set([...movedHead, ...movedHead.map((path) => renamedPath(path, renames)), ...change.published.keys()]),
    ]
    if (paths.length > 0) {
      await git(...commitArgs, 'commit', '--quiet', '-m', change.message, '--only', '--', ...paths)
      committed = true
      await push()
    }
  } catch (err) {
    if (committed) {
      await git('reset', '--soft', 'HEAD~1')
    }
    await restore()
    throw err
  }

  for (const [path, content] of change.drafts) {
    await files.write(path, content)
  }
  if (change.drafts.size > 0) {
    await git('add', '--', ...change.drafts.keys())
  }
  return committed ? (await git('rev-parse', 'HEAD')).trim() : null
}
