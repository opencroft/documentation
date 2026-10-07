import assert from 'node:assert/strict'
import { test } from 'node:test'

import { highlightSegments } from './search-highlight.ts'

const joined = (text: string, query: string) =>
  highlightSegments(text, query)
    .map((s) => s.text)
    .join('')

test('every occurrence is marked, and what lies between stays unmarked', () => {
  assert.deepEqual(highlightSegments('Set up the setup step', 'set'), [
    { text: 'Set', match: true },
    { text: ' up the ', match: false },
    { text: 'set', match: true },
    { text: 'up step', match: false },
  ])
})

test('the match keeps the case the text was written in', () => {
  assert.deepEqual(highlightSegments('Use DOCKER compose', 'docker'), [
    { text: 'Use ', match: false },
    { text: 'DOCKER', match: true },
    { text: ' compose', match: false },
  ])
})

test('the query is plain text, not a pattern', () => {
  assert.deepEqual(highlightSegments('call run(a.b) or run(axb)', 'run(a.b)'), [
    { text: 'call ', match: false },
    { text: 'run(a.b)', match: true },
    { text: ' or run(axb)', match: false },
  ])
  assert.deepEqual(highlightSegments('cost is $5 [approx]', '[approx]'), [
    { text: 'cost is $5 ', match: false },
    { text: '[approx]', match: true },
  ])
})

test('text in another script is matched without regard to case', () => {
  assert.deepEqual(highlightSegments('Основной реестр', 'РЕЕСТР'), [
    { text: 'Основной ', match: false },
    { text: 'реестр', match: true },
  ])
})

test('a match at either end leaves no empty segment', () => {
  assert.deepEqual(highlightSegments('abc', 'abc'), [{ text: 'abc', match: true }])
  assert.deepEqual(highlightSegments('abab', 'ab'), [
    { text: 'ab', match: true },
    { text: 'ab', match: true },
  ])
})

test('nothing to find leaves the line whole', () => {
  assert.deepEqual(highlightSegments('some line', 'missing'), [{ text: 'some line', match: false }])
  assert.deepEqual(highlightSegments('some line', '   '), [{ text: 'some line', match: false }])
  assert.deepEqual(highlightSegments('', 'x'), [{ text: '', match: false }])
})

test('the segments always join back into the line', () => {
  for (const [text, query] of [
    ['a.b.c and a.b', 'a.b'],
    ['  padded  ', 'padded'],
    ['x', 'x'],
  ]) {
    assert.equal(joined(text, query), text)
  }
})
