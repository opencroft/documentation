import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Element, Root } from 'hast'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

import { fencedCode } from './fenced-code.ts'

// The `pre` of the first fence, built by the parse-and-convert chain
// react-markdown runs, so the test sees the tree the page is drawn from.
function firstPre(markdown: string): Element {
  const processor = unified().use(remarkParse).use(remarkRehype)
  const tree = processor.runSync(processor.parse(markdown)) as Root
  const pre = tree.children.find((node): node is Element => node.type === 'element' && node.tagName === 'pre')
  assert.ok(pre, 'the markdown has a fence')
  return pre
}

test('a fence that names a file passes its whole info string on', () => {
  const fence = fencedCode(firstPre('```ts title="src/origins.ts"\nexport const a = 1\n```\n'))
  assert.deepEqual(fence, { code: 'export const a = 1', language: 'ts', info: 'ts title="src/origins.ts"' })
})

test('a fence with only a language passes the language', () => {
  assert.deepEqual(fencedCode(firstPre('```py\nprint(1)\n```\n')), { code: 'print(1)', language: 'py', info: 'py' })
})

test('a fence with no language has neither', () => {
  assert.deepEqual(fencedCode(firstPre('```\nplain\nsecond\n```\n')), {
    code: 'plain\nsecond',
    language: undefined,
    info: undefined,
  })
})

test('the language is the first word, so a mermaid fence with more after it is still mermaid', () => {
  const fence = fencedCode(firstPre('```mermaid title="flow"\ngraph TD\n```\n'))
  assert.equal(fence?.language, 'mermaid')
  assert.equal(fence?.info, 'mermaid title="flow"')
})

test('a pre that is not one plain code element is left to the caller', () => {
  const pre: Element = {
    type: 'element',
    tagName: 'pre',
    properties: {},
    children: [{ type: 'element', tagName: 'span', properties: {}, children: [{ type: 'text', value: 'x' }] }],
  }
  assert.equal(fencedCode(pre), null)
})
