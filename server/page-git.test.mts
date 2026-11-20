import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { promisify } from 'node:util'

import { commitPage, discardPage, literalPaths } from './page-git.ts'
import type { Git } from './tree-commit.ts'

// Real git: a clone with drafts staged the way the App saves them. Each page
// has a sibling its path matches as a pattern, sorted before it, so a command
// that walks the index in order reaches the sibling first.

const run = promisify(execFile)
const roots: string[] = []

const hasGit = await run('git', ['--version']).then(
  () => true,
  () => false,
)

after(async () => {
  for (const root of roots) {
    await rm(root, { recursive: true, force: true })
  }
})

// An identity in the environment would win over the `-c user.*` options the
// commits are attributed with.
const gitEnv: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
for (const name of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) {
  delete gitEnv[name]
}

function gitIn(dir: string): Git {
  return async (...args) =>
    (
      await run(
        'git',
        ['-c', 'user.name=t', '-c', 'user.email=t@x', '-c', 'commit.gpgsign=false', '-C', dir, ...args],
        { env: gitEnv },
      )
    ).stdout
}

/** A clone whose last commit holds `files`. */
async function setup(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'page-git-'))
  roots.push(root)
  const git = gitIn(root)
  await git('init', '--quiet', '--initial-branch=main')
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
  await git('add', '-A')
  await git('commit', '--quiet', '-m', 'init')
  return { root, git }
}

/** Saves a draft the way the App does: written and staged. */
async function draft(root: string, git: Git, path: string, content: string) {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), content)
  await git('--literal-pathspecs', 'add', '--', path)
}

/** A path's index status, as `git status --porcelain` prints its two columns. */
async function statusOf(git: Git, path: string): Promise<string> {
  const entries = (await git('status', '--porcelain', '-z', '--untracked-files=all')).split('\0')
  return entries.find((entry) => entry.slice(3) === path)?.slice(0, 2) ?? '  '
}

const AUTHOR = ['-c', 'user.name=Someone', '-c', 'user.email=']

// A page, and a sibling it would name as a pattern that sorts before it.
const PAIRS = [
  { page: 'a*.md', sibling: 'a (1).md' },
  { page: 'q?.md', sibling: 'q1.md' },
  { page: 'n[1].md', sibling: 'n1.md' },
  { page: 'n[1]/intro.md', sibling: 'n1/intro.md' },
]

for (const { page, sibling } of PAIRS) {
  test(`publishing ${page} commits it alone and keeps the draft of ${sibling} staged`, {
    skip: !hasGit && 'git is not installed',
  }, async () => {
    const { root, git } = await setup({ [page]: '# Page\n', [sibling]: '# Sibling\n' })
    await draft(root, git, sibling, '# Sibling draft\n')
    await draft(root, git, page, '# Page draft\n')

    await commitPage(git, page, 'Publish the page', AUTHOR)

    assert.equal(await git('show', '--name-only', '--format=%an %s', 'HEAD'), `Someone Publish the page\n\n${page}\n`)
    assert.equal(await git('show', `HEAD:${page}`), '# Page draft\n')
    assert.equal(await git('show', `HEAD:${sibling}`), '# Sibling\n')
    assert.equal(await statusOf(git, sibling), 'M ')
    assert.equal(await readFile(join(root, sibling), 'utf-8'), '# Sibling draft\n')
  })

  test(`publishing ${page} with no change of its own refuses, though ${sibling} has a draft`, {
    skip: !hasGit && 'git is not installed',
  }, async () => {
    const { root, git } = await setup({ [page]: '# Page\n', [sibling]: '# Sibling\n' })
    await draft(root, git, sibling, '# Sibling draft\n')
    const before = await git('rev-parse', 'HEAD')

    await assert.rejects(commitPage(git, page, 'Publish the page', AUTHOR), {
      message: `Nothing to publish: ${page} has no changes.`,
    })

    assert.equal(await git('rev-parse', 'HEAD'), before)
    assert.equal(await statusOf(git, sibling), 'M ')
  })

  test(`discarding ${page} restores it and keeps the draft of ${sibling}`, {
    skip: !hasGit && 'git is not installed',
  }, async () => {
    const { root, git } = await setup({ [page]: '# Page\n', [sibling]: '# Sibling\n' })
    await draft(root, git, sibling, '# Sibling draft\n')
    await draft(root, git, page, '# Page draft\n')

    await discardPage(git, page, () => assert.fail('a committed page keeps its file'))

    assert.equal(await readFile(join(root, page), 'utf-8'), '# Page\n')
    assert.equal(await statusOf(git, page), '  ')
    assert.equal(await statusOf(git, sibling), 'M ')
    assert.equal(await readFile(join(root, sibling), 'utf-8'), '# Sibling draft\n')
  })

  test(`discarding ${page} never committed unstages it alone and keeps ${sibling} staged`, {
    skip: !hasGit && 'git is not installed',
  }, async () => {
    const { root, git } = await setup({ 'README.md': '# Readme\n' })
    await draft(root, git, sibling, '# Sibling draft\n')
    await draft(root, git, page, '# Page draft\n')
    let removed = 0

    await discardPage(git, page, async () => {
      removed++
      await rm(join(root, page))
    })

    assert.equal(removed, 1)
    assert.equal(await statusOf(git, page), '  ')
    assert.equal(await statusOf(git, sibling), 'A ')
    assert.equal(await readFile(join(root, sibling), 'utf-8'), '# Sibling draft\n')
  })
}

test('a page never committed is published', { skip: !hasGit && 'git is not installed' }, async () => {
  const { root, git } = await setup({ 'README.md': '# Readme\n' })
  await writeFile(join(root, 'new.md'), '# New\n')

  await commitPage(git, 'new.md', 'Add new', AUTHOR)

  assert.equal(await git('show', 'HEAD:new.md'), '# New\n')
  assert.equal(await statusOf(git, 'new.md'), '  ')
})

test("a page's history through literalPaths holds only the commits that changed it", {
  skip: !hasGit && 'git is not installed',
}, async () => {
  const { root, git } = await setup({ 'q?.md': '# Page\n', 'q1.md': '# Sibling\n' })
  await draft(root, git, 'q1.md', '# Sibling edited\n')
  await git('commit', '--quiet', '-m', 'Edit the sibling')

  assert.equal(await literalPaths(git)('log', '--format=%s', '--', 'q?.md'), 'init\n')
})
