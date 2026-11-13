import { collab } from '@opencroft/server/collab'
import { fs, path } from '@opencroft/server/system'

import type { UnrewrittenLink } from './doc-links'
import {
  docsCommitTree,
  docsDeleteFile,
  docsDiscardFile,
  docsLinkSources,
  docsPublishFile,
  docsPull,
  docsShow,
  docsTreeState,
  getDocsRoot,
  gitAdd,
} from './docs-git'
import { withTitle } from './page-title'
import { planFolderTitle, planMove, planPublish, type TreePlan, type TreeState, withLinks } from './tree-plan'

// A page's draft -- its file in the instance's working tree -- is one shared
// document: everyone editing the page edits the same draft at once, an
// agent's edit lands in it while people type, and Publish and Discard act on
// the whole of it. The host holds the open copy and writes it back here; a
// page that is opened and left as it was is never written, so opening one
// makes no draft.
//
// Whatever changes a draft from outside an editor goes through here too: an
// edit is applied to the open copy when there is one, and a change to the
// files themselves (discard, delete, pull) waits for the open copies to be
// closed and reopens them on what it left.

const KIND = 'docs'

/** A page's key: the instance's id, then the page's path in its repository. */
function keyOf(nodeId: string, filePath: string): string {
  return `${nodeId}/${filePath}`
}

function pageOf(key: string): { nodeId: string; filePath: string } {
  const slash = key.indexOf('/')
  return { nodeId: key.slice(0, slash), filePath: key.slice(slash + 1) }
}

/**
 * Instances being removed. Their clone is deleted only after `onRemoved`
 * returns, so until then an editor reconnecting to a dropped draft would find
 * its page and store a new copy; their pages are refused instead. An instance
 * added again under the same id (an edit of its parameters) is served again.
 */
const removedInstances = new Set<string>()

/** A page's file in the instance's working tree; throws for anything but a `.md` file inside it. */
async function draftFile(nodeId: string, filePath: string): Promise<{ root: string; resolved: string }> {
  if (removedInstances.has(nodeId)) {
    throw new Error(`Documentation instance "${nodeId}" is being removed`)
  }
  if (!filePath.endsWith('.md')) {
    throw new Error('Only .md files are editable')
  }
  const root = await getDocsRoot(nodeId)
  if (!root) {
    throw new Error(`No documentation repository configured for instance "${nodeId}"`)
  }
  const resolved = path.resolve(root, filePath)
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error('Access denied')
  }
  return { root, resolved }
}

/**
 * The page as it stands in storage: its draft, or the published page when the
 * working tree has none. A page always starts with its title, so one that has
 * none is read with a title made from its file name; that alone writes nothing,
 * since the page as read is what the editor compares its changes to.
 */
async function readStored(nodeId: string, filePath: string): Promise<string | null> {
  const { resolved } = await draftFile(nodeId, filePath)
  const stored = await fs.readFile(resolved, 'utf-8').catch(() => docsShow(nodeId, filePath).catch(() => null))
  return stored === null ? null : withTitle(stored, path.basename(filePath))
}

/** Serves the pages' drafts to the host's shared editor. Called once, from the extension's `load`. */
export function registerDocDrafts(): void {
  collab.markdown.register(KIND, {
    read: async (key) => {
      const { nodeId, filePath } = pageOf(key)
      return readStored(nodeId, filePath)
    },
    write: async (key, markdown) => {
      const { nodeId, filePath } = pageOf(key)
      // The page as it already is -- a published page nobody changed -- is
      // left alone, so it does not turn into a draft.
      if ((await readStored(nodeId, filePath)) === markdown) {
        return
      }
      const { root, resolved } = await draftFile(nodeId, filePath)
      await fs.mkdir(path.dirname(resolved), { recursive: true })
      await fs.writeFile(resolved, markdown, 'utf-8')
      await gitAdd(root, filePath)
    },
    // Anyone signed in may open a page's draft, as anyone signed in can
    // read and save it through the extension's actions: the host has
    // no per-space access to check. A key that names no instance, or a path
    // that is not a page inside it, is refused.
    authorize: async (key) => {
      const { nodeId, filePath } = pageOf(key)
      try {
        await draftFile(nodeId, filePath)
        return true
      } catch {
        return false
      }
    },
  })
}

/**
 * Drops every page's draft document of an instance being removed, open or
 * not, once the change to its files in progress is done; its pages are
 * refused from now on. The drafts' files go with the clone.
 */
export function dropInstanceDrafts(nodeId: string): Promise<void> {
  removedInstances.add(nodeId)
  return inTurn(nodeId, () => collab.markdown.drop(KIND, keyOf(nodeId, '')))
}

/** Serves an instance's pages again: one added under the id of one removed before. */
export function serveInstanceDrafts(nodeId: string): void {
  removedInstances.delete(nodeId)
}

/** What the page's editor opens: the shared draft's document name. */
export async function draftDocumentName(nodeId: string, filePath: string): Promise<string> {
  await draftFile(nodeId, filePath)
  return collab.markdown.documentName(KIND, keyOf(nodeId, filePath))
}

/** The page's draft as it stands, open copy included; null when the page has none. */
export async function readDraft(nodeId: string, filePath: string): Promise<string | null> {
  await draftFile(nodeId, filePath)
  return collab.markdown.read(KIND, keyOf(nodeId, filePath))
}

/** Who changed a draft from outside its editor, as the people editing it are shown. */
export interface DraftEditor {
  kind: 'agent' | 'user'
  name: string
}

/**
 * Changes a page's draft as `by`: `change` is handed the draft as it stands
 * and returns what it should be, and may throw to change nothing. A page
 * that has no draft or page yet is created with `change('')`. Returns the
 * new draft.
 */
export async function editDraft(
  nodeId: string,
  filePath: string,
  by: DraftEditor,
  change: (markdown: string) => string,
): Promise<string> {
  const key = keyOf(nodeId, filePath)
  if ((await readDraft(nodeId, filePath)) === null) {
    // Nobody can have a page open that does not exist yet; created with its
    // drafts closed in case someone opens it meanwhile.
    return collab.markdown.whileClosed(KIND, [key], async () => {
      const { root, resolved } = await draftFile(nodeId, filePath)
      const created = change('')
      await fs.mkdir(path.dirname(resolved), { recursive: true })
      await fs.writeFile(resolved, created, 'utf-8')
      await gitAdd(root, filePath)
      return created
    })
  }
  return collab.markdown.edit(KIND, key, by, change)
}

/** Writes the page's open draft to its file now, so what is published is everything typed so far. */
export async function flushDraft(nodeId: string, filePath: string): Promise<void> {
  await collab.markdown.flush(KIND, keyOf(nodeId, filePath))
}

// ─── Changes to the files under the drafts ─────────────────────────────
// Each runs in its turn per instance: they all read the clone, change its
// files and index and commit, and two at once would commit each other's
// half-made changes.

const turns = new Map<string, Promise<unknown>>()

function inTurn<T>(nodeId: string, change: () => Promise<T>): Promise<T> {
  const previous = turns.get(nodeId) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(change)
  turns.set(nodeId, next)
  // The last change of an instance clears its entry when it ends.
  next
    .catch(() => {})
    .finally(() => {
      if (turns.get(nodeId) === next) {
        turns.delete(nodeId)
      }
    })
  return next
}

/** What a change to the tree did: where its page or folder is now, and the links it left as written. */
export interface TreeChangeResult {
  path: string
  /** The commit; null when nothing published changed. */
  sha: string | null
  unrewrittenLinks: UnrewrittenLink[]
}

export interface PublishResult extends TreeChangeResult {
  sha: string
  message: string
  /** Where the page was, when publishing named its file after a new title. */
  previousPath?: string
}

/**
 * Makes the change `plan` reads off the clone, links rewritten, as one commit
 * by `by` -- while no draft is open, so every draft is in its file and
 * editors reopen on the files as the change left them.
 */
function changeTree(
  nodeId: string,
  by: DraftEditor,
  plan: (state: TreeState) => TreePlan | Promise<TreePlan>,
  publishing?: string,
): Promise<TreeChangeResult> {
  return collab.markdown.whileClosed(KIND, null, async () => {
    const state = await docsTreeState(nodeId)
    const planned = await plan(state)
    const sources = await docsLinkSources(nodeId, planned.renames)
    const { change, unrewritten } = await withLinks(state, planned, sources, publishing)
    const sha = await docsCommitTree(nodeId, change, by.name)
    return { path: planned.path, sha, unrewrittenLinks: unrewritten }
  })
}

/**
 * The page as it is published: its file, starting with its title. A page
 * that has none is published with the title its editor shows, made from its
 * file name (`readStored`); that title is written into the file first, since
 * the editor holds no change of its own to store. Refused when the page has
 * no file.
 */
async function draftToPublish(nodeId: string, filePath: string): Promise<string> {
  const { root, resolved } = await draftFile(nodeId, filePath)
  const stored = await fs.readFile(resolved, 'utf-8').catch(() => null)
  if (stored === null) {
    throw new Error(`Nothing to publish: ${filePath} has no draft.`)
  }
  const draft = withTitle(stored, path.basename(filePath))
  if (draft !== stored) {
    await fs.writeFile(resolved, draft, 'utf-8')
    await gitAdd(root, filePath)
  }
  return draft
}

/**
 * Publishes the page's whole draft, everything typed up to now, as a commit by
 * `by`. The page has to start with its title; its file is named after it, so a
 * changed title moves the file, its folder's meta entry and the links to it in
 * the same commit.
 */
export function publishPage(
  nodeId: string,
  filePath: string,
  message: string,
  by: DraftEditor,
): Promise<PublishResult> {
  return inTurn(nodeId, async () => {
    await flushDraft(nodeId, filePath)
    const draft = await draftToPublish(nodeId, filePath)
    if (!planPublish(await docsTreeState(nodeId), filePath, draft, message)) {
      const published = await docsPublishFile(nodeId, filePath, message, by.name)
      return { ...published, path: filePath, unrewrittenLinks: [] }
    }
    const renamed = await changeTree(
      nodeId,
      by,
      async (state) => {
        // Read again with every draft closed: closing stored what was typed
        // since the flush, and the name the title takes may have been taken
        // meanwhile. What the commit holds is the draft as closing left it.
        const plan = planPublish(state, filePath, await draftToPublish(nodeId, filePath), message)
        if (!plan) {
          throw new Error(`Not published: ${filePath} changed while it was being published. Publish it again.`)
        }
        return plan
      },
      filePath,
    )
    // The renamed page is in the commit, so there always is one.
    return { ...renamed, sha: renamed.sha ?? '', message, previousPath: filePath }
  })
}

/** Moves the page or folder at `path` into `toFolder`, at `position` among what is there, as a commit by `by`. */
export function moveInTree(
  nodeId: string,
  path: string,
  toFolder: string,
  position: number | undefined,
  by: DraftEditor,
): Promise<TreeChangeResult> {
  return inTurn(nodeId, () => changeTree(nodeId, by, (state) => planMove(state, path, toFolder, position)))
}

/** Gives the folder at `path` the title `title`, renaming it after the title, as a commit by `by`. */
export function retitleFolder(nodeId: string, path: string, title: string, by: DraftEditor): Promise<TreeChangeResult> {
  return inTurn(nodeId, () => changeTree(nodeId, by, (state) => planFolderTitle(state, path, title)))
}

/** Drops the page's draft, for everyone editing it: their editors reopen on the published page. */
export function discardPage(nodeId: string, filePath: string): Promise<void> {
  const key = keyOf(nodeId, filePath)
  return inTurn(nodeId, () =>
    collab.markdown.whileClosed(KIND, [key], () => docsDiscardFile(nodeId, filePath), { discard: true }),
  )
}

/** Deletes the page, as a commit by `by`, its draft dropped for everyone editing it. */
export function deletePage(nodeId: string, filePath: string, by: DraftEditor): Promise<void> {
  const key = keyOf(nodeId, filePath)
  return inTurn(nodeId, () =>
    collab.markdown.whileClosed(KIND, [key], () => docsDeleteFile(nodeId, filePath, by.name), {
      discard: true,
    }),
  )
}

/**
 * Pulls the instance's repository while no draft is open, so nobody's copy
 * goes stale under them. The host closes every page's draft, of every
 * instance: each is stored first, and editors reconnect a moment later.
 */
export function pullDocs(nodeId: string): Promise<void> {
  return inTurn(nodeId, () => collab.markdown.whileClosed(KIND, null, () => docsPull(nodeId)))
}
