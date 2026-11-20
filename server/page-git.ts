// Git over one page of the clone: publishing its draft and dropping it. No
// host here: `clone` runs one git command in the clone.
//
// A draft is the page's file in the working tree, staged as it is saved, so
// the index holds every page's draft. Each command below names the page by its
// path, and git reads a path as a pattern unless told otherwise: the page
// `n[1]/intro.md` would also name `n1/intro.md`, and `q?.md` would name
// `q1.md`, and the command would then publish or drop their drafts too.

import type { Git } from './tree-commit.ts'

/** `clone` with every path taken as a name, never as a pattern. */
export function literalPaths(clone: Git): Git {
  return (...args) => clone('--literal-pathspecs', ...args)
}

/**
 * Commits the page's draft, and nothing else, as one commit by `commitArgs`
 * (the author's git options). The page is staged first, so a page that has
 * never been published is committed too. Other pages' drafts stay staged and
 * out of the commit. Throws, committing nothing, when the page does not differ
 * from the last commit.
 */
export async function commitPage(clone: Git, path: string, message: string, commitArgs: string[]): Promise<void> {
  const git = literalPaths(clone)
  await git('add', '--', path)
  // `diff --quiet` exits 1 when the page differs from the last commit.
  const unchanged = await git('diff', '--cached', '--quiet', 'HEAD', '--', path).then(
    () => true,
    () => false,
  )
  if (unchanged) {
    throw new Error(`Nothing to publish: ${path} has no changes.`)
  }
  // `commit -- <path>` (the `--only` form) takes the page alone, whatever else is staged.
  await git(...commitArgs, 'commit', '-m', message, '--', path)
}

/**
 * Drops the page's draft. A page in the last commit goes back to it, in the
 * index and the working tree. A page that has never been committed is
 * unstaged, and `removeFile` deletes its file.
 */
export async function discardPage(clone: Git, path: string, removeFile: () => Promise<void>): Promise<void> {
  const git = literalPaths(clone)
  const inHead = await git('cat-file', '-e', `HEAD:${path}`).then(
    () => true,
    () => false,
  )
  if (inHead) {
    // From HEAD, index and working tree both: a draft is staged as it is
    // saved, and `checkout -- path` alone restores the staged draft.
    await git('checkout', 'HEAD', '--', path)
    return
  }
  // Unstaged when staged; a page only in the working tree has nothing to unstage.
  await git('rm', '--cached', '--quiet', '--ignore-unmatch', '--', path).catch(() => {})
  await removeFile()
}
