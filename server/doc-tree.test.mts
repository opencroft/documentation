import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildDocTree } from './doc-tree.ts'

test('published pages form the tree, directories first, then names in order', () => {
  assert.deepEqual(buildDocTree(['b.md', 'guides/setup.md', 'a.md', 'guides/intro.md'], []), [
    {
      name: 'guides',
      path: 'guides',
      type: 'directory',
      children: [
        { name: 'intro.md', path: 'guides/intro.md', type: 'file' },
        { name: 'setup.md', path: 'guides/setup.md', type: 'file' },
      ],
    },
    { name: 'a.md', path: 'a.md', type: 'file' },
    { name: 'b.md', path: 'b.md', type: 'file' },
  ])
})

test('a page only in the working tree is listed as a draft; one in both is not', () => {
  assert.deepEqual(buildDocTree(['README.md'], ['README.md', 'notes/new.md']), [
    {
      name: 'notes',
      path: 'notes',
      type: 'directory',
      children: [{ name: 'new.md', path: 'notes/new.md', type: 'file', draft: true }],
    },
    { name: 'README.md', path: 'README.md', type: 'file' },
  ])
})

test('a published page missing from the working tree is still listed', () => {
  assert.deepEqual(buildDocTree(['guide.md'], []), [{ name: 'guide.md', path: 'guide.md', type: 'file' }])
})

test('only markdown outside dot-directories is listed', () => {
  assert.deepEqual(buildDocTree(['.github/PULL_REQUEST.md', 'logo.png', 'docs/.hidden/x.md', 'ok.md'], ['notes.txt']), [
    { name: 'ok.md', path: 'ok.md', type: 'file' },
  ])
})

test('nothing published and no drafts is an empty tree', () => {
  assert.deepEqual(buildDocTree([], []), [])
})
