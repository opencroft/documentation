import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ancestorsOf, docFileName, folderOf, folderTree, joinPath, nameHolder, treePaths } from './new-doc.ts'
import type { DocEntry } from './types.ts'

const file = (path: string): DocEntry => ({ name: path.slice(path.lastIndexOf('/') + 1), path, type: 'file' })
const dir = (path: string, ...children: DocEntry[]): DocEntry => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  type: 'directory',
  children,
})

const TREE: DocEntry[] = [
  dir('guides', dir('guides/setup', file('guides/setup/install.md')), file('guides/intro.md')),
  dir('api', file('api/auth.md')),
  file('index.md'),
]

test('a title names its file through the slug', () => {
  assert.equal(docFileName('Getting Started'), 'getting-started.md')
  assert.equal(docFileName('  API: v2 (beta) '), 'api-v2-beta.md')
  assert.equal(docFileName('Основной реестр'), 'основной-реестр.md')
})

test('a title with nothing to spell a file name with names no file', () => {
  assert.equal(docFileName(''), null)
  assert.equal(docFileName('   '), null)
  assert.equal(docFileName('!!! ?'), null)
})

test('a name joins its folder, and the root adds no prefix', () => {
  assert.equal(joinPath('', 'a.md'), 'a.md')
  assert.equal(joinPath('guides/setup', 'a.md'), 'guides/setup/a.md')
})

test("the open page's folder is the one it sits in, and the root without a page", () => {
  assert.equal(folderOf('guides/setup/install.md'), 'guides/setup')
  assert.equal(folderOf('index.md'), '')
  assert.equal(folderOf(null), '')
})

test('the folders that contain a path, outermost first', () => {
  assert.deepEqual(ancestorsOf('a/b/c'), ['a', 'a/b'])
  assert.deepEqual(ancestorsOf('a'), [])
  assert.deepEqual(ancestorsOf(''), [])
})

test('the taken paths are every page and folder at any depth', () => {
  assert.deepEqual([...treePaths(TREE)].sort(), [
    'api',
    'api/auth.md',
    'guides',
    'guides/intro.md',
    'guides/setup',
    'guides/setup/install.md',
    'index.md',
  ])
})

test('a page takes its name inside its own folder only', () => {
  const taken = treePaths(TREE)
  assert.equal(nameHolder(taken, 'guides', 'intro'), 'page')
  assert.equal(nameHolder(taken, '', 'index'), 'page')
  assert.equal(nameHolder(taken, 'api', 'intro'), null)
  assert.equal(nameHolder(taken, 'guides/setup', 'intro'), null)
})

test('a folder takes its name from a page beside it, and a page from a folder', () => {
  const taken = treePaths(TREE)
  assert.equal(nameHolder(taken, 'guides', 'setup'), 'folder')
  assert.equal(nameHolder(taken, '', 'api'), 'folder')
  assert.equal(nameHolder(taken, '', 'setup'), null)
})

test('two folders sharing a name answer for their own contents', () => {
  const taken = treePaths([
    dir('ext', dir('ext/kit', file('ext/kit/spec.md'))),
    dir('user', dir('user/ext', file('user/ext/index.md'))),
  ])
  assert.equal(nameHolder(taken, 'ext', 'kit'), 'folder')
  assert.equal(nameHolder(taken, 'ext', 'index'), null)
  assert.equal(nameHolder(taken, 'user/ext', 'index'), 'page')
  assert.equal(nameHolder(taken, 'user/ext', 'kit'), null)
})

test('a folder only named so far takes its name too', () => {
  const taken = new Set([...treePaths(TREE), 'guides/faq'])
  assert.equal(nameHolder(taken, 'guides', 'faq'), 'folder')
})

test('the folder tree holds the folders only, in name order', () => {
  assert.deepEqual(folderTree(TREE, []), [
    { name: 'api', path: 'api', children: [] },
    { name: 'guides', path: 'guides', children: [{ name: 'setup', path: 'guides/setup', children: [] }] },
  ])
})

test('an added folder takes its place among the existing ones, with any missing parents', () => {
  assert.deepEqual(folderTree(TREE, ['guides/faq', 'new/deep', 'api']), [
    { name: 'api', path: 'api', children: [] },
    {
      name: 'guides',
      path: 'guides',
      children: [
        { name: 'faq', path: 'guides/faq', children: [] },
        { name: 'setup', path: 'guides/setup', children: [] },
      ],
    },
    { name: 'new', path: 'new', children: [{ name: 'deep', path: 'new/deep', children: [] }] },
  ])
})

test('an empty documentation has no folders but takes added ones', () => {
  assert.deepEqual(folderTree([], []), [])
  assert.deepEqual(folderTree([], ['notes']), [{ name: 'notes', path: 'notes', children: [] }])
})
