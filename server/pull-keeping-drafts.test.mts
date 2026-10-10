import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { promisify } from 'node:util'

import { type Git, pullKeepingDrafts } from './pull-keeping-drafts.ts'

// Real git, real clones: a bare remote, the instance's clone (`here`) and a
// second clone pushing what "someone else" published.

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

function gitIn(dir: string): Git {
  return async (...args) =>
    (
      await run(
        'git',
        ['-c', 'user.name=t', '-c', 'user.email=t@x', '-c', 'commit.gpgsign=false', '-C', dir, ...args],
        {
          env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
        },
      )
    ).stdout
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'pull-keeping-drafts-'))
  roots.push(root)
  const remote = join(root, 'remote.git')
  await run('git', ['init', '--quiet', '--bare', '-b', 'main', remote])
  const seed = join(root, 'seed')
  await run('git', ['init', '--quiet', '-b', 'main', seed])
  await writeFile(join(seed, 'page.md'), 'One\n\nTwo\n')
  await writeFile(join(seed, 'other.md'), 'Other\n')
  await gitIn(seed)('add', '.')
  await gitIn(seed)('commit', '--quiet', '-m', 'init')
  await gitIn(seed)('push', '--quiet', remote, 'main')
  const here = join(root, 'here')
  const there = join(root, 'there')
  await run('git', ['clone', '--quiet', remote, here])
  await run('git', ['clone', '--quiet', remote, there])
  const git = gitIn(here)
  return {
    here,
    git,
    /** Someone else publishes `content` as `file`. */
    publishElsewhere: async (file: string, content: string) => {
      await writeFile(join(there, file), content)
      await gitIn(there)('add', file)
      await gitIn(there)('commit', '--quiet', '-m', `Update ${file}`)
      await gitIn(there)('push', '--quiet', 'origin', 'main')
    },
    /** A draft of `file` here, staged as the app saves one. */
    draft: async (file: string, content: string) => {
      await writeFile(join(here, file), content)
      await git('add', file)
    },
    read: (file: string) => readFile(join(here, file), 'utf8'),
    state: async () => ({
      head: (await git('rev-parse', 'HEAD')).trim(),
      status: await git('status', '--porcelain'),
      stashes: await git('stash', 'list'),
    }),
  }
}

test('a pull brings in what changed upstream and keeps the drafts of other pages', {
  skip: !hasGit && 'git is not installed',
}, async () => {
  const clone = await setup()
  await clone.publishElsewhere('other.md', 'Other, changed upstream\n')
  await clone.draft('page.md', 'One, drafted here\n\nTwo\n')
  await pullKeepingDrafts(clone.git, 'main')
  assert.equal(await clone.read('other.md'), 'Other, changed upstream\n')
  assert.equal(await clone.read('page.md'), 'One, drafted here\n\nTwo\n')
  const { status, stashes } = await clone.state()
  assert.match(status, /page\.md/, 'the draft is still a draft')
  assert.equal(stashes, '', 'nothing left in a stash')
})

test('a page with a draft here that changed upstream is not pulled over: nothing changes, and the page is named', {
  skip: !hasGit && 'git is not installed',
}, async () => {
  const clone = await setup()
  await clone.publishElsewhere('page.md', 'One, changed upstream\n\nTwo\n')
  await clone.draft('page.md', 'One, drafted here\n\nTwo\n')
  const before = await clone.state()
  await assert.rejects(pullKeepingDrafts(clone.git, 'main'), /page\.md/)
  assert.equal(await clone.read('page.md'), 'One, drafted here\n\nTwo\n', 'the draft is intact')
  assert.doesNotMatch(await clone.read('page.md'), /<<<<<<<|>>>>>>>/)
  const after = await clone.state()
  assert.deepEqual(after, before, 'same commit, same drafts, no stash')
  assert.equal(await clone.git('diff', '--name-only', '--diff-filter=U'), '', 'nothing unmerged')
})
