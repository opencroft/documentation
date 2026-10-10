import assert from 'node:assert/strict'
import { test } from 'node:test'

import { highlightSegments } from './search-highlight.ts'

test('the reported spans are marked, and what lies between stays unmarked', () => {
  assert.deepEqual(
    highlightSegments('Set up the setup step', [
      [0, 3],
      [11, 14],
    ]),
    [
      { text: 'Set', match: true, start: 0 },
      { text: ' up the ', match: false, start: 3 },
      { text: 'set', match: true, start: 11 },
      { text: 'up step', match: false, start: 14 },
    ],
  )
})

test('a span at either end leaves no empty segment', () => {
  assert.deepEqual(highlightSegments('abc', [[0, 3]]), [{ text: 'abc', match: true, start: 0 }])
  assert.deepEqual(
    highlightSegments('abab', [
      [0, 2],
      [2, 4],
    ]),
    [
      { text: 'ab', match: true, start: 0 },
      { text: 'ab', match: true, start: 2 },
    ],
  )
})

test('no span leaves the line whole', () => {
  assert.deepEqual(highlightSegments('some line', []), [{ text: 'some line', match: false, start: 0 }])
  assert.deepEqual(highlightSegments('', []), [{ text: '', match: false, start: 0 }])
})

test('spans past the end of the line or overlapping an earlier one are clipped', () => {
  assert.deepEqual(
    highlightSegments('abcdef', [
      [1, 3],
      [2, 4],
      [5, 99],
    ]),
    [
      { text: 'a', match: false, start: 0 },
      { text: 'bc', match: true, start: 1 },
      { text: 'd', match: true, start: 3 },
      { text: 'e', match: false, start: 4 },
      { text: 'f', match: true, start: 5 },
    ],
  )
})

test('the segments always join back into the line', () => {
  for (const [text, ranges] of [
    ['a.b.c and a.b', [[0, 3]]],
    ['  padded  ', [[2, 8]]],
    ['x', [[0, 1]]],
  ] as Array<[string, Array<[number, number]>]>) {
    assert.equal(
      highlightSegments(text, ranges)
        .map((s) => s.text)
        .join(''),
      text,
    )
  }
})
