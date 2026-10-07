import host from '@opencroft/server'

import {
  docsDeleteFile,
  docsDiscardFile,
  docsPublishFile,
  docsPull,
  docsShow,
  getDocsRoot,
  gitAdd,
} from './docs-git'

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

/** A page's file in the instance's working tree; throws for anything but a `.md` file inside it. */
async function draftFile(nodeId: string, filePath: string): Promise<{ root: string; resolved: string }> {
  if (!filePath.endsWith('.md')) {
    throw new Error('Only .md files are editable')
  }
  const root = await getDocsRoot(nodeId)
  if (!root) {
    throw new Error(`No documentation repository configured for instance "${nodeId}"`)
  }
  const resolved = host.path.resolve(root, filePath)
  if (!resolved.startsWith(root + host.path.sep)) {
    throw new Error('Access denied')
  }
  return { root, resolved }
}

/** The page as it stands in storage: its draft, or the published page when the working tree has none. */
async function readStored(nodeId: string, filePath: string): Promise<string | null> {
  const { resolved } = await draftFile(nodeId, filePath)
  try {
    return await host.fs.readFile(resolved, 'utf-8')
  } catch {
    try {
      return await docsShow(nodeId, filePath)
    } catch {
      return null
    }
  }
}

/** Serves the pages' drafts to the host's shared editor. Called once, from the extension's `load`. */
export function registerDocDrafts(): void {
  host.collab.markdown.register(KIND, {
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
      await host.fs.mkdir(host.path.dirname(resolved), { recursive: true })
      await host.fs.writeFile(resolved, markdown, 'utf-8')
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

/** What the page's editor opens: the shared draft's document name. */
export async function draftDocumentName(nodeId: string, filePath: string): Promise<string> {
  await draftFile(nodeId, filePath)
  return host.collab.markdown.documentName(KIND, keyOf(nodeId, filePath))
}

/** The page's draft as it stands, open copy included; null when the page has none. */
export async function readDraft(nodeId: string, filePath: string): Promise<string | null> {
  await draftFile(nodeId, filePath)
  return host.collab.markdown.read(KIND, keyOf(nodeId, filePath))
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
    return host.collab.markdown.whileClosed(KIND, [key], async () => {
      const { root, resolved } = await draftFile(nodeId, filePath)
      const created = change('')
      await host.fs.mkdir(host.path.dirname(resolved), { recursive: true })
      await host.fs.writeFile(resolved, created, 'utf-8')
      await gitAdd(root, filePath)
      return created
    })
  }
  return host.collab.markdown.edit(KIND, key, by, change)
}

/** Writes the page's open draft to its file now, so what is published is everything typed so far. */
export async function flushDraft(nodeId: string, filePath: string): Promise<void> {
  await host.collab.markdown.flush(KIND, keyOf(nodeId, filePath))
}

// ─── Changes to the files under the drafts ─────────────────────────────

/** Publishes the page's whole draft, everything typed up to now, as a commit by `by`. */
export async function publishPage(
  nodeId: string,
  filePath: string,
  message: string,
  by: DraftEditor,
): Promise<{ sha: string; message: string }> {
  await flushDraft(nodeId, filePath)
  return docsPublishFile(nodeId, filePath, message, by.name)
}

/** Drops the page's draft, for everyone editing it: their editors reopen on the published page. */
export function discardPage(nodeId: string, filePath: string): Promise<void> {
  const key = keyOf(nodeId, filePath)
  return host.collab.markdown.whileClosed(KIND, [key], () => docsDiscardFile(nodeId, filePath), { discard: true })
}

/** Deletes the page, as a commit by `by`, its draft dropped for everyone editing it. */
export function deletePage(nodeId: string, filePath: string, by: DraftEditor): Promise<void> {
  const key = keyOf(nodeId, filePath)
  return host.collab.markdown.whileClosed(KIND, [key], () => docsDeleteFile(nodeId, filePath, by.name), { discard: true })
}

/**
 * Pulls the instance's repository while no draft is open, so nobody's copy
 * goes stale under them. The host closes every page's draft, of every
 * instance: each is stored first, and editors reconnect a moment later.
 */
export function pullDocs(nodeId: string): Promise<void> {
  return host.collab.markdown.whileClosed(KIND, null, () => docsPull(nodeId))
}
