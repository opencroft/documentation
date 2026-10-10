import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DocSearchAnswer } from './docs-search.ts'
import { excerpt, formatAnswer } from './search-answer.ts'

const answer = (overrides: Partial<DocSearchAnswer>): DocSearchAnswer => ({
  searched: [{ namespace: 'space-1.docs', pages: 12 }],
  terms: ['deploy', 'server'],
  complete: true,
  total: 1,
  results: [
    {
      namespace: 'space-1.docs',
      path: 'guides/deploy.md',
      title: 'Deploying',
      missing: [],
      matches: [
        { line: 9, text: 'Restart the server to deploy.', heading: 'Server', ranges: [[12, 18]] },
        { line: 1, text: '# Deploying', heading: 'Deploying', ranges: [[2, 8]] },
      ],
    },
  ],
  ...overrides,
})

test('each page is listed with its title and its matched lines, then how to read on', () => {
  assert.equal(
    formatAnswer(answer({}), '"deploy server"'),
    [
      'Pages matching "deploy server", best first (1 page). Searched the 12 published pages of space-1.docs.',
      '',
      '1. guides/deploy.md — Deploying',
      '   L9 § Server: Restart the server to deploy.',
      '   L1: # Deploying',
      '',
      'Read a page from a line: read {"path": "<path>", "offset": <line>} on its app.',
    ].join('\n'),
  )
})

test('a cut list says how many pages there were', () => {
  assert.match(formatAnswer(answer({ total: 9 }), '"deploy"'), /\(1 of 9 shown; raise limit for more\)/)
})

test('pages from several apps name their app', () => {
  const text = formatAnswer(
    answer({
      searched: [
        { namespace: 'space-1.docs', pages: 12 },
        { namespace: 'shared.docs', pages: 3 },
      ],
    }),
    '"deploy"',
  )
  assert.match(text, /^1\. guides\/deploy\.md — Deploying \[space-1\.docs\]$/m)
  assert.match(text, /Searched the 15 published pages of space-1\.docs, shared\.docs\./)
})

test('closest pages say no page has every word, and which words each lacks', () => {
  const base = answer({})
  const text = formatAnswer(
    answer({ complete: false, results: [{ ...base.results[0], missing: ['ping'] }] }),
    '"deploy ping"',
  )
  assert.match(text, /^No page has every word of "deploy ping"\. Closest pages/)
  assert.match(text, /^1\. guides\/deploy\.md — Deploying \(lacks: ping\)$/m)
})

test('nothing found is said in words, with what was searched and what to try', () => {
  assert.equal(
    formatAnswer(answer({ complete: false, total: 0, results: [] }), '"absent"'),
    [
      'Nothing matches "absent" in the 12 published pages of space-1.docs. Drafts are not searched.',
      'Try other or fewer words, a "quoted phrase" for exact text, or apps: "*" to search every documentation app.',
    ].join('\n'),
  )
})

test('a long line is cut around its first match', () => {
  const text = `${'a'.repeat(300)} needle ${'b'.repeat(300)}`
  const cut = excerpt({ text, ranges: [[301, 307]] })
  assert.ok(cut.startsWith('…') && cut.endsWith('…'), cut)
  assert.ok(cut.includes('needle'))
  assert.ok(cut.length <= 222)
  assert.equal(excerpt({ text: '  short line  ', ranges: [] }), 'short line')
})
