import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { FolderMeta } from './doc-meta.ts'
import {
  type LinkSources,
  planFolderTitle,
  planMove,
  planPublish,
  shownOrder,
  type TreeState,
  withLinks,
} from './tree-plan.ts'

function state(head: string[], working: string[] = head, metas: [string, FolderMeta][] = []): TreeState {
  return { head, working, metas: new Map(metas) }
}

const repo = state(['index.md', 'a.md', 'b.md', 'guides/intro.md', 'guides/setup.md', 'guides/img/x.png', 'api/ref.md'])

test('the shown order is the meta order, then folders and pages by name', () => {
  assert.deepEqual(shownOrder(repo, ''), ['api', 'guides', 'a.md', 'b.md', 'index.md'])
  const ordered = state(repo.head, repo.head, [['', { order: ['b.md', 'guides'] }]])
  assert.deepEqual(shownOrder(ordered, ''), ['b.md', 'guides', 'api', 'a.md', 'index.md'])
})

test('moving a page into another folder at a position writes both folders meta', () => {
  const plan = planMove(repo, 'a.md', 'guides', 1)
  assert.deepEqual(plan.renames, [{ from: 'a.md', to: 'guides/a.md' }])
  assert.equal(plan.path, 'guides/a.md')
  assert.deepEqual(JSON.parse(plan.published.get('guides/_meta.json') ?? ''), {
    order: ['intro.md', 'a.md', 'setup.md'],
  })
  assert.deepEqual(JSON.parse(plan.published.get('_meta.json') ?? ''), { order: ['api', 'guides', 'b.md', 'index.md'] })
})

test('the folder a move empties keeps its meta as it was', () => {
  const plan = planMove(repo, 'api/ref.md', '', 0)
  assert.equal(plan.published.has('api/_meta.json'), false)
  assert.deepEqual(JSON.parse(plan.published.get('_meta.json') ?? '').order[0], 'ref.md')
})

test('moving within the folder only reorders it, keeping the folder title', () => {
  const titled = state(repo.head, repo.head, [['guides', { title: 'Guides', order: ['intro.md'] }]])
  const plan = planMove(titled, 'guides/setup.md', 'guides', 0)
  assert.deepEqual(plan.renames, [])
  assert.deepEqual(JSON.parse(plan.published.get('guides/_meta.json') ?? ''), {
    title: 'Guides',
    order: ['setup.md', 'intro.md'],
  })
})

test('a committed meta names only what the commit holds: no draft-only page, no name that is gone', () => {
  const drafted = state(
    ['a.md', 'b.md', '_meta.json'],
    ['a.md', 'b.md', '_meta.json', 'draft.md'],
    [['', { order: ['gone.md', 'a.md', 'b.md'] }]],
  )
  assert.deepEqual(shownOrder(drafted, ''), ['a.md', 'b.md', 'draft.md'])
  const plan = planMove(drafted, 'b.md', '', 0)
  assert.deepEqual(JSON.parse(plan.published.get('_meta.json') ?? ''), { order: ['b.md', 'a.md'] })
})

test('a draft-only page is not placed within its folder until it is published', () => {
  const drafted = state(['a.md', 'b.md'], ['a.md', 'b.md', 'draft.md'])
  assert.throws(() => planMove(drafted, 'draft.md', '', 0), /"draft.md" isn't published yet/)
  assert.throws(() => planMove(state(['a.md'], ['a.md', 'new/x.md']), 'new', '', 0), /"new" isn't published yet/)
})

test('moving a draft-only page writes no meta its commit would leave as it is', () => {
  const head = ['a.md', 'guides/x.md', 'guides/_meta.json', '_meta.json']
  const drafted = state(
    head,
    [...head, 'draft.md'],
    [
      ['guides', { order: ['x.md'] }],
      ['', { order: ['guides', 'a.md'] }],
    ],
  )
  const plan = planMove(drafted, 'draft.md', 'guides', 0)
  assert.deepEqual(plan.renames, [{ from: 'draft.md', to: 'guides/draft.md' }])
  assert.deepEqual(plan.published, new Map())
})

test('publishing a draft-only page under a new name puts it in its folder meta', () => {
  const head = ['guides/x.md', 'guides/_meta.json']
  const drafted = state(head, [...head, 'guides/draft-page.md'], [['guides', { order: ['x.md'] }]])
  const plan = planPublish(drafted, 'guides/draft-page.md', '# Final name\n', 'm')
  assert.deepEqual(JSON.parse(plan?.published.get('guides/_meta.json') ?? ''), { order: ['x.md', 'final-name.md'] })
})

test('a move is refused into a folder holding the name, and a folder into itself', () => {
  const clash = state([...repo.head, 'guides/a.md'])
  assert.throws(() => planMove(clash, 'a.md', 'guides'), /"guides" already has a page or folder named "a.md"/)
  assert.throws(() => planMove(state([...repo.head, 'api/guides/x.md']), 'guides', 'api'), /already has/)
  assert.throws(() => planMove(repo, 'guides', 'guides/img'), /can't be moved into itself/)
  assert.throws(() => planMove(repo, 'nope.md', ''), /There is no page or folder "nope.md"/)
  assert.throws(() => planMove(repo, 'a.md', '../out'), /not a folder/)
})

test('a page and a folder of the same label clash', () => {
  assert.throws(() => planMove(state([...repo.head, 'x/api.md']), 'x/api.md', ''), /named "api.md"/)
})

test('a folder title renames the folder to its slug and writes the title', () => {
  const plan = planFolderTitle(repo, 'guides', 'User Guides')
  assert.deepEqual(plan.renames, [{ from: 'guides', to: 'user-guides' }])
  assert.deepEqual(JSON.parse(plan.published.get('user-guides/_meta.json') ?? ''), { title: 'User Guides' })
  assert.deepEqual(JSON.parse(plan.published.get('_meta.json') ?? '').order, [
    'api',
    'user-guides',
    'a.md',
    'b.md',
    'index.md',
  ])
})

test('a title with the same slug writes the title alone', () => {
  const plan = planFolderTitle(repo, 'guides', '  Guides ')
  assert.deepEqual(plan.renames, [])
  assert.deepEqual([...plan.published.keys()], ['guides/_meta.json'])
})

test('a folder title is refused when empty, without letters, or taken', () => {
  assert.throws(() => planFolderTitle(repo, 'guides', ' '), /can't be empty/)
  assert.throws(() => planFolderTitle(repo, 'guides', '???'), /no letters or digits/)
  assert.throws(() => planFolderTitle(repo, 'guides', 'API'), /already has a page or folder named "api"/)
  assert.throws(() => planFolderTitle(repo, '', 'Top'), /has no title/)
})

test('publishing names the file after the title and renames its meta entry', () => {
  const plan = planPublish(repo, 'guides/setup.md', '# Installing it\n\nText', 'Update setup')
  assert.ok(plan)
  assert.deepEqual(plan.renames, [{ from: 'guides/setup.md', to: 'guides/installing-it.md' }])
  assert.equal(plan.published.get('guides/installing-it.md'), '# Installing it\n\nText')
  assert.deepEqual(JSON.parse(plan.published.get('guides/_meta.json') ?? '').order, ['intro.md', 'installing-it.md'])
})

test('a page whose title matches its file, or a kept name, publishes where it is', () => {
  assert.equal(planPublish(repo, 'a.md', '# A\n', 'm'), null)
  assert.equal(planPublish(repo, 'index.md', '# Welcome\n', 'm'), null)
  assert.equal(planPublish(state(['docs/README.md']), 'docs/README.md', '# Docs home\n', 'm'), null)
})

test('a non-Latin title keeps its letters in the file name', () => {
  assert.equal(planPublish(repo, 'b.md', '# Начало работы\n', 'm')?.path, 'начало-работы.md')
})

test('publishing is refused without a title, with an empty one, or a taken name', () => {
  assert.throws(() => planPublish(repo, 'a.md', 'No heading\n', 'm'), /has to start with its title/)
  assert.throws(() => planPublish(repo, 'a.md', '#\n\nText', 'm'), /title is empty/)
  assert.throws(() => planPublish(repo, 'a.md', '# !!!\n', 'm'), /no letters or digits/)
  assert.throws(() => planPublish(repo, 'a.md', '# B\n', 'm'), /already has a page or folder named "b"/)
  assert.throws(() => planPublish(repo, 'a.md', '# Guides\n', 'm'), /named "guides"/)
})

function sources(
  head: Record<string, string>,
  drafts: Record<string, string> = {},
  candidates = Object.keys(head),
): LinkSources {
  return {
    readHead: async (path) => {
      if (!(path in head)) {
        throw new Error(`not in head: ${path}`)
      }
      return head[path]
    },
    candidates,
    drafts: new Map(Object.entries(drafts)),
  }
}

test('a move rewrites links in published pages and drafts, and keeps the moved draft a draft', async () => {
  const s = state(['a.md', 'b.md', 'guides/c.md'])
  const plan = planMove(s, 'a.md', 'guides', 0)
  const { change, unrewritten } = await withLinks(
    s,
    plan,
    sources(
      { 'a.md': '# A\n[b](b.md)\n', 'b.md': '# B\n[a](a.md)\n', 'guides/c.md': '# C\n' },
      { 'a.md': '# A draft\n[b](b.md)\n', 'b.md': '# B draft\n[a](a.md)\n' },
    ),
  )
  assert.deepEqual(unrewritten, [])
  assert.equal(change.published.get('guides/a.md'), '# A\n[b](../b.md)\n')
  assert.equal(change.published.get('b.md'), '# B\n[a](guides/a.md)\n')
  assert.equal(change.drafts.get('guides/a.md'), '# A draft\n[b](../b.md)\n')
  assert.equal(change.drafts.get('b.md'), '# B draft\n[a](guides/a.md)\n')
  assert.equal(change.published.has('guides/c.md'), false)
})

test('a moved page with no draft and no links to change is moved, not rewritten', async () => {
  const s = state(['a.md', 'guides/c.md'])
  const { change } = await withLinks(
    s,
    planMove(s, 'a.md', 'guides'),
    sources({ 'a.md': '# A\n', 'guides/c.md': '# C\n' }),
  )
  assert.equal(change.published.has('guides/a.md'), false)
  assert.deepEqual(change.drafts, new Map())
})

test('publishing under a new name leaves no draft of the page and fixes links to it', async () => {
  const s = state(['old.md', 'other.md'])
  const plan = planPublish(s, 'old.md', '# New name\n[self](old.md#x)\n', 'Publish')
  assert.ok(plan)
  const { change } = await withLinks(
    s,
    plan,
    sources({ 'old.md': '# Old\n', 'other.md': '[o](old.md)\n' }, { 'old.md': '# New name\n[self](old.md#x)\n' }),
    'old.md',
  )
  assert.equal(change.published.get('new-name.md'), '# New name\n[self](new-name.md#x)\n')
  assert.equal(change.published.get('other.md'), '[o](new-name.md)\n')
  assert.equal(change.drafts.has('new-name.md'), false)
})

test('mentions of the old path in published pages and drafts are listed, not edited', async () => {
  const s = state(['notes/old-name.md', 'b.md'])
  const plan = planPublish(s, 'notes/old-name.md', '# New name\n', 'Publish')
  assert.ok(plan)
  const { change, unrewritten } = await withLinks(
    s,
    plan,
    sources(
      { 'notes/old-name.md': '# Old\n', 'b.md': 'Read `notes/old-name.md` first.\n' },
      { 'b.md': 'Draft: see old-name.md.\n' },
    ),
    'notes/old-name.md',
  )
  assert.deepEqual(
    unrewritten.map((u) => [u.file, u.line, u.link]),
    [
      ['b.md', 1, 'notes/old-name.md'],
      ['b.md', 1, 'old-name.md'],
    ],
  )
  assert.equal(change.published.has('b.md'), false)
  assert.equal(change.drafts.has('b.md'), false)
})

test('links that cannot be rewritten are listed once', async () => {
  const s = state(['a.md', 'b.md'])
  const { unrewritten } = await withLinks(
    s,
    planMove(s, 'a.md', 'x'),
    sources({ 'a.md': '# A\n', 'b.md': '[a](/a.md)\n' }, { 'b.md': '[a](/a.md)\n' }),
  )
  assert.deepEqual(
    unrewritten.map((u) => [u.file, u.line, u.link]),
    [['b.md', 1, '/a.md']],
  )
})
