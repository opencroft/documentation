import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  defaultDoc,
  docAppPath,
  docEditAppPath,
  docLinkTo,
  docPathOf,
  folderPage,
  headingOf,
  resolveRelativeDoc,
  routeOf,
  searchAppPath,
} from './doc-routes.ts'
import type { DocEntry } from './types.ts'

test('a doc and its App path name each other, through encoding', () => {
  for (const doc of ['README.md', 'guides/getting started.md', 'ru/Документы/обзор.md', 'a/100%.md', 'q/what?.md']) {
    const path = docAppPath(doc)
    assert.ok(path.startsWith('/'), path)
    assert.ok(!path.includes('?') && !path.includes('#'), path)
    assert.equal(docPathOf(path), doc)
  }
  assert.equal(docAppPath('guides/intro.md'), '/guides/intro.md')
  assert.equal(docAppPath('guides/getting started.md'), '/guides/getting%20started.md')
})

test("the App's bare address names no doc", () => {
  assert.equal(docPathOf('/'), null)
  assert.equal(docPathOf(''), null)
})

test('a path the router hands over already decoded still reads as the doc', () => {
  assert.equal(docPathOf('/guides/getting started.md'), 'guides/getting started.md')
})

test('a heading is the `heading` query', () => {
  assert.equal(docAppPath('guides/intro.md', 'setup'), '/guides/intro.md?heading=setup')
  assert.equal(headingOf(new URLSearchParams('heading=setup')), 'setup')
  assert.equal(headingOf(new URLSearchParams('heading=')), null)
  assert.equal(headingOf(new URLSearchParams('')), null)
})

test('a location is a doc at an optional heading, the search results, or the bare address', () => {
  assert.deepEqual(routeOf('/guides/intro.md', new URLSearchParams('heading=setup')), {
    page: 'doc',
    doc: 'guides/intro.md',
    heading: 'setup',
    edit: false,
  })
  assert.deepEqual(routeOf('/README.md', new URLSearchParams('')), {
    page: 'doc',
    doc: 'README.md',
    heading: null,
    edit: false,
  })
  assert.deepEqual(routeOf('/search', new URLSearchParams('q=install')), { page: 'search', query: 'install' })
  assert.deepEqual(routeOf('/search', new URLSearchParams('')), { page: 'search', query: '' })
  assert.deepEqual(routeOf('/', new URLSearchParams('')), { page: 'home' })
})

test('the search results page and its query name each other, through encoding', () => {
  for (const query of ['install', 'c++ & rust', 'обзор', 'a=b?#c']) {
    const to = searchAppPath(query)
    const [path, search] = to.split('?')
    assert.equal(path, '/search')
    assert.deepEqual(routeOf(path, new URLSearchParams(search)), { page: 'search', query })
  }
})

test('a doc under a folder called search is a doc, not the search page', () => {
  assert.deepEqual(routeOf(docAppPath('search/index.md'), new URLSearchParams('')), {
    page: 'doc',
    doc: 'search/index.md',
    heading: null,
    edit: false,
  })
})

test('a doc in its editor is the `edit=true` query, and names the doc it edits', () => {
  for (const doc of ['README.md', 'guides/getting started.md', 'q/what?.md']) {
    const [path, search] = docEditAppPath(doc).split('?')
    assert.deepEqual(routeOf(path, new URLSearchParams(search)), { page: 'doc', doc, heading: null, edit: true })
  }
  assert.equal(docEditAppPath('guides/intro.md'), '/guides/intro.md?edit=true')
})

test('only `edit=true` opens the editor', () => {
  for (const search of ['', 'edit=false', 'edit=', 'edit=1', 'edit', 'heading=edit']) {
    const route = routeOf('/README.md', new URLSearchParams(search))
    assert.equal(route.page === 'doc' && route.edit, false, search)
  }
})

test('the edit query means nothing off a doc', () => {
  assert.deepEqual(routeOf('/search', new URLSearchParams('q=install&edit=true')), { page: 'search', query: 'install' })
  assert.deepEqual(routeOf('/', new URLSearchParams('edit=true')), { page: 'home' })
})

test('relative doc paths resolve against the directory of the open doc', () => {
  assert.equal(resolveRelativeDoc('guides/intro.md', 'setup.md'), 'guides/setup.md')
  assert.equal(resolveRelativeDoc('guides/intro.md', './setup.md'), 'guides/setup.md')
  assert.equal(resolveRelativeDoc('guides/deep/intro.md', '../api.md'), 'guides/api.md')
  assert.equal(resolveRelativeDoc('README.md', 'guides/intro.md'), 'guides/intro.md')
  assert.equal(resolveRelativeDoc(null, 'guides/intro.md'), 'guides/intro.md')
})

test('links inside a doc become App paths', () => {
  assert.equal(docLinkTo('guides/intro.md', '../api.md'), '/api.md')
  assert.equal(docLinkTo('guides/intro.md', 'setup.md#install'), '/guides/setup.md?heading=install')
  assert.equal(docLinkTo('guides/intro.md', 'setup.md#'), '/guides/setup.md')
  assert.equal(docLinkTo('guides/intro.md', '#install'), '?heading=install')
})

test('links that are not a doc or a heading are left alone', () => {
  assert.equal(docLinkTo('guides/intro.md', 'diagram.png'), null)
  assert.equal(docLinkTo('guides/intro.md', 'folder/'), null)
  assert.equal(docLinkTo('guides/intro.md', '#'), null)
  assert.equal(docLinkTo('guides/intro.md', ''), null)
})

const tree: DocEntry[] = [
  {
    name: 'guides',
    path: 'guides',
    type: 'directory',
    children: [{ name: 'intro.md', path: 'guides/intro.md', type: 'file' }],
  },
  { name: 'README.md', path: 'README.md', type: 'file' },
]

test('the bare address opens the preferred page when the tree has it, else the first file', () => {
  assert.equal(defaultDoc(tree, 'README.md'), 'README.md')
  assert.equal(defaultDoc(tree, 'MISSING.md'), 'guides/intro.md')
  assert.equal(defaultDoc(tree, null), 'guides/intro.md')
  assert.equal(defaultDoc([], 'README.md'), null)
})

test('a folder opens its own index.md, and nothing when it has none', () => {
  const withIndex: DocEntry[] = [
    {
      name: 'guides',
      path: 'guides',
      type: 'directory',
      children: [
        { name: 'index.md', path: 'guides/index.md', type: 'file' },
        {
          name: 'setup',
          path: 'guides/setup',
          type: 'directory',
          children: [{ name: 'install.md', path: 'guides/setup/install.md', type: 'file' }],
        },
      ],
    },
    { name: 'index.md', path: 'index.md', type: 'file' },
  ]
  assert.equal(folderPage(withIndex, 'guides'), 'guides/index.md')
  assert.equal(folderPage(withIndex, 'guides/setup'), null)
  assert.equal(folderPage(tree, 'guides'), null)
})
