import { invoke } from '@opencroft/client/actions'
import { AppLink, AppSidebar, useAppLocation, useAppNavigate } from '@opencroft/client/app'
import {
  Button,
  ScrollArea,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@opencroft/client/ui'
import { ArrowLeft, FileText, Pencil } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Alert, AlertTitle } from '@/components/ui/alert'
import { DocPageBar } from '@/components/ui/documentation/doc-page-bar'
import { LogoLoader } from '@/components/ui/logo-loader'
import { DocDiff } from './doc-diff'
import { DocEditor } from './doc-editor'
import { defaultDoc, docAppPath, docEditAppPath, folderPage, routeOf } from './doc-routes'
import type { DocView } from './doc-selection'
import { DocTreePanel } from './doc-tree-nav'
import { DocsTitleBar } from './docs-title-bar'
import { extractToc, MarkdownContent } from './markdown-content'
import { folderOf } from './new-doc'
import { NewDocDialog } from './new-doc-dialog'
import { type OutlineTab, PageOutline } from './page-outline'
import { SearchPage } from './search-page'
import { type TreeChanged, useTreeEdits } from './tree-edits'
import { movedPath, within } from './tree-moves.ts'
import type { DocEntry, LogEntry, PublishResult } from './types'
import { useElementWidth } from './use-element-width'
import { useHeadingTracking } from './use-heading-tracking'

const NOT_RENDERED = { path: null, html: '' }

/**
 * The App's width from which the outline sits beside the page. Below it the
 * page keeps the room and the outline is a sheet. At this width the reading
 * column keeps about 34rem (roughly 70 characters) beside the 18rem outline,
 * which is where a narrower column starts to read worse than a hidden outline.
 * The App's width is the window's less the host's sidebar (24rem) and the chat
 * dock when either is open, so a laptop window with the sidebar open is still
 * above it.
 */
const OUTLINE_ASIDE_MIN_WIDTH = 880

function PageLoader({ label }: { label: string }) {
  return (
    <div className='flex justify-center py-20'>
      <LogoLoader size={40} aria-label={label} />
    </div>
  )
}

interface DocsBrowserProps {
  /** The App instance, for the actions that run as the signed-in person (publish, delete). */
  instanceId: string
  namespace: string
  /** The page the App's bare address opens when the tree has it; otherwise its first file. */
  defaultFile: string | null
  /** The open document's RAW markdown, reported as it loads. The rendered DOM
   *  cannot be turned back into the file's own words, so anything quoting the
   *  document needs the source itself. */
  onSourceChange?: (source: string) => void
  /** Which view of the open page is on screen: its shared draft in the editor
   *  and on a page never published, a version's changes picked in the
   *  history, the published page otherwise. */
  onViewChange?: (view: DocView) => void
}

/**
 * Full documentation browser for a single namespace. The open page, its
 * heading and whether it is in its editor
 * are the App's location (see doc-routes), so every page has an address, and
 * Back, Forward and a reload keep them.
 *
 * The page is mounted ONCE, whatever the width: one scroller, one copy of every
 * heading. What changes with the width is where the outline is — beside the
 * page or in a sheet — and the host's title bar and sidebar carry the rest.
 */
export function DocsBrowser({ instanceId, namespace, defaultFile, onSourceChange, onViewChange }: DocsBrowserProps) {
  const location = useAppLocation()
  const navigate = useAppNavigate()
  const route = routeOf(location.path, location.search)
  const selectedPath = route.page === 'doc' ? route.doc : null
  const heading = route.page === 'doc' ? route.heading : null
  const editRequested = route.page === 'doc' && route.edit
  const openDoc = useCallback(
    (p: string | null, options?: { replace?: boolean }) => navigate(p ? docAppPath(p) : '/', options),
    [navigate],
  )

  const rootRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // Where the editor puts its draft bar: below the page's scroller, see the layout.
  const [draftBarSlot, setDraftBarSlot] = useState<HTMLDivElement | null>(null)
  const width = useElementWidth(rootRef)
  const outlineBesidePage = width !== null && width >= OUTLINE_ASIDE_MIN_WIDTH
  const [outlineOpen, setOutlineOpen] = useState(false)

  const [tree, setTree] = useState<DocEntry[] | null>(null)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [docContent, setDocContent] = useState<string | null>(null)
  // The page last read that has no published version: it exists only as a
  // draft, so it opens in its editor.
  const [draftOnlyPath, setDraftOnlyPath] = useState<string | null>(null)

  // Report the raw markdown up as it loads. Kept as an effect on the state
  // rather than fired at each fetch site: the content is set from several
  // paths (published read, ref view, reset on file change) and a caller
  // wanting "what is open now" should not have to know which of them ran.
  // Off a doc page (the search results) nothing is open.
  useEffect(() => {
    onSourceChange?.(selectedPath ? (docContent ?? '') : '')
  }, [docContent, selectedPath, onSourceChange])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The rendered HTML is kept with the doc it was rendered from. Once the
  // address names another doc there is none until that doc renders, so
  // nothing reads the previous page's headings as this one's.
  const [rendered, setRendered] = useState<{ path: string | null; html: string }>(NOT_RENDERED)
  const renderedHtml = rendered.path === selectedPath ? rendered.html : ''
  const setRenderedHtml = useCallback((html: string) => setRendered({ path: selectedPath, html }), [selectedPath])
  // The shared draft the editor has open: its page and document name.
  const [draft, setDraft] = useState<{ path: string; document: string } | null>(null)
  // Not on an address that names no page.
  const editing = editRequested && draft?.path === selectedPath && !error
  // Why the page last asked for in its editor opened read-only instead.
  const [editRefused, setEditRefused] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  // Each opening of New document is a fresh dialog, starting from the open page's folder.
  const [createKey, setCreateKey] = useState(0)

  const [showUnpublishedOnly, setShowUnpublishedOnly] = useState(false)
  const [gitChangedFiles, setGitChangedFiles] = useState<Set<string>>(new Set())
  const [rightTab, setRightTab] = useState<OutlineTab>('toc')
  const [fileLog, setFileLog] = useState<LogEntry[]>([])
  // A version picked in the history, shown as its changes against the version
  // before it; `before` is empty for the version that created the page.
  const [viewing, setViewing] = useState<{ entry: LogEntry; before: string; after: string } | null>(null)

  // A published page is on screen for reading. It is also the only state with
  // something to outline: not while loading, editing, or on a draft-only page.
  const reading = selectedPath !== null && docContent !== null && !loading && !editRequested && !error

  const { registerToc, handleHeadingClick } = useHeadingTracking({ contentRef, renderedHtml, selectedPath, heading })

  // ── Fetch file tree ───────────────────────────────────────────────────────
  const refreshTree = useCallback(async () => {
    const next = await invoke<DocEntry[]>('docs.listFiles', { namespace })
    setTree(next)
    return next
  }, [namespace])

  useEffect(() => {
    // An unreadable tree is an empty one, so nothing waits on it forever.
    refreshTree().catch(() => setTree((current) => current ?? []))
  }, [refreshTree])

  // ── Auto-expand parent directories when selecting a file ──────────────────
  useEffect(() => {
    if (!selectedPath) {
      return
    }
    const parts = selectedPath.split('/')
    setExpandedPaths((expanded) => {
      const next = new Set(expanded)
      let cur = ''
      for (let i = 0; i < parts.length - 1; i++) {
        cur = cur ? `${cur}/${parts[i]}` : parts[i]
        next.add(cur)
      }
      return next
    })
  }, [selectedPath])

  // ── The bare address is replaced by the default page's ────────────────────
  const homeDoc = tree && route.page === 'home' ? defaultDoc(tree, defaultFile) : null
  useEffect(() => {
    if (homeDoc) {
      openDoc(homeDoc, { replace: true })
    }
  }, [homeDoc, openDoc])

  // ── Load document content ─────────────────────────────────────────────────
  const loadSeqRef = useRef(0)
  const loadDoc = useCallback(
    async (p: string) => {
      const seq = ++loadSeqRef.current
      setLoading(true)
      setError(null)
      setDocContent(null)
      setDraftOnlyPath(null)
      setRendered(NOT_RENDERED)
      setViewing(null)
      setFileLog([])
      try {
        // A reader sees the PUBLISHED page. One that has never been published
        // has none to read, and opens in its editor if it has a draft. An
        // address with neither names no page.
        const content = await invoke<string | null>('docs.readAtRef', { namespace, path: p })
        const hasDraft =
          content === null &&
          (await invoke<string>('docs.readWorking', { namespace, path: p }).then(
            () => true,
            () => false,
          ))
        if (seq !== loadSeqRef.current) {
          return
        }
        if (content !== null) {
          setDocContent(content)
        } else if (hasDraft) {
          setDraftOnlyPath(p)
        } else {
          setError("This page doesn't exist.")
        }
      } catch {
        if (seq !== loadSeqRef.current) {
          return
        }
        setError('Failed to load document')
      }
      setLoading(false)
      invoke<LogEntry[]>('docs.fileLog', { namespace, path: p })
        .then((log) => seq === loadSeqRef.current && setFileLog(log))
        .catch(() => {})
    },
    [namespace],
  )

  useEffect(() => {
    if (!selectedPath) {
      return
    }
    setEditRefused(null)
    loadDoc(selectedPath)
  }, [selectedPath, loadDoc])

  // A page with no published version has nothing to read: its reading address
  // is replaced by its editor's. Not when its draft couldn't be opened, which
  // the reading address says instead.
  const draftOnly = selectedPath !== null && draftOnlyPath === selectedPath
  useEffect(() => {
    if (selectedPath && draftOnly && !editRequested && !editRefused) {
      navigate(docEditAppPath(selectedPath), { replace: true })
    }
  }, [selectedPath, draftOnly, editRequested, editRefused, navigate])

  // The editor shows the page's draft, and so does a page with no published
  // version; a version's changes are shown only while reading (see the page
  // below), so the editor wins over a version still picked in the history.
  const viewingRef = viewing?.entry.sha ?? null
  useEffect(() => {
    onViewChange?.(editRequested || draftOnly ? 'draft' : viewingRef ? `changes:${viewingRef}` : 'page')
  }, [editRequested, draftOnly, viewingRef, onViewChange])

  // Display shows the published page; edit mode opens the page's draft, the
  // one everyone editing the page shares, unpublished edits and all. A page
  // whose draft can't be opened is shown read-only, at its reading address.
  useEffect(() => {
    if (!selectedPath || !editRequested) {
      setDraft(null)
      return
    }
    setEditRefused(null)
    let cancelled = false
    invoke<string>('docs.openDraft', { namespace, path: selectedPath })
      .then((document) => !cancelled && setDraft({ path: selectedPath, document }))
      .catch(() => {
        if (!cancelled) {
          setEditRefused("This page couldn't be opened for editing.")
          navigate(docAppPath(selectedPath), { replace: true })
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedPath, editRequested, namespace, navigate])

  const handleStartEdit = useCallback(() => {
    if (selectedPath) {
      navigate(docEditAppPath(selectedPath))
    }
  }, [selectedPath, navigate])

  // Back from the editor, and where a discarded draft leaves a published page.
  // Leaving keeps the draft: the host has written every change to it already.
  const handleStopEdit = useCallback(() => {
    if (selectedPath) {
      navigate(docAppPath(selectedPath))
    }
  }, [selectedPath, navigate])

  // Discarding the draft of a page never published deletes the page, so its
  // address names nothing and is replaced by the default page's.
  const handleDiscard = useCallback(async () => {
    if (!draftOnly) {
      handleStopEdit()
      return
    }
    const next = await refreshTree().catch(() => [])
    openDoc(defaultDoc(next, defaultFile), { replace: true })
  }, [draftOnly, handleStopEdit, refreshTree, openDoc, defaultFile])

  // Something moved: the tree is read again, and an open page or folder that
  // moved is followed to where it went, its old address replaced. An open page
  // that was deleted, or was in a deleted folder, leaves an address that names
  // nothing: it is replaced by the default page's rather than left for Back.
  const handleTreeChanged = useCallback(
    async ({ from, to }: TreeChanged) => {
      const next = await refreshTree()
      if (to === null) {
        setExpandedPaths((expanded) => new Set([...expanded].filter((path) => !within(path, from))))
        if (selectedPath && within(selectedPath, from)) {
          openDoc(defaultDoc(next, defaultFile), { replace: true })
        }
        return
      }
      setExpandedPaths((expanded) => new Set([...expanded].map((path) => movedPath(path, from, to))))
      if (selectedPath && movedPath(selectedPath, from, to) !== selectedPath) {
        const moved = movedPath(selectedPath, from, to)
        navigate(editRequested ? docEditAppPath(moved) : docAppPath(moved), { replace: true })
      }
    },
    [refreshTree, selectedPath, editRequested, navigate, openDoc, defaultFile],
  )
  const { startMove, startRename, startDelete, drop, dialogs, notice, showUnrewritten } = useTreeEdits({
    instanceId,
    tree: tree ?? [],
    onChanged: handleTreeChanged,
  })

  // The published page is the whole shared draft, which this editor saw only
  // part of the making of: read back. A new title can have moved it, in which
  // case its old address names nothing, so it is replaced.
  const handlePublish = useCallback(
    (published: PublishResult) => {
      showUnrewritten(published.unrewrittenLinks)
      if (published.path !== selectedPath) {
        navigate(docAppPath(published.path), { replace: true })
      } else if (selectedPath) {
        navigate(docAppPath(selectedPath))
        loadDoc(selectedPath)
      }
      // The page is published now, so its draft marker has to go.
      refreshTree().catch(() => {})
    },
    [selectedPath, navigate, loadDoc, refreshTree, showUnrewritten],
  )

  const handleViewRef = useCallback(
    async (sha: string) => {
      const entry = fileLog.find((e) => e.sha === sha)
      if (!selectedPath || !entry) {
        return
      }
      // The page's load sequence: a version that arrives after the reader has
      // moved to another page is not shown on that one.
      const seq = loadSeqRef.current
      const [after, before] = await Promise.all([
        invoke<string | null>('docs.readAtRef', { namespace, path: selectedPath, ref: sha }),
        // The version before this one; none when this one created the page.
        invoke<string | null>('docs.readAtRef', { namespace, path: selectedPath, ref: `${sha}^` }),
      ])
      if (after !== null && seq === loadSeqRef.current) {
        setViewing({ entry, before: before ?? '', after })
      }
    },
    [selectedPath, namespace, fileLog],
  )

  const handleBackToCurrent = useCallback(() => setViewing(null), [])

  const toggleUnpublished = useCallback(async () => {
    if (showUnpublishedOnly) {
      setShowUnpublishedOnly(false)
      setGitChangedFiles(new Set())
    } else {
      const files = await invoke<string[]>('docs.changedFilesByNs', { namespace })
      setGitChangedFiles(new Set(files))
      setShowUnpublishedOnly(true)
    }
  }, [showUnpublishedOnly, namespace])

  const openCreate = useCallback(() => {
    setCreateKey((k) => k + 1)
    setCreateOpen(true)
  }, [])

  const handleCreate = useCallback(
    async (path: string, title: string) => {
      const created = await invoke<string>('docs.createFile', { namespace, path, title })
      await refreshTree()
      setCreateOpen(false)
      navigate(docEditAppPath(created))
    },
    [refreshTree, navigate, namespace],
  )

  // A version's changes are not the page the outline's headings point into.
  const tocItems = useMemo(() => (viewing ? [] : extractToc(renderedHtml)), [viewing, renderedHtml])

  const handleToggle = useCallback((dirPath: string) => {
    setExpandedPaths((prev) => {
      const n = new Set(prev)
      if (n.has(dirPath)) {
        n.delete(dirPath)
      } else {
        n.add(dirPath)
      }
      return n
    })
  }, [])

  // ── Filter tree for unpublished changes ───────────────────────────────────
  const filteredTree = useMemo(() => {
    if (!tree || !showUnpublishedOnly || gitChangedFiles.size === 0) {
      return tree ?? []
    }
    const filterEntries = (entries: DocEntry[]): DocEntry[] => {
      const result: DocEntry[] = []
      for (const entry of entries) {
        if (entry.type === 'file') {
          if (gitChangedFiles.has(entry.path)) {
            result.push(entry)
          }
        } else if (entry.children) {
          const filtered = filterEntries(entry.children)
          if (filtered.length > 0) {
            result.push({ ...entry, children: filtered })
          }
        }
      }
      return result
    }
    return filterEntries(tree)
  }, [tree, showUnpublishedOnly, gitChangedFiles])

  const outline = (
    <PageOutline
      tab={rightTab}
      onTabChange={setRightTab}
      tocItems={tocItems}
      registerToc={registerToc}
      onHeadingClick={handleHeadingClick}
      fileLog={fileLog}
      viewingRef={viewingRef}
      onViewRef={handleViewRef}
      onBackToCurrent={handleBackToCurrent}
      onChosen={() => setOutlineOpen(false)}
    />
  )

  // The open page's path, with the action of the view it is in. Every view of
  // a page has it: reading, the editor and a version from the history.
  const pathBar = (action?: ReactNode) =>
    selectedPath && (
      <DocPageBar
        path={selectedPath}
        renderFolderLink={(folder, segment) => {
          const page = folderPage(tree ?? [], folder)
          return page ? <AppLink to={docAppPath(page)} {...segment} /> : null
        }}
        className='mb-2'
      >
        {action}
      </DocPageBar>
    )

  // Back from the editor or a version from the history: the page as it reads.
  const backButton = (onClick: () => void) => (
    <Button size='sm' variant='ghost' onClick={onClick}>
      <ArrowLeft /> Back
    </Button>
  )

  const page =
    route.page === 'search' ? (
      <SearchPage namespace={namespace} query={route.query} />
    ) : (
      <>
        {loading && <PageLoader label='Loading page' />}
        {error && (
          <div className='flex flex-col items-center justify-center py-20 gap-2 text-destructive'>
            <p className='font-medium'>Error</p>
            <p className='text-sm text-muted-foreground'>{error}</p>
          </div>
        )}
        {/* A page never published has no reading view to go back to. */}
        {editing && draft !== null && selectedPath && pathBar(draftOnly ? undefined : backButton(handleStopEdit))}
        {editing && draft !== null && selectedPath && (
          <DocEditor
            instanceId={instanceId}
            namespace={namespace}
            filePath={selectedPath}
            document={draft.document}
            onPublish={handlePublish}
            onDiscard={handleDiscard}
            draftBarSlot={draftBarSlot}
          />
        )}
        {editRequested && !editing && !loading && !error && <PageLoader label='Opening the editor' />}
        {editRefused && !editRequested && (
          <Alert variant='destructive' className='mb-4'>
            <AlertTitle>{editRefused}</AlertTitle>
          </Alert>
        )}
        {reading && viewing && (
          <>
            {pathBar(backButton(handleBackToCurrent))}
            <DocDiff
              before={viewing.before}
              after={viewing.after}
              currentPath={selectedPath}
              onHeadingClick={handleHeadingClick}
            />
          </>
        )}
        {reading && !viewing && docContent !== null && (
          <>
            {pathBar(
              <Button size='sm' variant='ghost' onClick={handleStartEdit}>
                <Pencil /> Edit
              </Button>,
            )}
            <MarkdownContent
              content={docContent}
              currentPath={selectedPath}
              onHeadingClick={handleHeadingClick}
              onRendered={setRenderedHtml}
            />
          </>
        )}
        {/* The bare address is on its way to the default page until the tree
            says there is none, so it shows the page loader until then. */}
        {!selectedPath && !loading && !error && (tree === null || homeDoc) && (
          <PageLoader label='Loading documentation' />
        )}
        {!selectedPath && !loading && !error && tree !== null && !homeDoc && (
          <div className='flex flex-col items-center justify-center py-20 gap-2 text-muted-foreground'>
            <FileText className='size-10' />
            <p className='text-sm'>Select a file from the sidebar</p>
          </div>
        )}
      </>
    )

  // The browser fills the height it is given, whether its parent is a flex
  // container or not. The page has one scroller, at every width; the outline
  // beside it scrolls on its own.
  return (
    <div ref={rootRef} className='flex h-full min-h-0 flex-1'>
      <DocsTitleBar
        route={route}
        onNew={openCreate}
        onOpenOutline={!outlineBesidePage && reading ? () => setOutlineOpen(true) : null}
      />
      <AppSidebar mode='push'>
        <DocTreePanel
          entries={filteredTree}
          changedFiles={gitChangedFiles}
          selectedPath={selectedPath}
          expandedPaths={expandedPaths}
          onToggle={handleToggle}
          onRename={startRename}
          onMove={startMove}
          onDelete={startDelete}
          onDrop={drop}
          unpublishedOnly={showUnpublishedOnly}
          onToggleUnpublished={toggleUnpublished}
        />
      </AppSidebar>

      <div className='flex min-w-0 flex-1 flex-col'>
        <ScrollArea className='min-h-0 flex-1'>
          <div ref={contentRef} className='mx-auto w-full min-w-0 max-w-4xl px-4 py-4 sm:px-8 sm:py-6'>
            {notice}
            {page}
          </div>
        </ScrollArea>
        {/* The editor's draft bar lands here, after the scroller rather than in
            it: in view however long the page is, and nothing scrolls behind it. */}
        <div ref={setDraftBarSlot} className='mx-auto w-full min-w-0 max-w-4xl px-4 sm:px-8' />
      </div>

      {outlineBesidePage && reading ? (
        <aside className='w-72 shrink-0 border-l'>
          <ScrollArea className='h-full'>{outline}</ScrollArea>
        </aside>
      ) : null}
      {!outlineBesidePage ? (
        <Sheet open={outlineOpen && reading} onOpenChange={setOutlineOpen}>
          <SheetContent side='right'>
            <SheetHeader className='sr-only'>
              <SheetTitle>On this page</SheetTitle>
              <SheetDescription>Headings and history of this page</SheetDescription>
            </SheetHeader>
            <ScrollArea className='min-h-0 flex-1'>{outline}</ScrollArea>
          </SheetContent>
        </Sheet>
      ) : null}

      <NewDocDialog
        key={createKey}
        open={createOpen}
        onOpenChange={setCreateOpen}
        tree={tree ?? []}
        initialFolder={folderOf(selectedPath)}
        onCreate={handleCreate}
      />
      {dialogs}
    </div>
  )
}
