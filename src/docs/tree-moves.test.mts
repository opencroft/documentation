import assert from 'node:assert/strict'
import { test } from 'node:test'

import { entryTitles, movedPath, moveFolders, placeOf } from './tree-moves.ts'
import type { DocEntry } from './types'

const file = (path: string, title: string): DocEntry => ({
  name: path.split('/').pop() ?? path,
  path,
  type: 'file',
  title,
})
const dir = (path: string, title: string, children: DocEntry[]): DocEntry => ({
  name: path.split('/').pop() ?? path,
  path,
  type: 'directory',
  title,
  children,
})

const guides = dir('guides', 'Guides', [
  file('guides/a.md', 'Alpha'),
  dir('guides/deep', 'Deep', [file('guides/deep/x.md', 'X')]),
])
const tree: DocEntry[] = [guides, dir('api', 'API', [file('api/ref.md', 'Reference')]), file('faq.md', 'FAQ')]

test('every folder is offered, the top level first and nested ones deeper', () => {
  assert.deepEqual(
    moveFolders(tree, file('faq.md', 'FAQ')).map((f) => [f.path, f.depth]),
    [
      ['', 0],
      ['guides', 1],
      ['guides/deep', 2],
      ['api', 1],
    ],
  )
})

test('a folder is not offered itself or what is inside it', () => {
  assert.deepEqual(
    moveFolders(tree, guides).map((f) => f.path),
    ['', 'api'],
  )
})

test("a folder's entry titles leave out the one being moved", () => {
  assert.deepEqual(entryTitles(tree, 'guides', file('guides/a.md', 'Alpha')), ['Deep'])
  assert.deepEqual(entryTitles(tree, '', file('guides/a.md', 'Alpha')), ['Guides', 'API', 'FAQ'])
  assert.deepEqual(entryTitles(tree, 'guides/deep', guides), ['X'])
})

test('an entry is placed where it stands among its siblings', () => {
  assert.deepEqual(placeOf(tree, file('faq.md', 'FAQ')), { folder: '', position: 2 })
  assert.deepEqual(placeOf(tree, file('guides/deep/x.md', 'X')), { folder: 'guides/deep', position: 0 })
})

test('paths inside what moved follow it; others stay', () => {
  assert.equal(movedPath('guides/deep/x.md', 'guides', 'manual'), 'manual/deep/x.md')
  assert.equal(movedPath('guides.md', 'guides', 'manual'), 'guides.md')
  assert.equal(movedPath('a.md', 'a.md', 'b/a.md'), 'b/a.md')
})
