import host from '@opencroft/server'

import { commitAs } from './commit-identity'
import { pullKeepingDrafts } from './pull-keeping-drafts'
import { throttledRefresh, waitAtMost } from './refresh-throttle'

// ─── Types ──────────────────────────────────────────────────────────────

interface DocsSourceData {
  name?: string
  repoUrl: string
  branch: string
  secretId: string | null
}

// ─── App instances are the docs sources ─────────────────────────────────
// A documentation source is a Documentation App instance (added to a space
// via provides.apps): its clone lives in the instance's host-managed data
// dir, and its instanceId is the source id everywhere below. Feature-detect
// host.apps for hosts predating the Apps API.

interface HostAppInstance {
  instanceId: string
  appSlug: string
  spaceSlug: string
  /** The instance's display name — the host's field, required at add time. */
  name: string
  /** The instance's slug — unique in its space; `<spaceSlug>.<slug>` is its address. */
  slug: string
  params: Record<string, string>
  dataDir: string
}

const hostApps = (host as unknown as { apps?: { listInstances(appSlug?: string): Promise<HostAppInstance[]> } })
  .apps

export async function listDocAppInstances(): Promise<HostAppInstance[]> {
  if (!hostApps) return []
  try {
    return await hostApps.listInstances('documentation')
  } catch {
    return []
  }
}

async function findAppInstance(id: string): Promise<HostAppInstance | null> {
  return (await listDocAppInstances()).find((instance) => instance.instanceId === id) ?? null
}

/** The clone directory of one documentation source — its App instance's private data dir. */
async function docsRepoDir(sourceId: string): Promise<string> {
  const instance = await findAppInstance(sourceId)
  if (!instance) {
    throw new Error(`Unknown documentation source: ${sourceId}`)
  }
  return instance.dataDir
}

async function getSourceData(sourceId: string): Promise<DocsSourceData> {
  const instance = await findAppInstance(sourceId)
  if (!instance) {
    throw new Error(`Unknown documentation source: ${sourceId}`)
  }
  return {
    name: instance.name,
    repoUrl: instance.params.repoUrl ?? '',
    branch: instance.params.branch || 'main',
    // Routed back through resolveSecrets so every consumer (pull, publish)
    // authenticates the same way.
    secretId: instance.params.tokenSecret ? `app:${instance.instanceId}` : null,
  }
}

// App instance auth: the token lives at the `<storeId>/<key>` address the
// user picked in the form; the username is a plain param.
async function resolveSecrets(secretId: string | null): Promise<{ username?: string; token?: string }> {
  if (!secretId?.startsWith('app:')) {
    return {}
  }
  const instance = await findAppInstance(secretId.slice('app:'.length))
  const address = instance?.params.tokenSecret ?? ''
  const slash = address.indexOf('/')
  if (!instance || slash <= 0 || slash === address.length - 1) {
    return {}
  }
  try {
    const token = await host.secrets.get(address.slice(0, slash), address.slice(slash + 1))
    return { username: instance.params.username || 'x-access-token', token: token ?? undefined }
  } catch (err) {
    console.error('[docs-git] Failed to resolve app instance secret:', err)
    return {}
  }
}

function buildAuthUrl(repoUrl: string, username?: string, token?: string): string {
  if (!username || !token) return repoUrl
  try {
    const url = new URL(repoUrl)
    url.username = username
    url.password = token
    return url.toString()
  } catch {
    // If URL parsing fails, return as-is
    return repoUrl
  }
}

// `core.quotePath=false`: a path outside ASCII is printed as itself, not as a
// quoted octal escape that matches no file the tree lists.
async function gitExec(repoDir: string, ...args: string[]): Promise<string> {
  return host.execFile('git', ['-c', 'safe.directory=*', '-c', 'core.quotePath=false', '-C', repoDir, ...args])
}

function isCloned(repoDir: string): Promise<boolean> {
  return host.fs
    .access(`${repoDir}/.git`)
    .then(() => true)
    .catch(() => false)
}

// ─── The published version ──────────────────────────────────────────────
// What readers see is the branch as the REMOTE has it: pages and edits that
// reached it through publish, from this instance or from anywhere else. Not
// the clone's HEAD, which holds only what this clone last pulled plus any
// commit whose push never landed, and not the working tree, which holds
// drafts. The remote-tracking ref is kept current by a fetch, at most once
// per interval per source, before anything reads it.
//
// A read waits for that fetch only briefly: past the wait it goes ahead with
// the ref as last fetched, which always exists (the clone creates it, and a
// publish or delete pushing through `origin` moves it). A stalled forge
// therefore slows a read by the wait at most, never holds it. The fetch
// itself aborts a transfer that stalls, so a hung one does not hold the
// refresh for good.

const PUBLISHED_REFRESH_INTERVAL_MS = 30_000
const PUBLISHED_REFRESH_WAIT_MS = 3_000
/** Below this many bytes per second for the time after it, the fetch gives up. */
const FETCH_LOW_SPEED_LIMIT = '1000'
const FETCH_LOW_SPEED_TIME_S = '20'

function publishedRefOf(data: DocsSourceData): string {
  return `refs/remotes/origin/${data.branch}`
}

const refreshPublished = throttledRefresh(async (sourceId) => {
  const repoDir = await docsRepoDir(sourceId)
  const data = await getSourceData(sourceId)
  if (!data.repoUrl || !(await isCloned(repoDir))) {
    return
  }
  const secrets = await resolveSecrets(data.secretId)
  // The credentialed URL goes on the command line only, never into the
  // clone's config, so a fetch cannot race a publish over the remote's URL.
  const url = buildAuthUrl(data.repoUrl, secrets.username, secrets.token)
  try {
    await gitExec(
      repoDir,
      '-c',
      `http.lowSpeedLimit=${FETCH_LOW_SPEED_LIMIT}`,
      '-c',
      `http.lowSpeedTime=${FETCH_LOW_SPEED_TIME_S}`,
      'fetch',
      '--quiet',
      url,
      `+refs/heads/${data.branch}:${publishedRefOf(data)}`,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const redacted = secrets.token ? message.split(secrets.token).join('***') : message
    console.error(`[docs-git] Could not refresh the published branch of ${sourceId}: ${redacted}`)
  }
}, PUBLISHED_REFRESH_INTERVAL_MS)

/**
 * The ref holding a source's published version, refreshed from the remote
 * unless that happened within the last interval. When the remote cannot be
 * reached, or does not answer within the wait, it is the version as last
 * fetched.
 */
export async function docsPublishedRef(sourceId: string): Promise<string> {
  await waitAtMost(refreshPublished(sourceId), PUBLISHED_REFRESH_WAIT_MS)
  return publishedRefOf(await getSourceData(sourceId))
}

/** Repository-relative paths of every file in the published version. */
export async function docsPublishedFiles(sourceId: string): Promise<string[]> {
  const repoDir = await docsRepoDir(sourceId)
  if (!(await isCloned(repoDir))) {
    return []
  }
  const ref = await docsPublishedRef(sourceId)
  const output = await gitExec(repoDir, 'ls-tree', '-r', '-z', '--name-only', ref)
  return output.split('\0').filter(Boolean)
}

// ─── Public Actions ─────────────────────────────────────────────────────

export async function docsPull(sourceId: string): Promise<void> {
  const repoDir = await docsRepoDir(sourceId)
  const cloned = await isCloned(repoDir)
  if (!cloned) {
    throw new Error('Repository is not cloned')
  }

  const data = await getSourceData(sourceId)
  const secrets = await resolveSecrets(data.secretId)

  // Set remote URL with auth for pull; never leave the token on disk after.
  const authed = Boolean(data.repoUrl && (secrets.username || secrets.token))
  if (authed) {
    const authUrl = buildAuthUrl(data.repoUrl, secrets.username, secrets.token)
    await gitExec(repoDir, 'remote', 'set-url', 'origin', authUrl)
  }

  try {
    // Keeps every draft, and refuses -- changing nothing, naming the pages --
    // when a page with a draft changed upstream. Resolving a conflict is not
    // this action's job.
    await pullKeepingDrafts((...args) => gitExec(repoDir, ...args), data.branch || 'main')
  } finally {
    if (authed) {
      await gitExec(repoDir, 'remote', 'set-url', 'origin', data.repoUrl)
    }
  }
}

export interface DocsChangedFile {
  status: string
  path: string
}

export async function docsChangedFiles(nodeId: string): Promise<DocsChangedFile[]> {
  const repoDir = await docsRepoDir(nodeId)
  const cloned = await isCloned(repoDir)
  if (!cloned) return []

  const output = await gitExec(repoDir, 'status', '--porcelain')
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2).trim(),
      path: line.slice(3),
    }))
}

export interface DocsLogEntry {
  sha: string
  message: string
  author: string
  date: string
}

/** The published history, newest first; of one file when `filePath` is given. */
export async function docsLog(nodeId: string, filePath?: string, count?: number): Promise<DocsLogEntry[]> {
  const repoDir = await docsRepoDir(nodeId)
  const cloned = await isCloned(repoDir)
  if (!cloned) return []

  const limit = count ?? 50
  const ref = await docsPublishedRef(nodeId)
  const args = ['log', ref, `--max-count=${limit}`, '--pretty=format:%H%x00%s%x00%an%x00%aI']
  if (filePath) {
    args.push('--', filePath)
  }

  const output = await gitExec(repoDir, ...args)
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, message, author, date] = line.split('\0')
      return { sha: sha ?? '', message: message ?? '', author: author ?? '', date: date ?? '' }
    })
}

/**
 * A file's content at `ref`, or in the published version when no ref is
 * given. Throws when the file does not exist there.
 */
export async function docsShow(nodeId: string, filePath: string, ref?: string): Promise<string> {
  const repoDir = await docsRepoDir(nodeId)
  const cloned = await isCloned(repoDir)
  if (!cloned) {
    throw new Error('Repository is not cloned')
  }

  const gitRef = ref || (await docsPublishedRef(nodeId))
  return gitExec(repoDir, 'show', `${gitRef}:${filePath}`)
}

/**
 * Commit and push a single file. Uses `git commit -- <path>` (the
 * --only form) so other staged changes in the index are not pulled
 * into this commit. The file is staged first to handle the
 * untracked-new-file case.
 */
export async function docsPublishFile(
  sourceId: string,
  filePath: string,
  message: string,
  author: string,
): Promise<{ sha: string; message: string }> {
  const repoDir = await docsRepoDir(sourceId)
  const data = await getSourceData(sourceId)
  const cloned = await isCloned(repoDir)
  if (!cloned) {
    throw new Error('Repository is not cloned')
  }

  const secrets = await resolveSecrets(data.secretId)

  // Auth on the remote only for the push; never leave the token on disk after.
  const authed = Boolean(data.repoUrl && (secrets.username || secrets.token))
  if (authed) {
    const authUrl = buildAuthUrl(data.repoUrl, secrets.username, secrets.token)
    await gitExec(repoDir, 'remote', 'set-url', 'origin', authUrl)
  }

  try {
    await gitExec(repoDir, 'add', '--', filePath)
    await gitExec(repoDir, ...commitAs(author), 'commit', '-m', message, '--', filePath)
    // The page's draft goes back to being a draft when the push fails.
    await pushOrUndo(repoDir, data, secrets, 'publish', async () => {})
  } finally {
    if (authed) {
      await gitExec(repoDir, 'remote', 'set-url', 'origin', data.repoUrl)
    }
  }

  const sha = (await gitExec(repoDir, 'rev-parse', 'HEAD')).trim()

  return { sha, message }
}

/**
 * Pushes the commit just made, or takes it back. A commit whose push failed
 * would stay in the clone, ahead of the remote: never published, no longer a
 * draft, and swept into the next push. So on a failed push the commit is
 * undone -- its changes left staged, as they were before it -- `restore`
 * puts back anything else the commit took away, and the push's error is
 * thrown, credentials removed, for the person who asked.
 */
async function pushOrUndo(
  repoDir: string,
  data: DocsSourceData,
  secrets: { username?: string; token?: string },
  what: string,
  restore: () => Promise<void>,
): Promise<void> {
  try {
    await gitExec(repoDir, 'push', 'origin', data.branch || 'main')
  } catch (err) {
    await gitExec(repoDir, 'reset', '--soft', 'HEAD~1')
    await restore()
    const message = err instanceof Error ? err.message : String(err)
    const redacted = secrets.token ? message.split(secrets.token).join('***') : message
    throw new Error(
      `Could not ${what}: the push to the remote failed, so nothing changed there and the page is as it was. ` +
        `If the remote has changes this copy lacks, pull, then try again. (${redacted.trim()})`,
    )
  }
}

export async function docsAddFile(nodeId: string, filePath: string): Promise<void> {
  const repoDir = await docsRepoDir(nodeId)
  const cloned = await isCloned(repoDir)
  if (!cloned) return

  await gitExec(repoDir, 'add', filePath)
}

/**
 * Best-effort `git add` for a single file given a repo directory directly
 * (rather than a nodeId). Swallows errors so callers can treat this as
 * fire-and-forget.
 */
export async function gitAdd(repoDir: string, filePath: string): Promise<void> {
  try {
    await gitExec(repoDir, 'add', '--', filePath)
  } catch {
    // best-effort — do not block doc operations if git-add fails
  }
}

/**
 * Delete a doc and its sidecar files from the working tree, then commit
 * and push the deletion. For uncommitted-only files, the commit/push
 * step is skipped — the file just gets removed.
 */
export async function docsDeleteFile(nodeId: string, filePath: string, author: string): Promise<void> {
  const repoDir = await docsRepoDir(nodeId)
  const cloned = await isCloned(repoDir)
  if (!cloned) {
    throw new Error('Repository is not cloned')
  }

  // Always remove the sidecar comments file (untracked, not in HEAD).
  await host.fs.rm(`${repoDir}/${filePath}.comments`).catch(() => {})

  const inHead = await fileInHead(repoDir, filePath)
  if (!inHead) {
    // Untracked / staged-new file — unstage if staged, then unlink.
    await gitExec(repoDir, 'rm', '--cached', '--ignore-unmatch', '--', filePath).catch(() => {})
    await host.fs.rm(`${repoDir}/${filePath}`).catch(() => {})
    return
  }

  const data = await getSourceData(nodeId)
  const secrets = await resolveSecrets(data.secretId)
  // Auth on the remote only for the push; never leave the token on disk after.
  const authed = Boolean(data.repoUrl && (secrets.username || secrets.token))
  if (authed) {
    const authUrl = buildAuthUrl(data.repoUrl, secrets.username, secrets.token)
    await gitExec(repoDir, 'remote', 'set-url', 'origin', authUrl)
  }

  try {
    // `--force` drops a draft of the page along with it; the commit names the
    // page alone, so other pages' staged drafts stay drafts.
    await gitExec(repoDir, 'rm', '--force', '--', filePath)
    await gitExec(repoDir, ...commitAs(author), 'commit', '-m', `Delete ${filePath}`, '--', filePath)
    // A failed push brings the page back as published.
    await pushOrUndo(repoDir, data, secrets, 'delete the page', () =>
      gitExec(repoDir, 'checkout', 'HEAD', '--', filePath).then(() => {}),
    )
  } finally {
    if (authed) {
      await gitExec(repoDir, 'remote', 'set-url', 'origin', data.repoUrl)
    }
  }
}

/**
 * Get the docs root directory for a documentation source.
 * Returns null if the source is unknown or not cloned.
 */
export async function getDocsRoot(sourceId: string): Promise<string | null> {
  if (!sourceId) return null
  let repoDir: string
  try {
    repoDir = await docsRepoDir(sourceId)
  } catch {
    return null
  }
  return (await isCloned(repoDir)) ? repoDir : null
}

/**
 * Find the documentation source matching `namespace` (the instance address,
 * `<space>.<slug>`) and return its docs root. If `namespace` is omitted, returns the root
 * of the first source found.
 */
export async function findActiveDocsRoot(namespace?: string): Promise<string | null> {
  const sourceId = await findDocNodeId(namespace)
  if (!sourceId) return null
  return getDocsRoot(sourceId)
}

interface NamespaceEntry {
  id: string
  namespace: string
  name: string
}

/**
 * List every documentation source (App instance) keyed by namespace. A
 * namespace is the instance's ADDRESS, `<space>.<slug>` — both minted by the
 * host, globally unique by construction — so every instance is always
 * listed, and two instances with the same display name can never shadow
 * each other the way name-derived namespaces could.
 */
export async function listDocNamespaces(): Promise<NamespaceEntry[]> {
  return (await listDocAppInstances()).map((instance) => ({
    id: instance.instanceId,
    namespace: `${instance.spaceSlug}.${instance.slug}`,
    name: instance.name,
  }))
}

/**
 * Discard local changes for a file. Behaviour depends on whether the
 * file exists in HEAD:
 *  - In HEAD: revert working-tree to the committed version.
 *  - Not in HEAD (newly created): unstage if staged, then delete from
 *    the working tree.
 */
export async function docsDiscardFile(nodeId: string, filePath: string): Promise<void> {
  const repoDir = await docsRepoDir(nodeId)
  const cloned = await isCloned(repoDir)
  if (!cloned) {
    throw new Error('Repository is not cloned')
  }
  const inHead = await fileInHead(repoDir, filePath)
  if (inHead) {
    // From HEAD, index and working tree both: a draft is staged as it is
    // saved, and `checkout -- path` alone restores the staged draft.
    await gitExec(repoDir, 'checkout', 'HEAD', '--', filePath)
    return
  }
  // New (untracked or staged-new) file — unstage if staged, then unlink.
  try {
    await gitExec(repoDir, 'rm', '--cached', '--ignore-unmatch', '--', filePath)
  } catch {
    // Not staged — fine, fall through to unlink.
  }
  try {
    await host.fs.rm(`${repoDir}/${filePath}`)
  } catch {
    // Already gone — fine.
  }
}

async function fileInHead(repoDir: string, filePath: string): Promise<boolean> {
  try {
    await gitExec(repoDir, 'cat-file', '-e', `HEAD:${filePath}`)
    return true
  } catch {
    return false
  }
}

/**
 * Find the documentation source id matching `namespace` — the instance
 * address, `<space>.<slug>`. If `namespace` is omitted, returns the first
 * source found. The id it returns is an App instance id.
 */
export async function findDocNodeId(namespace?: string): Promise<string | null> {
  const instances = await listDocAppInstances()
  if (!namespace) {
    return instances[0]?.instanceId ?? null
  }
  for (const instance of instances) {
    if (`${instance.spaceSlug}.${instance.slug}` === namespace) {
      return instance.instanceId
    }
  }
  return null
}
