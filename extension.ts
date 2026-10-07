import type * as opencroft from '@opencroft/server'

import { type Anchor, type Comment, appendComment, broadcastCommentsUpdated, createComment, readComments } from './server/docs-comments'
import { type DocEntry, createFile, listFiles } from './server/docs-files'
import {
  type DraftEditor,
  discardPage,
  draftDocumentName,
  editDraft,
  pullDocs,
  readDraft,
  registerDocDrafts,
} from './server/docs-drafts'
import {
  docsAddFile,
  docsChangedFiles,
  docsLog,
  docsShow,
  findActiveDocsRoot,
  findDocNodeId,
  listDocNamespaces,
} from './server/docs-git'
import { docsApps } from './server/docs-app'
import { type DocSearchResult, searchDocs } from './server/docs-search'

export function load(context: opencroft.ExtensionContext) {
  registerDocDrafts()
}

export function unload(context: opencroft.ExtensionContext) {}

export const apps = docsApps

// ─── Namespace-scoped doc helpers backing the actions below ──────────────

/** A doc at `ref`, or its published version; null when it has none there. */
async function readDocAtRef(namespace: string, filePath: string, ref?: string): Promise<string | null> {
  const nodeId = await findDocNodeId(namespace)
  if (!nodeId) {
    return null
  }
  try {
    return await docsShow(nodeId, filePath, ref)
  } catch {
    return null
  }
}

async function docsFileLogByNs(namespace: string, filePath?: string, count?: number) {
  const nodeId = await findDocNodeId(namespace)
  if (!nodeId) {
    return []
  }
  return docsLog(nodeId, filePath, count)
}

async function docsChangedFilesByNs(namespace: string): Promise<string[]> {
  const nodeId = await findDocNodeId(namespace)
  if (!nodeId) {
    return []
  }
  const files = await docsChangedFiles(nodeId)
  return files.map((f) => f.path)
}

async function nodeIdOf(namespace: string): Promise<string> {
  const nodeId = await findDocNodeId(namespace)
  if (!nodeId) {
    throw new Error(`No documentation node found for namespace "${namespace}"`)
  }
  return nodeId
}

/** How a page saved through `docs.saveFile` -- by a caller other than its editor -- is shown to the people editing it. */
const SAVED_FROM_OUTSIDE: DraftEditor = { kind: 'user', name: 'Documentation' }

async function docsDiscardByNs(namespace: string, filePath: string): Promise<void> {
  await discardPage(await nodeIdOf(namespace), filePath)
}

async function docsPostComment(
  namespace: string,
  filePath: string,
  message: string,
  author?: string,
  parentId?: string,
  anchor?: Anchor,
): Promise<Comment> {
  const trimmed = message.trim()
  if (!trimmed) {
    throw new Error('Comment cannot be empty')
  }
  const comment = createComment(author ?? 'user', trimmed, parentId ? undefined : anchor)
  await appendComment(namespace, filePath, comment, parentId)
  // Push live refresh to any open doc viewers. Best-effort/no-op on hosts without host.events.
  broadcastCommentsUpdated(filePath)
  return comment
}

export const actions = {
  'docs.pull': (params: { nodeId: string }) => pullDocs(params.nodeId),
  'docs.changedFiles': (params: { nodeId: string }) => docsChangedFiles(params.nodeId),
  'docs.log': (params: { nodeId: string; filePath?: string; count?: number }) => docsLog(params.nodeId, params.filePath, params.count),
  'docs.show': (params: { nodeId: string; filePath: string; ref?: string }) => docsShow(params.nodeId, params.filePath, params.ref),
  'docs.addFile': (params: { nodeId: string; filePath: string }) => docsAddFile(params.nodeId, params.filePath),
  'docs.discardFile': (params: { nodeId: string; filePath: string }) => discardPage(params.nodeId, params.filePath),
  'docs.findActiveDocsRoot': (params?: { namespace?: string }) => findActiveDocsRoot(params?.namespace),
  'docs.findDocNodeId': (params?: { namespace?: string }) => findDocNodeId(params?.namespace),
  'docs.listNamespaces': () => listDocNamespaces(),

  // ── Namespace-scoped UI actions ─────────────────────────────────────
  'docs.listFiles': (params: { namespace: string }): Promise<DocEntry[]> => listFiles(params.namespace),
  'docs.search': (params: {
    namespace?: string
    pattern: string
    maxResults?: number
    literal?: boolean
  }): Promise<DocSearchResult[]> =>
    searchDocs(params.namespace, params.pattern, params.maxResults ?? 50, { literal: params.literal }),
  // The page's shared draft, as its editor opens it.
  'docs.openDraft': async (params: { namespace: string; path: string }): Promise<string> =>
    draftDocumentName(await nodeIdOf(params.namespace), params.path),
  'docs.readWorking': async (params: { namespace: string; path: string }): Promise<string> => {
    const draft = await readDraft(await nodeIdOf(params.namespace), params.path)
    if (draft === null) {
      throw new Error(`No such page: ${params.path}`)
    }
    return draft
  },
  // Replaces the page's draft; anyone editing it sees the change made.
  'docs.saveFile': async (params: { namespace: string; path: string; content: string }): Promise<void> => {
    await editDraft(await nodeIdOf(params.namespace), params.path, SAVED_FROM_OUTSIDE, () => params.content)
  },
  'docs.createFile': (params: { namespace: string; path: string; title: string }): Promise<string> =>
    createFile(params.namespace, params.path, params.title),
  'docs.readAtRef': (params: { namespace: string; path: string; ref?: string }): Promise<string | null> =>
    readDocAtRef(params.namespace, params.path, params.ref),
  'docs.fileLog': (params: { namespace: string; path?: string; count?: number }) =>
    docsFileLogByNs(params.namespace, params.path, params.count),
  'docs.changedFilesByNs': (params: { namespace: string }): Promise<string[]> => docsChangedFilesByNs(params.namespace),
  'docs.discardByNs': (params: { namespace: string; path: string }): Promise<void> =>
    docsDiscardByNs(params.namespace, params.path),
  'docs.listComments': (params: { namespace: string; path: string }): Promise<Comment[]> =>
    readComments(params.namespace, params.path),
  'docs.postComment': (params: {
    namespace: string
    path: string
    message: string
    author?: string
    parentId?: string
    anchor?: Anchor
  }): Promise<Comment> => docsPostComment(params.namespace, params.path, params.message, params.author, params.parentId, params.anchor),
}
