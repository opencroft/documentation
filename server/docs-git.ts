import { apps, type HostAppInstance } from '@opencroft/server/apps'
import { secrets as hostSecrets } from '@opencroft/server/secrets'
import { execFile, fs, path } from '@opencroft/server/system'

import { commitAs } from './commit-identity'
import { type FolderMeta, META_FILE, parseMeta } from './doc-meta'
import { isListed } from './doc-tree'
import { commitPage, discardPage, literalPaths } from './page-git'
import { titlesAt } from './page-title'
import { pullKeepingDrafts } from './pull-keeping-drafts'
import { throttledRefresh, waitAtMost } from './refresh-throttle'
import { commitTreeChange, type Git, type TreeChange, type WorkingFiles } from './tree-commit'
import type { LinkSources, TreeState } from './tree-plan'

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
// dir, and its instanceId is the source id everywhere below.

export async function listDocAppInstances(): Promise<HostAppInstance[]> {
  try {
    return await apps.listInstances('documentation')
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
    const token = await hostSecrets.get(address.slice(0, slash), address.slice(slash + 1))
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
  return execFile('git', ['-c', 'safe.directory=*', '-c', 'core.quotePath=false', '-C', repoDir, ...args])
}

/** Git in the clone, for commands that name files: each path is a name, never a pattern. */
function gitOn(repoDir: string): Git {
  return literalPaths((...args) => gitExec(repoDir, ...args))
}

function isCloned(repoDir: string): Promise<boolean> {
  return fs
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

  const output = await gitOn(repoDir)(...args)
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

interface PushTarget {
  repoDir: string
  data: DocsSourceData
  secrets: { username?: string; token?: string }
}

/**
 * Runs `work` with the clone's remote authenticated for a push, and puts the
 * plain URL back after it, also when `work` throws. The token is in the
 * clone's `.git/config` for as long as `work` runs -- for a tree change, the
 * commit and its push -- and readable there by anything that can read the
 * clone. A process that dies meanwhile leaves it there until the next push
 * puts the plain URL back.
 */
async function withPushAccess<T>(sourceId: string, work: (target: PushTarget) => Promise<T>): Promise<T> {
  const repoDir = await docsRepoDir(sourceId)
  if (!(await isCloned(repoDir))) {
    throw new Error('Repository is not cloned')
  }
  const data = await getSourceData(sourceId)
  const secrets = await resolveSecrets(data.secretId)
  const authed = Boolean(data.repoUrl && (secrets.username || secrets.token))
  if (authed) {
    await gitExec(repoDir, 'remote', 'set-url', 'origin', buildAuthUrl(data.repoUrl, secrets.username, secrets.token))
  }
  try {
    return await work({ repoDir, data, secrets })
  } finally {
    if (authed) {
      await gitExec(repoDir, 'remote', 'set-url', 'origin', data.repoUrl)
    }
  }
}

/** The push's error for the person who asked, credentials removed. */
function pushFailure(err: unknown, secrets: { token?: string }, what: string): Error {
  const message = err instanceof Error ? err.message : String(err)
  const redacted = secrets.token ? message.split(secrets.token).join('***') : message
  return new Error(
    `Could not ${what}: the push to the remote failed, so nothing changed there and the page is as it was. ` +
      `If the remote has changes this copy lacks, pull, then try again. (${redacted.trim()})`,
  )
}

/** Commits a single page's draft, other pages' drafts left out, and pushes it. */
export async function docsPublishFile(
  sourceId: string,
  filePath: string,
  message: string,
  author: string,
): Promise<{ sha: string; message: string }> {
  return withPushAccess(sourceId, async ({ repoDir, data, secrets }) => {
    await commitPage((...args) => gitExec(repoDir, ...args), filePath, message, commitAs(author))
    // The page's draft goes back to being a draft when the push fails.
    await pushOrUndo(repoDir, data, secrets, 'publish')
    const sha = (await gitExec(repoDir, 'rev-parse', 'HEAD')).trim()
    return { sha, message }
  })
}

/** The clone's working tree as `commitTreeChange` writes it, empty folders it leaves removed. */
function workingFilesOf(repoDir: string): WorkingFiles {
  const at = (relative: string) => {
    const resolved = path.resolve(repoDir, relative)
    if (!resolved.startsWith(repoDir + path.sep)) {
      throw new Error('Access denied')
    }
    return resolved
  }
  const prune = async (relative: string) => {
    for (
      let folder = path.dirname(at(relative));
      folder.startsWith(repoDir + path.sep);
      folder = path.dirname(folder)
    ) {
      if ((await fs.readdir(folder).catch(() => ['?'])).length > 0) {
        return
      }
      await fs.rmdir(folder)
    }
  }
  return {
    read: (relative) => fs.readFile(at(relative), 'utf-8').catch(() => null),
    write: async (relative, content) => {
      await fs.mkdir(path.dirname(at(relative)), { recursive: true })
      await fs.writeFile(at(relative), content, 'utf-8')
    },
    remove: async (relative) => {
      await fs.rm(at(relative), { force: true })
      await prune(relative)
    },
    rename: async (from, to) => {
      await fs.mkdir(path.dirname(at(to)), { recursive: true })
      await fs.rename(at(from), at(to))
      await prune(from)
    },
  }
}

/**
 * Makes a change to the tree as one commit by `author` and pushes it; on a
 * failed push the clone is as it was. Returns the commit's sha, or null when
 * nothing published changed.
 */
export function docsCommitTree(sourceId: string, change: TreeChange, author: string): Promise<string | null> {
  return withPushAccess(sourceId, ({ repoDir, data, secrets }) =>
    commitTreeChange(
      (...args) => gitExec(repoDir, ...args),
      workingFilesOf(repoDir),
      change,
      commitAs(author),
      async () => {
        try {
          await gitExec(repoDir, 'push', 'origin', data.branch || 'main')
        } catch (err) {
          throw pushFailure(err, secrets, 'change the documentation tree')
        }
      },
    ),
  )
}

/** Repository-relative paths of every file in the working tree, dot-folders left out. */
async function workingFiles(root: string, dirPath = ''): Promise<string[]> {
  const entries = await fs.readdir(path.resolve(root, dirPath), { withFileTypes: true }).catch(() => null)
  if (!entries) {
    return []
  }
  const paths: string[] = []
  for (const entry of entries) {
    const relative = dirPath ? `${dirPath}/${entry.name}` : entry.name
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      paths.push(...(await workingFiles(root, relative)))
    } else if (entry.isFile()) {
      paths.push(relative)
    }
  }
  return paths
}

/** Each folder's meta, read from the working tree's meta files among `working`. */
async function readMetas(repoDir: string, working: string[]): Promise<Map<string, FolderMeta>> {
  const metas = new Map<string, FolderMeta>()
  for (const file of working) {
    const base = file.slice(file.lastIndexOf('/') + 1)
    if (base === META_FILE) {
      const folder = file.slice(0, Math.max(file.lastIndexOf('/'), 0))
      metas.set(folder, parseMeta(await fs.readFile(path.resolve(repoDir, file), 'utf-8').catch(() => null)))
    }
  }
  return metas
}

/** The clone as a tree change is planned on: the last commit, the working tree and the folders' metas. */
export async function docsTreeState(sourceId: string): Promise<TreeState> {
  const repoDir = await docsRepoDir(sourceId)
  const [head, working] = await Promise.all([
    gitExec(repoDir, 'ls-tree', '-r', '-z', '--name-only', 'HEAD').then((out) => out.split('\0').filter(Boolean)),
    workingFiles(repoDir),
  ])
  return { head, working, metas: await readMetas(repoDir, working) }
}

/** Each folder's meta, as the tree shows it. */
export async function docsFolderMetas(sourceId: string): Promise<Map<string, FolderMeta>> {
  const repoDir = await docsRepoDir(sourceId)
  return readMetas(repoDir, await workingFiles(repoDir))
}

/**
 * The pages a change that moves or deletes `paths` reads links from: committed
 * pages whose text names one of them (by its last path segment, as written or
 * percent-encoded), and every page whose working text is not the committed
 * one.
 */
export async function docsLinkSources(sourceId: string, paths: string[]): Promise<LinkSources> {
  const repoDir = await docsRepoDir(sourceId)
  const needles = new Set<string>()
  for (const from of paths) {
    const base = from.slice(from.lastIndexOf('/') + 1)
    needles.add(base)
    needles.add(encodeURIComponent(base))
  }
  const candidates =
    needles.size === 0
      ? []
      : await gitExec(
          repoDir,
          'grep',
          '-l',
          '-z',
          '-F',
          ...[...needles].flatMap((n) => ['-e', n]),
          'HEAD',
          '--',
          '*.md',
        )
          .then((out) =>
            out
              .split('\0')
              .filter(Boolean)
              .map((hit) => hit.slice('HEAD:'.length)),
          )
          // No page matched: grep exits non-zero.
          .catch(() => [])

  const drafts = new Map<string, string>()
  const status = (await gitExec(repoDir, 'status', '--porcelain', '-z', '--untracked-files=all')).split('\0')
  for (let i = 0; i < status.length; i++) {
    const entry = status[i]
    if (!entry) {
      continue
    }
    // A rename or copy is followed by the path it came from.
    if (entry[0] === 'R' || entry[0] === 'C') {
      i++
    }
    const file = entry.slice(3)
    if (isListed(file)) {
      // A page deleted in the working tree has no text to read, and no draft.
      const text = await fs.readFile(path.resolve(repoDir, file), 'utf-8').catch(() => null)
      if (text !== null) {
        drafts.set(file, text)
      }
    }
  }
  return {
    readHead: (file) => gitExec(repoDir, 'show', `HEAD:${file}`),
    candidates,
    drafts,
  }
}

/** Each published page's title. A page that does not start with one is absent. */
export async function docsPublishedTitles(sourceId: string): Promise<Map<string, string>> {
  const repoDir = await docsRepoDir(sourceId)
  if (!(await isCloned(repoDir))) {
    return new Map()
  }
  return titlesAt((...args) => gitExec(repoDir, ...args), await docsPublishedRef(sourceId))
}

/**
 * Pushes the commit just made, or takes it back. A commit whose push failed
 * would stay in the clone, ahead of the remote: never published, no longer a
 * draft, and swept into the next push. So on a failed push the commit is
 * undone -- its changes left staged, as they were before it -- and the push's
 * error is thrown, credentials removed, for the person who asked.
 */
async function pushOrUndo(
  repoDir: string,
  data: DocsSourceData,
  secrets: { username?: string; token?: string },
  what: string,
): Promise<void> {
  try {
    await gitExec(repoDir, 'push', 'origin', data.branch || 'main')
  } catch (err) {
    await gitExec(repoDir, 'reset', '--soft', 'HEAD~1')
    throw pushFailure(err, secrets, what)
  }
}

export async function docsAddFile(nodeId: string, filePath: string): Promise<void> {
  const repoDir = await docsRepoDir(nodeId)
  const cloned = await isCloned(repoDir)
  if (!cloned) return

  await gitOn(repoDir)('add', '--', filePath)
}

/**
 * Best-effort `git add` for a single file given a repo directory directly
 * (rather than a nodeId). Swallows errors so callers can treat this as
 * fire-and-forget.
 */
export async function gitAdd(repoDir: string, filePath: string): Promise<void> {
  try {
    await gitOn(repoDir)('add', '--', filePath)
  } catch {
    // best-effort — do not block doc operations if git-add fails
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
  await discardPage(
    (...args) => gitExec(repoDir, ...args),
    filePath,
    // Already gone is fine.
    () => fs.rm(`${repoDir}/${filePath}`).catch(() => {}),
  )
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
