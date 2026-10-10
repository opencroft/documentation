import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { PAGES_GREP_ARGS, pagesFromGrep, parsePage, parsePattern, parseQuery, rankPages } from './search-index.ts'

const page = (path: string, ...lines: string[]) => parsePage(path, lines.join('\n'))

const ranked = (pages: ReturnType<typeof page>[], query: string) =>
  rankPages(pages, parseQuery(query), 3).map((hit) => ({ path: hit.page.path, missing: hit.missing }))

test('a page is parsed into its title and the section of every line, ignoring headings inside code fences', () => {
  const p = page('guide.md', '# Guide', 'intro', '## Setup', '```sh', '# not a heading', '```', 'run it', '## Use ##')
  assert.equal(p.title, 'Guide')
  assert.deepEqual(p.sections, ['Guide', 'Guide', 'Setup', 'Setup', 'Setup', 'Setup', 'Setup', 'Use'])
  assert.deepEqual([...p.headingLines], [0, 2, 7])
})

test('the words of a query match in any order, across lines of one page', () => {
  const pages = [
    page('a.md', '# Deploying', 'Pull the server image.', 'Then reboot.'),
    page('b.md', '# Other', 'The server is up.'),
  ]
  assert.deepEqual(ranked(pages, 'reboot server pull'), [
    { path: 'a.md', missing: [] },
    { path: 'b.md', missing: ['reboot', 'pull'] },
  ])
})

test('a page lacking a word ranks below every page that has them all, and says which word it lacks', () => {
  const pages = [
    page('partial.md', '# Worktree worktree worktree', 'worktree everywhere'),
    page('full.md', '# Notes', 'a worktree needs its own node_modules'),
  ]
  assert.deepEqual(ranked(pages, 'worktree node_modules'), [
    { path: 'full.md', missing: [] },
    { path: 'partial.md', missing: ['node_modules'] },
  ])
})

test('a word in the title outranks the same word in the body', () => {
  const pages = [page('body.md', '# Misc', 'about the registry'), page('title.md', '# Registry', 'how it works')]
  assert.deepEqual(
    ranked(pages, 'registry').map((r) => r.path),
    ['title.md', 'body.md'],
  )
})

test('a query word matches at the start of a word, never inside one', () => {
  const pages = [
    page('icons.md', '# Icons', 'ShieldCheck and a preview'),
    page('gates.md', '# Gates', 'the reviewer checks'),
  ]
  assert.deepEqual(
    ranked(pages, 'check review').map((r) => r.path),
    ['gates.md'],
  )
})

test('a pattern match inside a longer word ranks below one standing on its own', () => {
  const pages = [
    page('icons.md', '# Icons', 'ShieldCheck ShieldCheck'),
    page('gates.md', '# Gates', 'run the check first'),
  ]
  assert.deepEqual(
    rankPages(pages, [parsePattern('check')], 3).map((hit) => hit.page.path),
    ['gates.md', 'icons.md'],
  )
})

test('among pages lacking a word, the one holding the rarer word ranks first', () => {
  const common = Array.from({ length: 5 }, (_, i) => page(`c${i}.md`, '# Page', 'the agent works'))
  const pages = [...common, page('rare.md', '# Page', 'the kit-manifest')]
  assert.equal(ranked(pages, 'agent kit-manifest')[0].path, 'rare.md')
})

test('a query word also finds its plural and -ing/-ed forms', () => {
  const pages = [page('a.md', '# A', 'one worktree, deploy, merge, branch, policy')]
  for (const word of ['worktrees', 'deploying', 'merged', 'branches', 'policies']) {
    assert.equal(ranked(pages, word).length, 1, word)
  }
})

test('a query word always finds itself as typed, whichever ending is cut', () => {
  for (const word of ['cookies', 'series', 'policies', 'worktrees', 'branches', 'boxes', 'deploying', 'merged']) {
    assert.equal(ranked([page('a.md', '# A', `about ${word} here`)], word).length, 1, word)
  }
  assert.equal(ranked([page('a.md', '# A', 'one cookie')], 'cookies').length, 1)
})

test('a word whose stem would be shorter than four letters is searched as typed', () => {
  const cases = [
    ['using', 'The user may use it.'],
    ['string', 'the structure of a stream'],
    ['during', 'for the duration'],
    ['thing', 'The end.'],
    ['speed', 'a special case'],
  ]
  for (const [word, text] of cases) {
    assert.deepEqual(ranked([page('a.md', '# A', text)], word), [], word)
  }
  assert.equal(ranked([page('a.md', '# A', 'when using it')], 'using').length, 1)
})

test('common words are dropped unless they are all there is', () => {
  assert.deepEqual(
    parseQuery('how to deploy the server').map((m) => m.label),
    ['deploy', 'server'],
  )
  assert.deepEqual(
    parseQuery('how to').map((m) => m.label),
    ['how', 'to'],
  )
})

test('a quoted phrase must appear as written, and punctuation only around a word is dropped', () => {
  assert.deepEqual(
    parseQuery('"code review" check:baseline, (docs.search)?').map((m) => m.label),
    ['code review', 'check:baseline', 'docs.search'],
  )
  const pages = [page('split.md', '# A', 'code that needs review'), page('phrase.md', '# B', 'ask for a code review')]
  assert.deepEqual(
    ranked(pages, '"code review"').map((r) => r.path),
    ['phrase.md'],
  )
})

test('a word of punctuation alone is searched as typed', () => {
  assert.deepEqual(
    parseQuery('```').map((m) => m.label),
    ['```'],
  )
  const pages = [page('fenced.md', '# A', '```sh', 'npm run fix', '```'), page('plain.md', '# B', 'no fences')]
  assert.deepEqual(
    ranked(pages, '```').map((r) => r.path),
    ['fenced.md'],
  )
})

test('query words are plain text, matched without regard to case in any script', () => {
  const pages = [page('a.md', '# A', 'call run(a.b) here', 'Основной реестр')]
  assert.equal(ranked(pages, 'RUN(A.B)').length, 1)
  assert.equal(ranked(pages, 'run(axb)').length, 0)
  assert.equal(ranked(pages, 'РЕЕСТР').length, 1)
})

test('a pattern is a case-insensitive regular expression, with a leading (?i) accepted', () => {
  const pages = [page('a.md', '# Title', '## Setup', 'text'), page('b.md', '# Other', 'no sections')]
  assert.deepEqual(
    rankPages(pages, [parsePattern('^## ')], 3).map((hit) => hit.page.path),
    ['a.md'],
  )
  assert.deepEqual(
    rankPages(pages, [parsePattern('(?i)SETUP')], 3).map((hit) => hit.page.path),
    ['a.md'],
  )
})

test('a pattern that does not compile is refused with the reason', () => {
  assert.throws(() => parsePattern('run(('), /Invalid pattern "run\(\(":/)
})

// Without the budget this pattern runs for hours; the test's own timeout turns that into a failure.
test('a pattern that backtracks without end is stopped within its time budget and refused with the reason', {
  timeout: 10_000,
}, () => {
  const pages = [page('a.md', '# A', `${'a'.repeat(33)}!`)]
  assert.throws(() => rankPages(pages, [parsePattern('(a+)+$')], 3), /Pattern "\(a\+\)\+\$" was stopped after 1000 ms/)
})

test('snippets are the lines holding the most query words, with the matched spans', () => {
  const pages = [page('a.md', '# Server', 'pull here', 'reboot here', 'pull, then reboot', 'unrelated')]
  const [hit] = rankPages(pages, parseQuery('pull reboot'), 2)
  assert.deepEqual(
    hit.snippets.map((s) => ({ line: s.line, ranges: s.ranges })),
    [
      {
        line: 4,
        ranges: [
          [0, 4],
          [11, 17],
        ],
      },
      { line: 2, ranges: [[0, 4]] },
    ],
  )
  assert.equal(hit.snippets[0].section, 'Server')
})

test('snippets show every word the page holds before showing one word twice', () => {
  const pages = [page('a.md', 'alpha one', 'alpha two', 'alpha three', 'beta')]
  const [hit] = rankPages(pages, parseQuery('alpha beta'), 2)
  assert.deepEqual(
    hit.snippets.map((s) => s.line),
    [1, 4],
  )
})

test('pages that hold none of the words are left out', () => {
  assert.deepEqual(ranked([page('a.md', '# A', 'nothing here')], 'missing'), [])
})

test('git grep output is read back into pages, line for line', () => {
  const commit = '0123abcd'
  const listing = [
    `${commit}:docs/a.md\u00001\u0000# A: title`,
    `${commit}:docs/a.md\u00002\u0000`,
    `${commit}:docs/a.md\u00003\u0000text: 12: with colons`,
    `${commit}:b.md\u00001\u0000# B`,
    '',
  ].join('\n')
  const pages = pagesFromGrep(commit, listing)
  assert.deepEqual(
    pages.map((p) => ({ path: p.path, title: p.title, lines: p.lines })),
    [
      { path: 'docs/a.md', title: 'A: title', lines: ['# A: title', '', 'text: 12: with colons'] },
      { path: 'b.md', title: 'B', lines: ['# B'] },
    ],
  )
})

test('the pages of a real git commit are read back from git grep', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-search-'))
  try {
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' })
    git('init', '-q')
    writeFileSync(join(root, 'a.md'), '# A: title\n\ntext: 12: with colons\n')
    writeFileSync(join(root, 'skip.txt'), 'not markdown\n')
    git('add', '.')
    git('commit', '-q', '-m', 'pages')
    const commit = git('rev-parse', 'HEAD').trim()
    const pages = pagesFromGrep(commit, git(...PAGES_GREP_ARGS, commit, '--', '*.md'))
    assert.deepEqual(
      pages.map((p) => ({ path: p.path, lines: p.lines })),
      [{ path: 'a.md', lines: ['# A: title', '', 'text: 12: with colons'] }],
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
