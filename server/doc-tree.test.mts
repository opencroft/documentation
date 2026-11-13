import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildDocTree } from './doc-tree.ts'

test('published pages form the tree, directories first, then names in order', () => {
  assert.deepEqual(buildDocTree(['b.md', 'guides/setup.md', 'a.md', 'guides/intro.md'], []), [
    {
      name: 'guides',
      path: 'guides',
      type: 'directory',
      title: 'guides',
      children: [
        { name: 'intro.md', path: 'guides/intro.md', type: 'file', title: 'intro' },
        { name: 'setup.md', path: 'guides/setup.md', type: 'file', title: 'setup' },
      ],
    },
    { name: 'a.md', path: 'a.md', type: 'file', title: 'a' },
    { name: 'b.md', path: 'b.md', type: 'file', title: 'b' },
  ])
})

test('a page only in the working tree is listed as a draft; one in both is not', () => {
  assert.deepEqual(buildDocTree(['README.md'], ['README.md', 'notes/new.md']), [
    {
      name: 'notes',
      path: 'notes',
      type: 'directory',
      title: 'notes',
      children: [{ name: 'new.md', path: 'notes/new.md', type: 'file', title: 'new', draft: true }],
    },
    { name: 'README.md', path: 'README.md', type: 'file', title: 'README' },
  ])
})

test('a published page missing from the working tree is still listed', () => {
  assert.deepEqual(buildDocTree(['guide.md'], []), [
    { name: 'guide.md', path: 'guide.md', type: 'file', title: 'guide' },
  ])
})

test('only markdown outside dot-directories is listed', () => {
  assert.deepEqual(buildDocTree(['.github/PULL_REQUEST.md', 'logo.png', 'docs/.hidden/x.md', 'ok.md'], ['notes.txt']), [
    { name: 'ok.md', path: 'ok.md', type: 'file', title: 'ok' },
  ])
})

test('nothing published and no drafts is an empty tree', () => {
  assert.deepEqual(buildDocTree([], []), [])
})

test('folders take their meta title and order, pages their titles', () => {
  const tree = buildDocTree(['a.md', 'b.md', 'guides/x.md', 'guides/y.md'], [], {
    metas: new Map([
      ['', { order: ['b.md', 'guides'] }],
      ['guides', { title: 'User guides', order: ['y.md'] }],
    ]),
    titles: new Map([
      ['a.md', 'Alpha'],
      ['guides/y.md', 'Why'],
    ]),
  })
  assert.deepEqual(
    tree.map((e) => [e.path, e.title]),
    [
      ['b.md', 'b'],
      ['guides', 'User guides'],
      ['a.md', 'Alpha'],
    ],
  )
  assert.deepEqual(
    tree[1].children?.map((e) => [e.path, e.title]),
    [
      ['guides/y.md', 'Why'],
      ['guides/x.md', 'x'],
    ],
  )
})
