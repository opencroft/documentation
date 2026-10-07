import host from '@opencroft/server'

import { buildDocTree, type DocEntry } from './doc-tree'
import { docsPublishedFiles, findDocNodeId, getDocsRoot } from './docs-git'

export type { DocEntry }

// ─── Namespace root resolution ───────────────────────────────────────────

/**
 * Resolve the working-tree root directory for a documentation namespace.
 * Throws a clear, distinct error depending on why the namespace can't be
 * resolved: unknown namespace (no matching node) vs. known but not cloned.
 */
export async function resolveNamespaceRoot(namespace: string): Promise<string> {
  const nodeId = await findDocNodeId(namespace)
  if (!nodeId) {
    throw new Error(`No documentation node found for namespace "${namespace}"`)
  }
  const root = await getDocsRoot(nodeId)
  if (!root) {
    throw new Error(`No documentation repository configured for namespace "${namespace}"`)
  }
  return root
}

// ─── Path safety ──────────────────────────────────────────────────────────

async function resolveSafe(namespace: string, filePath: string): Promise<{ root: string; resolved: string }> {
  if (!filePath.endsWith('.md')) {
    throw new Error('Only .md files are editable')
  }
  const root = await resolveNamespaceRoot(namespace)
  const resolved = host.path.resolve(root, filePath)
  if (!resolved.startsWith(root)) {
    throw new Error('Access denied')
  }
  return { root, resolved }
}

/** Resolve + validate a relative doc path within a namespace, returning the absolute path. */
export async function resolveDocPath(namespace: string, filePath: string): Promise<string> {
  return (await resolveSafe(namespace, filePath)).resolved
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await host.fs.access(filePath)
    return true
  } catch {
    return false
  }
}

// A page's draft is read and written through `./docs-drafts`, which shares
// it with everyone editing the page.

function normalizeNewPath(input: string): string {
  const clean = input
    .trim()
    .replace(/^[/\\]+|[/\\]+$/g, '')
    .replace(/\\/g, '/')
  if (!clean) {
    throw new Error('Path is empty')
  }
  return clean.endsWith('.md') ? clean : `${clean}.md`
}

/**
 * Create a new doc titled `title`. A page's title is its first-level heading,
 * so the file starts as that heading alone. Fails when the file exists.
 * Returns the normalized relative path.
 */
export async function createFile(namespace: string, inputPath: string, title: string): Promise<string> {
  const heading = (title ?? '').replace(/\s+/g, ' ').trim()
  if (!heading) {
    throw new Error('Title is empty')
  }
  const relative = normalizeNewPath(inputPath)
  const root = await resolveNamespaceRoot(namespace)
  const resolved = host.path.resolve(root, relative)
  if (!resolved.startsWith(root)) {
    throw new Error('Access denied')
  }
  if (await exists(resolved)) {
    throw new Error('A file with this name already exists.')
  }
  await host.fs.mkdir(host.path.dirname(resolved), { recursive: true })
  await host.fs.writeFile(resolved, `# ${heading}\n`, 'utf-8')
  return relative
}

/** Prune now-empty parent directories up to (but not including) the namespace root. */
export async function deleteEmptyDirs(namespace: string, dir: string): Promise<void> {
  const root = await resolveNamespaceRoot(namespace)
  let current = dir
  while (current.length > root.length && current.startsWith(root)) {
    const entries = await host.fs.readdir(current)
    if (entries.length > 0) {
      return
    }
    await host.fs.rmdir(current)
    current = host.path.dirname(current)
  }
}

// ─── File tree listing ─────────────────────────────────────────────────────

/** Repository-relative paths of the `.md` files in the working tree, dot-directories skipped. */
async function workingMarkdownFiles(root: string, dirPath = ''): Promise<string[]> {
  let entries
  try {
    entries = await host.fs.readdir(host.path.resolve(root, dirPath), { withFileTypes: true })
  } catch {
    return []
  }
  const paths: string[] = []
  for (const entry of entries) {
    const relativePath = dirPath ? `${dirPath}/${entry.name}` : entry.name
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      paths.push(...(await workingMarkdownFiles(root, relativePath)))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      paths.push(relativePath)
    }
  }
  return paths
}

/** The doc tree readers browse: every published page, plus drafts that exist only in the working tree. */
export async function listFiles(namespace: string): Promise<DocEntry[]> {
  const root = await resolveNamespaceRoot(namespace)
  const nodeId = await findDocNodeId(namespace)
  const [published, working] = await Promise.all([
    nodeId ? docsPublishedFiles(nodeId) : [],
    workingMarkdownFiles(root),
  ])
  return buildDocTree(published, working)
}
