import host from '@opencroft/server'

import { resolveNamespaceRoot } from './docs-files'

export interface Anchor {
  quote: string
  prefix?: string
  suffix?: string
}

export interface Comment {
  id: string
  author: string
  message: string
  timestamp: number
  anchor?: Anchor
  replies: Comment[]
}

interface CommentFile {
  version: 1
  comments: Comment[]
}

async function resolveCommentsPath(namespace: string, docPath: string): Promise<string> {
  if (!docPath.endsWith('.md')) {
    throw new Error('Only .md files have comments')
  }
  const root = await resolveNamespaceRoot(namespace)
  const resolved = host.path.resolve(root, docPath)
  if (!resolved.startsWith(root)) {
    throw new Error('Access denied')
  }
  return `${resolved}.comments`
}

export async function readComments(namespace: string, docPath: string): Promise<Comment[]> {
  const file = await resolveCommentsPath(namespace, docPath)
  try {
    const raw = await host.fs.readFile(file, 'utf-8')
    const parsed = JSON.parse(raw) as CommentFile
    return parsed.comments ?? []
  } catch {
    return []
  }
}

async function writeCommentsTree(namespace: string, docPath: string, comments: Comment[]): Promise<void> {
  const file = await resolveCommentsPath(namespace, docPath)
  const payload: CommentFile = { version: 1, comments }
  await host.fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf-8')
}

function findAndPush(nodes: Comment[], parentId: string, reply: Comment): boolean {
  for (const node of nodes) {
    if (node.id === parentId) {
      node.replies.push(reply)
      return true
    }
    if (findAndPush(node.replies, parentId, reply)) {
      return true
    }
  }
  return false
}

// The extension server host doesn't guarantee a global WebCrypto `crypto`, but does expose
// `host.crypto.randomToken()`, which is an equally-unique (if not UUID-shaped) id source.
function randomId(): string {
  return host.crypto.randomToken()
}

export function createComment(author: string, message: string, anchor?: Anchor): Comment {
  return {
    id: randomId(),
    author,
    message,
    timestamp: Date.now(),
    ...(anchor ? { anchor } : {}),
    replies: [],
  }
}

export async function appendComment(namespace: string, docPath: string, comment: Comment, parentId?: string): Promise<void> {
  const comments = await readComments(namespace, docPath)
  if (parentId) {
    if (!findAndPush(comments, parentId, comment)) {
      throw new Error(`Parent comment not found: ${parentId}`)
    }
  } else {
    comments.push(comment)
  }
  await writeCommentsTree(namespace, docPath, comments)
}

function hasDescendant(node: Comment, id: string): boolean {
  if (node.id === id) {
    return true
  }
  return node.replies.some((r) => hasDescendant(r, id))
}

export function findThreadRoot(comments: Comment[], commentId: string): Comment | null {
  for (const root of comments) {
    if (hasDescendant(root, commentId)) {
      return root
    }
  }
  return null
}

// The host's push channel (`host.events.broadcast`) may be ABSENT on older hosts, so every call
// site must feature-detect rather than assume it exists.
interface HostWithEvents {
  events?: {
    broadcast: (name: string, payload?: Record<string, unknown>) => void
  }
}

/** Best-effort SSE push telling open doc viewers that comments for `docPath` changed. No-op on hosts without `host.events`. */
export function broadcastCommentsUpdated(docPath: string): void {
  const events = (host as unknown as HostWithEvents).events
  events?.broadcast('doc_comments_updated', { path: docPath })
}
