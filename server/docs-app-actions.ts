import type { AppActionContext, AppActionHandler } from '@opencroft/server'
import host from '@opencroft/server'

import { appendComment, broadcastCommentsUpdated, createComment, readComments } from './docs-comments'
import { type DraftEditor, deletePage, editDraft, publishPage, pullDocs, readDraft } from './docs-drafts'
import { deleteEmptyDirs, resolveDocPath, resolveNamespaceRoot } from './docs-files'
import { docsShow } from './docs-git'
import { searchDocs } from './docs-search'

// Agent-invokable actions of the Documentation App, dispatched by the host's
// `app_call` MCP tool. Each runs against ONE instance (ctx names it); the
// metadata (descriptions, input schemas) lives beside the App entry in
// extension.json. String returns are shown as text; objects are
// JSON-stringified by the host. An agent discovers instances via `app_list`
// (for a space it names, or "*").

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * The instance's namespace — how the shared file/comment helpers key their
 * roots. The instance ADDRESS, `<space>.<slug>`, both minted by the host:
 * globally unique by construction, so two instances can never shadow each
 * other the way name-derived namespaces could.
 */
function nsOf(ctx: AppActionContext): string {
  return `${ctx.spaceSlug}.${ctx.slug}`
}

function sliceLines(content: string, offset?: number, limit?: number): string {
  if (offset == null && limit == null) {
    return content
  }
  const lines = content.split('\n')
  const start = Math.max(0, (offset ?? 1) - 1)
  const end = limit != null ? Math.min(lines.length, start + limit) : lines.length
  return lines.slice(start, end).join('\n')
}

/** The calling agent, as the people editing a page are shown its edits. */
function agentOf(ctx: AppActionContext): DraftEditor {
  return { kind: 'agent', name: ctx.callerAgent ?? 'agent' }
}

/**
 * Whoever called: the signed-in person when the App's own UI did, else the
 * agent. Both are bound by the host, so this is who a commit is attributed to.
 */
function callerOf(ctx: AppActionContext): DraftEditor {
  return ctx.callerPerson ? { kind: 'user', name: ctx.callerPerson.name } : agentOf(ctx)
}

/** A doc's published content, or null when it has never been published. */
async function readPublishedOrNull(ctx: AppActionContext, relative: string): Promise<string | null> {
  try {
    return await docsShow(ctx.instanceId, relative)
  } catch {
    return null
  }
}

// ─── Actions ────────────────────────────────────────────────────────────

export const docsAppActions: Record<string, AppActionHandler> = {
  // Searches the published version via `git grep`, so drafts never match.
  search: async (ctx, args) => {
    const pattern = args.pattern as string | undefined
    if (!pattern) {
      throw new Error('Missing required param: pattern')
    }
    const maxResults = (args.maxResults as number | undefined) ?? 50
    return searchDocs(nsOf(ctx), pattern, maxResults)
  },

  // Default: the published version, the same one readers see in the App. A
  // page that was never published has none. `version: "draft"` reads the
  // page's shared draft instead, with whatever is being typed into it.
  read: async (ctx, args) => {
    const relative = args.path as string | undefined
    if (!relative) {
      throw new Error('Missing required param: path')
    }
    const version = (args.version as string | undefined) ?? 'published'
    if (version !== 'published' && version !== 'draft') {
      throw new Error(`Unknown version "${version}" — use "published" (default) or "draft".`)
    }
    const offset = args.offset as number | undefined
    const limit = args.limit as number | undefined
    await resolveDocPath(nsOf(ctx), relative)
    if (version === 'draft') {
      const draft = await readDraft(ctx.instanceId, relative)
      if (draft === null) {
        throw new Error(`File not found in working tree: ${relative}`)
      }
      return sliceLines(draft, offset, limit)
    }
    const published = await readPublishedOrNull(ctx, relative)
    if (published === null) {
      throw new Error(`Not published: ${relative}. Pass version "draft" to read an unpublished page.`)
    }
    return sliceLines(published, offset, limit)
  },

  edit: async (ctx, args) => {
    const relative = args.path as string | undefined
    const oldString = args.oldString as string | undefined
    const newString = args.newString as string | undefined
    if (!relative || oldString === undefined || newString === undefined) {
      throw new Error('Missing required params: path, oldString, newString')
    }
    if (oldString === newString) {
      throw new Error('oldString and newString must differ')
    }
    const replaceAll = Boolean(args.replaceAll)
    await resolveDocPath(nsOf(ctx), relative)
    if ((await readDraft(ctx.instanceId, relative)) === null) {
      throw new Error(`File not found: ${relative}`)
    }
    // Made in the shared draft: anyone editing the page sees it typed in,
    // and keeps what they are typing elsewhere in the page.
    let occurrences = 0
    await editDraft(ctx.instanceId, relative, agentOf(ctx), (content) => {
      occurrences = content.split(oldString).length - 1
      if (occurrences === 0) {
        throw new Error('oldString not found in file')
      }
      if (occurrences > 1 && !replaceAll) {
        throw new Error(`oldString is not unique (${occurrences} matches). Set replaceAll=true or provide more context.`)
      }
      return replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, () => newString)
    })
    return `Replaced ${replaceAll ? occurrences : 1} occurrence(s) in ${relative}.`
  },

  write: async (ctx, args) => {
    const relative = args.path as string | undefined
    const content = args.content as string | undefined
    if (!relative || content === undefined) {
      throw new Error('Missing required params: path, content')
    }
    await resolveDocPath(nsOf(ctx), relative)
    await editDraft(ctx.instanceId, relative, agentOf(ctx), () => content)
    return `Wrote ${content.length} bytes to ${relative}.`
  },

  reply: async (ctx, args) => {
    const docPath = args.docPath as string | undefined
    const commentId = args.commentId as string | undefined
    const message = args.message as string | undefined
    if (!docPath || !commentId || !message) {
      throw new Error('Missing required params: docPath, commentId, message')
    }
    const namespace = nsOf(ctx)
    const author = (args.author as string | undefined) ?? ctx.callerAgent ?? 'agent'
    await resolveDocPath(namespace, docPath)
    const existing = await readComments(namespace, docPath)
    const reply = createComment(author, message)
    await appendComment(namespace, docPath, reply, commentId)
    // Push live refresh to any open doc viewers. Best-effort/no-op on hosts without host.events.
    broadcastCommentsUpdated(docPath)
    return { replyId: reply.id, parentId: commentId, threads: existing.length }
  },

  publish: async (ctx, args) => {
    const filePath = args.path as string | undefined
    const message = args.message as string | undefined
    if (!filePath || !message) {
      throw new Error('Missing required params: path, message')
    }
    const result = await publishPage(ctx.instanceId, filePath, message, callerOf(ctx))
    return { instanceId: ctx.instanceId, path: filePath, ...result }
  },

  // The App's own UI only: deleting a published page is not offered to agents.
  delete: async (ctx, args) => {
    if (!ctx.callerPerson) {
      throw new Error('Only a person can delete a page, from the Documentation App itself.')
    }
    const filePath = args.path as string | undefined
    if (!filePath) {
      throw new Error('Missing required param: path')
    }
    const namespace = nsOf(ctx)
    await resolveDocPath(namespace, filePath)
    await deletePage(ctx.instanceId, filePath, callerOf(ctx))
    try {
      const root = await resolveNamespaceRoot(namespace)
      await deleteEmptyDirs(namespace, host.path.dirname(host.path.resolve(root, filePath)))
    } catch {
      // best-effort cleanup only
    }
    return { instanceId: ctx.instanceId, path: filePath }
  },

  pull: async (ctx) => {
    await pullDocs(ctx.instanceId)
    return 'Pulled latest changes from the remote.'
  },
}
