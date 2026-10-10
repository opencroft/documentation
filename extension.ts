import { docsApps } from './server/docs-app'
import {
  type DraftEditor,
  discardPage,
  draftDocumentName,
  editDraft,
  pullDocs,
  readDraft,
  registerDocDrafts,
} from './server/docs-drafts'
import { createFile, type DocEntry, listFiles } from './server/docs-files'
import {
  docsAddFile,
  docsChangedFiles,
  docsLog,
  docsShow,
  findActiveDocsRoot,
  findDocNodeId,
  listDocNamespaces,
} from './server/docs-git'
import { type DocSearchAnswer, searchDocs } from './server/docs-search'

export function load() {
  registerDocDrafts()
}

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

export const actions = {
  'docs.pull': (params: { nodeId: string }) => pullDocs(params.nodeId),
  'docs.changedFiles': (params: { nodeId: string }) => docsChangedFiles(params.nodeId),
  'docs.log': (params: { nodeId: string; filePath?: string; count?: number }) =>
    docsLog(params.nodeId, params.filePath, params.count),
  'docs.show': (params: { nodeId: string; filePath: string; ref?: string }) =>
    docsShow(params.nodeId, params.filePath, params.ref),
  'docs.addFile': (params: { nodeId: string; filePath: string }) => docsAddFile(params.nodeId, params.filePath),
  'docs.discardFile': (params: { nodeId: string; filePath: string }) => discardPage(params.nodeId, params.filePath),
  'docs.findActiveDocsRoot': (params?: { namespace?: string }) => findActiveDocsRoot(params?.namespace),
  'docs.findDocNodeId': (params?: { namespace?: string }) => findDocNodeId(params?.namespace),
  'docs.listNamespaces': () => listDocNamespaces(),

  // ── Namespace-scoped UI actions ─────────────────────────────────────
  'docs.listFiles': (params: { namespace: string }): Promise<DocEntry[]> => listFiles(params.namespace),
  // A reader's search: the same ranked search agents run, over one app.
  'docs.search': (params: { namespace: string; query: string }): Promise<DocSearchAnswer> =>
    searchDocs([params.namespace], { query: params.query, limit: 50, perPage: 3 }),
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
}
