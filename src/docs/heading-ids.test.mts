import assert from 'node:assert/strict'
import { test } from 'node:test'

import { headingSlug, rehypeHeadingIds } from './heading-ids.ts'

test('Latin headings keep the ids they had', () => {
  assert.equal(headingSlug('Developing extensions'), 'developing-extensions')
  assert.equal(headingSlug('Environment at a glance'), 'environment-at-a-glance')
  assert.equal(headingSlug('API: v2 (beta)'), 'api-v2-beta')
  assert.equal(headingSlug('snake_case & kebab-case'), 'snake_case-kebab-case')
  assert.equal(headingSlug('A - B'), 'a-b')
})

test('headings in any script get a readable id', () => {
  assert.equal(headingSlug('Основной реестр'), 'основной-реестр')
  assert.equal(headingSlug('Дополнительные реестры'), 'дополнительные-реестры')
  assert.equal(headingSlug('Ёлка и ЁЖ'), 'ёлка-и-ёж')
  assert.equal(headingSlug('Überblick für Anfänger'), 'überblick-für-anfänger')
  assert.equal(headingSlug('概要と設定'), '概要と設定')
  assert.equal(headingSlug('नमस्ते दुनिया'), 'नमस्ते-दुनिया')
})

test('the same text spelled with combining marks gets the same id', () => {
  assert.equal(headingSlug('Überblick'), headingSlug('Überblick'))
})

test('a heading with nothing to spell an id with still gets one', () => {
  assert.equal(headingSlug('!!!'), 'section')
  assert.equal(headingSlug(''), 'section')
})

type Node = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Node[] }

const h = (tagName: string, ...children: Node[]): Node => ({ type: 'element', tagName, properties: {}, children })
const t = (value: string): Node => ({ type: 'text', value })

function idsOf(tree: Node): string[] {
  const out: string[] = []
  const walk = (n: Node) => {
    if (n.type === 'element' && /^h[1-6]$/.test(n.tagName ?? '')) {
      out.push(String(n.properties?.id))
    }
    for (const c of n.children ?? []) {
      walk(c)
    }
  }
  walk(tree)
  return out
}

test('every heading in a document gets its own id, duplicates in document order', () => {
  const tree: Node = {
    type: 'root',
    children: [
      h('h1', t('Реестры')),
      h('h2', t('Основной реестр')),
      h('h2', t('Setup')),
      h('p', t('Setup')),
      h('h3', t('Setup')),
      h('h2', t('Setup '), h('code', t('1'))),
      h('h3', t('Setup')),
      h('h2', t('???')),
      h('h2', t('…')),
    ],
  }
  rehypeHeadingIds()(tree)
  const ids = idsOf(tree)
  assert.deepEqual(ids, [
    'реестры',
    'основной-реестр',
    'setup',
    'setup-1',
    'setup-1-1',
    'setup-2',
    'section',
    'section-1',
  ])
  assert.equal(new Set(ids).size, ids.length)
})

test('the same document always gets the same ids', () => {
  const make = (): Node => ({ type: 'root', children: [h('h2', t('A')), h('h2', t('A')), h('h3', t('B'))] })
  const first = make()
  const second = make()
  rehypeHeadingIds()(first)
  rehypeHeadingIds()(second)
  assert.deepEqual(idsOf(first), idsOf(second))
  assert.deepEqual(idsOf(first), ['a', 'a-1', 'b'])
})

test('a heading keeps its other properties', () => {
  const tree: Node = { type: 'root', children: [{ ...h('h2', t('X')), properties: { dataSourceLine: '3' } }] }
  rehypeHeadingIds()(tree)
  assert.deepEqual(tree.children?.[0].properties, { dataSourceLine: '3', id: 'x' })
})
