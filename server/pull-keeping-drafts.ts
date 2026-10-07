// Bringing a clone up to date with its remote while pages have drafts in it.
//
// Drafts are staged as they are saved, and a rebase will not start over
// staged changes, so they are set aside for it and put back after it
// (`--autostash`). Putting a draft back over a page the remote also changed
// can conflict -- and git then reports success, leaving the page with
// conflict markers, an unmerged index entry and the draft stranded in a
// stash. So a page with a draft here that changed upstream is not pulled
// over: the pull is refused before anything changes, naming the pages. And
// should anything be left unmerged regardless, the clone is put back as it
// was, drafts included, and the pull fails.
//
// No host here: `git` runs one git command in the clone and resolves with
// its output, or rejects when it fails.

export type Git = (...args: string[]) => Promise<string>

function paths(output: string): string[] {
  return output.split('\0').filter(Boolean)
}

/** Every path with a change of its own in the clone -- staged, unstaged or untracked. */
function draftedPaths(statusZ: string): string[] {
  const entries = paths(statusZ)
  const found: string[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    found.push(entry.slice(3))
    // A rename or copy is followed by the path it came from.
    if (entry[0] === 'R' || entry[0] === 'C') {
      found.push(entries[++i])
    }
  }
  return found
}

async function stashCount(git: Git): Promise<number> {
  return (await git('stash', 'list')).split('\n').filter(Boolean).length
}

/**
 * Rebases the clone onto `origin/<branch>`, keeping every draft. Throws --
 * having changed nothing -- when a page with a draft changed upstream, or
 * when the rebase itself fails.
 */
export async function pullKeepingDrafts(git: Git, branch: string): Promise<void> {
  const upstream = `refs/remotes/origin/${branch}`
  await git('fetch', '--quiet', 'origin', `+refs/heads/${branch}:${upstream}`)

  const incoming = new Set(paths(await git('diff', '--name-only', '-z', `HEAD...${upstream}`)))
  const clashing = [...new Set(draftedPaths(await git('status', '--porcelain', '-z')))].filter((path) =>
    incoming.has(path),
  )
  if (clashing.length > 0) {
    throw new Error(
      `Not pulled: ${clashing.join(', ')} ${clashing.length === 1 ? 'has a draft here and was' : 'have drafts here and were'} ` +
        'changed in the remote too. Publish or discard the draft, then pull again.',
    )
  }

  const stashes = await stashCount(git)
  try {
    await git('rebase', '--autostash', upstream)
  } catch (err) {
    // A rebase stopped on a conflict between commits leaves the clone mid-way.
    await git('rebase', '--abort').catch(() => {})
    throw err
  }

  const unmerged = paths(await git('diff', '--name-only', '-z', '--diff-filter=U'))
  if (unmerged.length > 0 || (await stashCount(git)) > stashes) {
    // The drafts did not go back cleanly: back to before the pull, drafts
    // and all -- the stash git kept them in is the one just made.
    await git('reset', '--hard', 'ORIG_HEAD')
    await git('stash', 'pop', '--index')
    throw new Error(
      `Not pulled: the drafts of ${unmerged.join(', ') || 'some pages'} could not be kept over the remote's changes. ` +
        'Nothing changed here; publish or discard those drafts, then pull again.',
    )
  }
}
