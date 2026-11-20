import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  enterVisit,
  type Highlight,
  type HighlightState,
  highlightSelection,
  pageName,
  pageSelection,
  recordHighlight,
  type Visit,
  visitSelection,
} from './doc-selection.ts'

const APP = 'acme.handbook'
const SOURCE = ['# Deploy', '', 'Run the script.', '', '- one', '- two', '', 'Done.'].join('\n')

test('the open page is one read item named by its file', () => {
  assert.deepEqual(pageSelection(APP, 'guides/deploy.md', 'published'), {
    items: [
      {
        kind: 'app',
        app: APP,
        action: 'read',
        params: { path: 'guides/deploy.md' },
        name: 'deploy.md',
        noun: ['page', 'pages'],
      },
    ],
  })
})

test('a page on screen as its draft is read as the draft', () => {
  const [item] = pageSelection(APP, 'new.md', 'draft').items
  assert.equal(item.kind, 'app')
  assert.deepEqual(item.kind === 'app' && item.params, { path: 'new.md', version: 'draft' })
})

test('text highlighted with no line map travels with the page, with no range', () => {
  const [item] = pageSelection(APP, 'guides/deploy.md', 'draft', 'Run the script.').items
  assert.deepEqual(item, {
    kind: 'app',
    app: APP,
    action: 'read',
    params: { path: 'guides/deploy.md', version: 'draft' },
    name: 'deploy.md',
    noun: ['page', 'pages'],
    text: 'Run the script.',
  })
  const [plain] = pageSelection(APP, 'guides/deploy.md', 'published', '').items
  assert.ok(!('text' in plain), 'no highlight, no text')
})

test('highlighted lines carry their range, their source text and a read of the same lines', () => {
  const [item] = highlightSelection(APP, 'guides/deploy.md', SOURCE, { start: 3, end: 6 }).items
  assert.deepEqual(item, {
    kind: 'app',
    app: APP,
    action: 'read',
    params: { path: 'guides/deploy.md', offset: 3, limit: 4 },
    name: 'deploy.md',
    noun: ['page', 'pages'],
    lines: { from: 3, to: 6 },
    text: 'Run the script.\n\n- one\n- two',
  })
})

test('the quoted text is what read returns for the call', () => {
  // `read` in server/docs-app-actions.ts slices the page this way.
  const readLines = (content: string, offset: number, limit: number) =>
    content
      .split('\n')
      .slice(offset - 1, offset - 1 + limit)
      .join('\n')
  for (const span of [
    { start: 1, end: 1 },
    { start: 2, end: 5 },
    { start: 8, end: 8 },
  ]) {
    const [item] = highlightSelection(APP, 'deploy.md', SOURCE, span).items
    assert.ok(item.kind === 'app' && item.text !== undefined)
    const { offset, limit } = item.params as { offset: number; limit: number }
    assert.equal(item.text, readLines(SOURCE, offset, limit), `lines ${span.start}-${span.end}`)
  }
})

test('a long highlight is handed over whole: the host applies the cap', () => {
  const long = Array.from({ length: 300 }, (_, i) => `Line ${i + 1} of a long section.`).join('\n')
  const [item] = highlightSelection(APP, 'long.md', long, { start: 1, end: 300 }).items
  assert.ok(item.kind === 'app')
  assert.equal(item.text, long)
  assert.ok((item.text ?? '').length > 4000)
})

// ── How long a highlight lasts ─────────────────────────────────────────────

const OTHER = '# Readme\n\nHello.'
const ON_PAGE: Visit = { path: 'guides/deploy.md', source: SOURCE, view: 'page' }
const LINES: Highlight = { span: { start: 3, end: 6 }, text: 'Run the script. - one - two' }
const NO_MAP: Highlight = { span: null, text: 'Run the script.' }

type Step = { enter: Visit } | { highlight: Highlight }

/** The state the bridge holds after the reader's steps, starting on `first`. */
function walk(first: Visit, steps: Step[]): HighlightState {
  let state: HighlightState = { visit: first, highlight: null }
  for (const step of steps) {
    state = 'enter' in step ? enterVisit(state, step.enter) : recordHighlight(state, state.visit, step.highlight)
  }
  return state
}

const deployPage = (params: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  items: [{ kind: 'app', app: APP, action: 'read', params, name: 'deploy.md', noun: ['page', 'pages'], ...extra }],
})

test('a highlight is published while its view stays on screen', () => {
  const state = walk(ON_PAGE, [{ highlight: LINES }, { enter: { ...ON_PAGE } }])
  assert.deepEqual(
    visitSelection(APP, state),
    deployPage(
      { path: 'guides/deploy.md', offset: 3, limit: 4 },
      { lines: { from: 3, to: 6 }, text: 'Run the script.\n\n- one\n- two' },
    ),
  )
})

test('the same visit keeps the state itself, so a re-render changes nothing', () => {
  const state = walk(ON_PAGE, [{ highlight: LINES }])
  assert.ok(enterVisit(state, { ...ON_PAGE }) === state)
})

test('leaving the view a highlight was made in and coming back starts from the page alone', () => {
  const draft: Visit = { ...ON_PAGE, view: 'draft' }
  const changes: Visit = { ...ON_PAGE, view: 'changes:aaa111' }
  const cases: { name: string; made: Visit; highlight: Highlight; away: Visit; back: Visit; expected: unknown }[] = [
    {
      name: 'another page and back',
      made: ON_PAGE,
      highlight: LINES,
      away: { path: 'README.md', source: OTHER, view: 'page' },
      back: ON_PAGE,
      expected: deployPage({ path: 'guides/deploy.md' }),
    },
    {
      name: 'a page highlight, then the editor',
      made: ON_PAGE,
      highlight: LINES,
      away: draft,
      back: draft,
      expected: deployPage({ path: 'guides/deploy.md', version: 'draft' }),
    },
    {
      name: 'editor text, then back to the page',
      made: draft,
      highlight: NO_MAP,
      away: ON_PAGE,
      back: ON_PAGE,
      expected: deployPage({ path: 'guides/deploy.md' }),
    },
    {
      name: 'a page highlight, then a version’s changes',
      made: ON_PAGE,
      highlight: LINES,
      away: changes,
      back: changes,
      expected: deployPage({ path: 'guides/deploy.md' }),
    },
    {
      name: 'text in a version’s changes, then back to the page',
      made: changes,
      highlight: NO_MAP,
      away: ON_PAGE,
      back: ON_PAGE,
      expected: deployPage({ path: 'guides/deploy.md' }),
    },
    {
      name: 'text in one version’s changes, then another version’s',
      made: changes,
      highlight: NO_MAP,
      away: { ...ON_PAGE, view: 'changes:bbb222' },
      back: changes,
      expected: deployPage({ path: 'guides/deploy.md' }),
    },
    {
      name: 'the page republished with other markdown',
      made: ON_PAGE,
      highlight: LINES,
      away: { ...ON_PAGE, source: '' },
      back: { ...ON_PAGE, source: `${SOURCE}\n\nA new paragraph.` },
      expected: deployPage({ path: 'guides/deploy.md' }),
    },
  ]
  for (const c of cases) {
    const state = walk(c.made, [{ highlight: c.highlight }, { enter: c.away }, { enter: c.back }])
    assert.deepEqual(visitSelection(APP, state), c.expected, c.name)
  }
})

test('text highlighted in the editor travels with the draft page, with no range', () => {
  const state = walk({ ...ON_PAGE, view: 'draft' }, [{ highlight: NO_MAP }])
  assert.deepEqual(
    visitSelection(APP, state),
    deployPage({ path: 'guides/deploy.md', version: 'draft' }, { text: 'Run the script.' }),
  )
})

test('a highlight read after its visit ended is dropped', () => {
  const onReadme: Visit = { path: 'README.md', source: OTHER, view: 'page' }
  const state = recordHighlight({ visit: onReadme, highlight: null }, ON_PAGE, LINES)
  assert.equal(state.highlight, null)
})

test('off a page nothing is published', () => {
  assert.equal(visitSelection(APP, { visit: { path: '', source: '', view: 'page' }, highlight: LINES }), null)
})

test('the name is the last path segment', () => {
  assert.equal(pageName('a/b/c.md'), 'c.md')
  assert.equal(pageName('README.md'), 'README.md')
})
