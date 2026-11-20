import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DELETED_LINK_REASON,
  findMentions,
  linksTo,
  MENTION_REASON,
  type PathMap,
  relativePath,
  resolvePath,
  rewriteLinks,
} from './doc-links.ts'

/** `from` (a page or a folder) moves to `to`; everything else stays. */
function moving(from: string, to: string): PathMap {
  return (path) => (path === from ? to : path.startsWith(`${from}/`) ? to + path.slice(from.length) : path)
}

test('relative paths resolve inside the repository and climb out to null', () => {
  assert.equal(resolvePath('guides', '../api/intro.md'), 'api/intro.md')
  assert.equal(resolvePath('', './a/./b.md'), 'a/b.md')
  assert.equal(resolvePath('guides', '../../x.md'), null)
  assert.equal(relativePath('guides/setup', 'api/intro.md'), '../../api/intro.md')
  assert.equal(relativePath('guides', 'guides/intro.md'), 'intro.md')
  assert.equal(relativePath('guides', 'guides'), '.')
})

test('a link to a page that moves points at its new place, anchor kept', () => {
  const page = 'See [setup](guides/setup.md#install) and ![shot](guides/img/a.png).\n'
  const { text, unrewritten } = rewriteLinks(page, 'index.md', 'index.md', moving('guides', 'manual'))
  assert.equal(text, 'See [setup](manual/setup.md#install) and ![shot](manual/img/a.png).\n')
  assert.deepEqual(unrewritten, [])
})

test('a page that moves keeps its links to what stays, and to what moves with it', () => {
  const page = '[api](../api.md) [sibling](intro.md) [self](./setup.md#a)\n'
  const { text } = rewriteLinks(
    page,
    'guides/setup.md',
    'manual/deep/setup.md',
    moving('guides/setup.md', 'manual/deep/setup.md'),
  )
  assert.equal(text, '[api](../../api.md) [sibling](../../guides/intro.md) [self](./setup.md#a)\n')
})

test('links inside a moved folder between its own pages are left as written', () => {
  const page = '[b](b.md) [up](../top.md)\n'
  const { text } = rewriteLinks(page, 'guides/a.md', 'manual/a.md', moving('guides', 'manual'))
  assert.equal(text, '[b](b.md) [up](../top.md)\n')
})

test('reference definitions, angle destinations and folder links are rewritten', () => {
  const page = ['[ref]: guides/a.md "Title"', '[spaced](<guides/my page.md>)', '[folder](guides/)', ''].join('\n')
  const { text } = rewriteLinks(page, 'x.md', 'x.md', moving('guides', 'the manual'))
  assert.equal(
    text,
    ['[ref]: <the manual/a.md> "Title"', '[spaced](<the manual/my page.md>)', '[folder](<the manual/>)', ''].join('\n'),
  )
})

test('a bare destination that would hold a space is written in angle brackets', () => {
  const { text } = rewriteLinks('[a](guides/a.md)', 'x.md', 'x.md', moving('guides', 'the manual'))
  assert.equal(text, '[a](<the manual/a.md>)')
})

test('a percent-encoded destination stays encoded', () => {
  const { text } = rewriteLinks('[a](%D0%B3%D0%B0%D0%B9%D0%B4.md)', 'x.md', 'x.md', moving('гайд.md', 'новый гайд.md'))
  assert.equal(text, `[a](${encodeURIComponent('новый гайд')}.md)`)
})

test('HTML href and src are rewritten, encoded', () => {
  const page = '<a href="guides/a.md">a</a> <img src=\'guides/b.png\'>'
  const { text } = rewriteLinks(page, 'x.md', 'x.md', moving('guides', 'the manual'))
  assert.equal(text, '<a href="the%20manual/a.md">a</a> <img src=\'the%20manual/b.png\'>')
})

test('code blocks and code spans are left as written', () => {
  const page = ['```md', '[a](guides/a.md)', '```', 'Write `[a](guides/a.md)` like [this](guides/a.md).', ''].join('\n')
  const { text } = rewriteLinks(page, 'x.md', 'x.md', moving('guides', 'manual'))
  assert.equal(
    text,
    ['```md', '[a](guides/a.md)', '```', 'Write `[a](guides/a.md)` like [this](manual/a.md).', ''].join('\n'),
  )
})

test('a longer fence is closed only by a fence at least as long', () => {
  const page = ['````', '```', '[a](guides/a.md)', '````', '[b](guides/a.md)'].join('\n')
  const { text } = rewriteLinks(page, 'x.md', 'x.md', moving('guides', 'manual'))
  assert.equal(text, ['````', '```', '[a](guides/a.md)', '````', '[b](manual/a.md)'].join('\n'))
})

test('external links, anchors and links to what stays are untouched', () => {
  const page = '[w](https://example.com/guides/a.md) [m](mailto:a@b.c) [h](#top) [s](//cdn/x) [o](other.md)'
  const { text, unrewritten } = rewriteLinks(page, 'x.md', 'x.md', moving('guides', 'manual'))
  assert.equal(text, page)
  assert.deepEqual(unrewritten, [])
})

test('a link from the repository root to something that moves is reported, not rewritten', () => {
  const page = 'One\n[a](/guides/a.md) [b](/other.md)\n'
  const { text, unrewritten } = rewriteLinks(page, 'x.md', 'y/x.md', moving('guides', 'manual'))
  assert.equal(text, page)
  assert.deepEqual(unrewritten, [
    { file: 'y/x.md', line: 2, link: '/guides/a.md', reason: 'a link from the repository root is not rewritten' },
  ])
})

test('a path in backticks, plain text or an absolute address is a mention; a relative link is not', () => {
  const page = [
    'Run `guides/a.md` through the checker.',
    'See [a](guides/a.md), [b](a.md) and [web](https://example.com/docs/guides/a.md).',
    'The old guides/a.md page, the old a.md file, and guides/a.mdx is another file.',
  ].join('\n')
  assert.deepEqual(
    findMentions(page, 'x.md', ['guides/a.md', 'a.md']).map((m) => [m.line, m.link]),
    [
      [1, 'guides/a.md'],
      [2, 'guides/a.md'],
      [3, 'guides/a.md'],
      [3, 'a.md'],
    ],
  )
  assert.equal(findMentions(page, 'x.md', ['guides/a.md'])[0].reason, MENTION_REASON)
})

test("a folder's mention is its path with a slash", () => {
  assert.deepEqual(
    findMentions('Files live in `guides/` and guides/img; guidesx/ is not it.', 'x.md', ['guides/']).map((m) => m.link),
    ['guides/', 'guides/'],
  )
  assert.deepEqual(findMentions('anything', 'x.md', []), [])
})

test('links to what is deleted are found by where they lead, relative or from the root, as written', () => {
  const gone = (path: string) => path === 'guides' || path.startsWith('guides/')
  const page = [
    '[intro](../guides/intro.md#start) [api](../api/ref.md)',
    '[all](/guides/) <a href="../guides/setup%20page.md">setup</a>',
    '[ref]: ../guides/intro.md',
    '```',
    '[example](../guides/intro.md)',
    '```',
    '`[code](../guides/intro.md)` [anchor](#guides) [web](https://example.com/guides/intro.md)',
    '[near](../guides-old/x.md)',
  ].join('\n')
  assert.deepEqual(
    linksTo(page, 'notes/x.md', gone).map((link) => [link.line, link.link]),
    [
      [1, '../guides/intro.md#start'],
      [2, '/guides/'],
      [2, '../guides/setup%20page.md'],
      [3, '../guides/intro.md'],
    ],
  )
  assert.equal(linksTo(page, 'notes/x.md', gone)[0].reason, DELETED_LINK_REASON)
  assert.equal(linksTo(page, 'notes/x.md', gone)[0].file, 'notes/x.md')
})

test('a destination with balanced parentheses is read whole', () => {
  const { text } = rewriteLinks('[a](guides/a_(b).md)', 'x.md', 'x.md', moving('guides', 'manual'))
  assert.equal(text, '[a](manual/a_(b).md)')
})
