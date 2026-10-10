// Who a published page's commit is attributed to. No host imports, so it runs
// under `node --test` directly.

/** The name a commit carries when nobody can be named. */
export const UNNAMED_AUTHOR = 'OpenCroft'

/**
 * Git options naming `author` as both author and committer of the one command
 * they precede, with no email. Given per commit rather than written to the
 * clone's config, so the next commit -- someone else's -- never inherits it.
 * Git refuses a commit with no email configured, and accepts an empty one.
 */
export function commitAs(author: string): string[] {
  // `<`, `>` and line breaks would corrupt the ident line git writes.
  const name =
    author
      .replace(/[<>\r\n]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || UNNAMED_AUTHOR
  return ['-c', `user.name=${name}`, '-c', 'user.email=']
}
