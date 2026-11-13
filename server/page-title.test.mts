import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { pageTitle, titleFromFileName, titlesAt, withTitle } from './page-title.ts'
import type { Git } from './tree-commit.ts'

const run = promisify(execFile)

const hasGit = await run('git', ['--version']).then(
  () => true,
  () => false,
)

test('the title is the level-1 heading on the first non-blank line', () => {
  assert.equal(pageTitle('# Getting started\n\nText'), 'Getting started')
  assert.equal(pageTitle('\n\n  # Spaced  #  \nText'), 'Spaced')
  assert.equal(pageTitle('# Привет, мир\r\n'), 'Привет, мир')
})

test('an empty heading is an empty title', () => {
  assert.equal(pageTitle('#\n\nText'), '')
  assert.equal(pageTitle('#   \n'), '')
  assert.equal(pageTitle('# #\n'), '')
})

test('a page that does not start with a level-1 heading has no title', () => {
  assert.equal(pageTitle('Intro\n# Later'), null)
  assert.equal(pageTitle('## Second level'), null)
  assert.equal(pageTitle('#hashtag'), null)
  assert.equal(pageTitle(''), null)
})

test('titles at a ref are read from each page’s first non-blank line', {
  skip: !hasGit && 'git is not installed',
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'page-titles-'))
  try {
    const git: Git = async (...args) =>
      (
        await run(
          'git',
          ['-c', 'user.name=t', '-c', 'user.email=t@x', '-c', 'commit.gpgsign=false', '-C', dir, ...args],
          { env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } },
        )
      ).stdout
    const pages: Record<string, string> = {
      'setup.md': 'Intro text\n\n```bash\n# install deps\n```\n',
      'guide.md': '\n\n# Guide\n\n# Later heading\n',
      'notes/Привет.md': '# Привет, мир\n',
      'untitled.md': '#\n\nText\n',
      'blank.md': '\n  \n',
      'empty.md': '',
      'second-level.md': '## Section\n# Not the title\n',
      'readme.txt': '# Not a page\n',
    }
    for (const [file, text] of Object.entries(pages)) {
      await mkdir(dirname(join(dir, file)), { recursive: true })
      await writeFile(join(dir, file), text)
    }
    await git('init', '-q', '-b', 'published')
    await git('add', '-A')
    await git('commit', '-q', '-m', 'Pages')
    // The working tree is not what is read.
    await writeFile(join(dir, 'setup.md'), '# Draft title\n')

    assert.deepEqual(Object.fromEntries([...(await titlesAt(git, 'published'))].sort()), {
      'guide.md': 'Guide',
      'notes/Привет.md': 'Привет, мир',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a title is made from a file name', () => {
  assert.equal(titleFromFileName('getting-started.md'), 'Getting started')
  assert.equal(titleFromFileName('api_v2.md'), 'Api v2')
  assert.equal(titleFromFileName('---.md'), '---.md')
})

test('a page without a title opens with one made from its file name', () => {
  assert.equal(withTitle('Body text\n', 'my-page.md'), '# My page\n\nBody text\n')
  assert.equal(withTitle('', 'my-page.md'), '# My page\n')
  assert.equal(withTitle('# Kept\n', 'my-page.md'), '# Kept\n')
  assert.equal(withTitle('#\n', 'my-page.md'), '#\n')
})
