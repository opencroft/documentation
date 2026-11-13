import assert from 'node:assert/strict'
import { test } from 'node:test'

import { metaPathOf, orderChildren, parseMeta, placeInOrder, serializeMeta } from './doc-meta.ts'

test('a meta file reads as its title and order', () => {
  assert.deepEqual(parseMeta('{"title":" Guides ","order":["b.md","api"]}'), {
    title: 'Guides',
    order: ['b.md', 'api'],
  })
})

test('no file, broken JSON or wrong types read as what is usable', () => {
  assert.deepEqual(parseMeta(null), {})
  assert.deepEqual(parseMeta('{oops'), {})
  assert.deepEqual(parseMeta('[1]'), {})
  assert.deepEqual(parseMeta('{"title":3,"order":["a.md",4]}'), { order: ['a.md'] })
})

test('a meta is written as two-space JSON with a final newline, empty fields left out', () => {
  assert.equal(
    serializeMeta({ title: 'Guides', order: ['a.md'] }),
    '{\n  "title": "Guides",\n  "order": [\n    "a.md"\n  ]\n}\n',
  )
  assert.equal(serializeMeta({ order: [] }), '{}\n')
})

test('the root meta sits at the top of the repository', () => {
  assert.equal(metaPathOf(''), '_meta.json')
  assert.equal(metaPathOf('a/b'), 'a/b/_meta.json')
})

test('listed entries come in their order, then the rest folders first by name, missing names skipped', () => {
  const children = [
    { name: 'z.md', type: 'file' as const },
    { name: 'a.md', type: 'file' as const },
    { name: 'api', type: 'directory' as const },
    { name: 'guides', type: 'directory' as const },
  ]
  assert.deepEqual(
    orderChildren(children, ['z.md', 'gone.md', 'guides']).map((c) => c.name),
    ['z.md', 'guides', 'api', 'a.md'],
  )
  assert.deepEqual(
    orderChildren(children, undefined).map((c) => c.name),
    ['api', 'guides', 'a.md', 'z.md'],
  )
})

test('an entry is placed among the others at a position, clamped to the ends', () => {
  assert.deepEqual(placeInOrder(['a', 'b', 'c'], 'c', 0), ['c', 'a', 'b'])
  assert.deepEqual(placeInOrder(['a', 'b', 'c'], 'a', 1), ['b', 'a', 'c'])
  assert.deepEqual(placeInOrder(['a', 'b'], 'n', 99), ['a', 'b', 'n'])
  assert.deepEqual(placeInOrder(['a', 'b'], 'n', -3), ['n', 'a', 'b'])
  assert.deepEqual(placeInOrder(['a', 'b'], 'a'), ['b'])
})
