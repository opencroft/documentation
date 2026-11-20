import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { promisify } from 'node:util'

import { commitTreeChange, type Git, type TreeChange, type WorkingFiles } from './tree-commit.ts'

// Real git: a bare remote and the instance's clone, with drafts staged in the
// clone the way the App saves them.

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

function filesIn(dir: string): WorkingFiles {
  const at = (path: string) => join(dir, path)
  const prune = async (path: string) => {
    for (let folder = dirname(path); folder !== '.' && folder !== ''; folder = dirname(folder)) {
      if ((await readdir(at(folder)).catch(() => ['?'])).length > 0) {
        return
      }
      await rmdir(at(folder))
    }
  }
  return {
    read: (path) => readFile(at(path), 'utf-8').catch(() => null),
    write: async (path, content) => {
      await mkdir(dirname(at(path)), { recursive: true })
      await writeFile(at(path), content)
    },
    remove: async (path) => {
      await rm(at(path), { force: true })
      await prune(path)
    },
    rename: async (from, to) => {
      await mkdir(dirname(at(to)), { recursive: true })
      await rename(at(from), at(to))
      await prune(from)
    },
  }
}

/** A remote holding `files`, and a clone of it. */
async function setup(files: Record<string, string | Buffer>) {
  const root = await mkdtemp(join(tmpdir(), 'tree-commit-'))
  roots.push(root)
  const remote = join(root, 'remote.git')
  const here = join(root, 'here')
  await run('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote])
  await run('git', ['clone', '--quiet', remote, here])
  const git = gitIn(here)
  await git('checkout', '--quiet', '-b', 'main')
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(here, path)), { recursive: true })
    await writeFile(join(here, path), content)
  }
  await git('add', '-A')
  await git('commit', '--quiet', '-m', 'init')
  await git('push', '--quiet', 'origin', 'main')
  const push = async () => {
    await git('push', '--quiet', 'origin', 'main')
  }
  return { root, remote, here, git, files: filesIn(here), push }
}

/** Saves a draft the way the App does: written and staged. */
async function draft(here: string, git: Git, path: string, content: string) {
  await mkdir(dirname(join(here, path)), { recursive: true })
  await writeFile(join(here, path), content)
  await git('add', '--', path)
}

function change(partial: Partial<TreeChange>): TreeChange {
  return { renames: [], removals: [], published: new Map(), drafts: new Map(), message: 'Change', ...partial }
}

const AUTHOR = ['-c', 'user.name=Someone', '-c', 'user.email=']

test('a move commits the published page at its new place and keeps every draft a draft', {
  skip: !hasGit && 'git is not installed',
}, async () => {
  const { here, git, files, push, remote } = await setup({ 'a.md': '# A\n', 'b.md': '# B\n', 'guides/c.md': '# C\n' })
  await draft(here, git, 'a.md', '# A draft\n')
  await draft(here, git, 'b.md', '# B draft\n')

  const sha = await commitTreeChange(
    git,
    files,
    change({
      renames: [{ from: 'a.md', to: 'guides/a.md' }],
      published: new Map([
        ['guides/a.md', '# A\n'],
        ['guides/_meta.json', '{"order":["a.md","c.md"]}\n'],
      ]),
      drafts: new Map([['guides/a.md', '# A draft\n']]),
      message: 'Move a.md to guides',
    }),
    AUTHOR,
    push,
  )

  assert.ok(sha)
  const remoteGit = gitIn(remote)
  assert.equal(await remoteGit('show', 'main:guides/a.md'), '# A\n')
  assert.equal(await remoteGit('show', 'main:b.md'), '# B\n')
  assert.equal(await remoteGit('show', 'main:guides/_meta.json'), '{"order":["a.md","c.md"]}\n')
  assert.equal(await remoteGit('log', '-1', '--format=%an %s', 'main'), 'Someone Move a.md to guides\n')
  await assert.rejects(remoteGit('cat-file', '-e', 'main:a.md'))
  // Both drafts are where they belong, staged, over the published pages.
  assert.equal(await readFile(join(here, 'guides/a.md'), 'utf-8'), '# A draft\n')
  assert.equal(await readFile(join(here, 'b.md'), 'utf-8'), '# B draft\n')
  assert.equal(await git('status', '--porcelain'), 'M  b.md\nM  guides/a.md\n')
})

test('a folder rename moves every file, binary ones intact, and leaves untracked files untracked', {
  skip: !hasGit && 'git is not installed',
}, async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x0a])
  const { here, git, files, push, remote } = await setup({ 'guides/a.md': '# A\n', 'guides/img/x.png': png })
  await writeFile(join(here, 'guides/scratch.md'), '# Not saved yet\n')

  await commitTreeChange(
    git,
    files,
    change({
      renames: [{ from: 'guides', to: 'manual' }],
      published: new Map([['manual/_meta.json', '{"title":"Manual"}\n']]),
    }),
    AUTHOR,
    push,
  )

  const remoteGit = gitIn(remote)
  assert.equal(
    await remoteGit('ls-tree', '-r', '--name-only', 'main'),
    'manual/_meta.json\nmanual/a.md\nmanual/img/x.png\n',
  )
  const blob = await run('git', ['-C', remote, 'cat-file', 'blob', 'main:manual/img/x.png'], { encoding: 'buffer' })
  assert.deepEqual(blob.stdout, png)
  assert.equal(await git('status', '--porcelain'), '?? manual/scratch.md\n')
  assert.deepEqual(await readdir(here).then((names) => names.filter((n) => n !== '.git').sort()), ['manual'])
})

test('a failed push leaves the clone as it was, drafts and all', {
  skip: !hasGit && 'git is not installed',
}, async () => {
  const { here, git, files, push, root, remote } = await setup({ 'a.md': '# A\n', 'b.md': '[a](a.md)\n' })
  // Someone else publishes first, so this clone's push is refused.
  const other = join(root, 'other')
  await run('git', ['clone', '--quiet', remote, other])
  await writeFile(join(other, 'z.md'), '# Z\n')
  await gitIn(other)('add', '-A')
  await gitIn(other)('commit', '--quiet', '-m', 'other')
  await gitIn(other)('push', '--quiet', 'origin', 'main')

  await draft(here, git, 'a.md', '# A draft\n')
  await draft(here, git, 'b.md', '[a](a.md) draft\n')
  const headBefore = await git('rev-parse', 'HEAD')
  const statusBefore = await git('status', '--porcelain')

  await assert.rejects(
    commitTreeChange(
      git,
      files,
      change({
        renames: [{ from: 'a.md', to: 'x/a.md' }],
        published: new Map([
          ['x/a.md', '# A\n'],
          ['b.md', '[a](x/a.md)\n'],
        ]),
        drafts: new Map([
          ['x/a.md', '# A draft\n'],
          ['b.md', '[a](x/a.md) draft\n'],
        ]),
      }),
      AUTHOR,
      push,
    ),
  )

  assert.equal(await git('rev-parse', 'HEAD'), headBefore)
  assert.equal(await git('status', '--porcelain'), statusBefore)
  assert.equal(await readFile(join(here, 'a.md'), 'utf-8'), '# A draft\n')
  assert.equal(await readFile(join(here, 'b.md'), 'utf-8'), '[a](a.md) draft\n')
  assert.equal(await git('show', ':a.md'), '# A draft\n')
  assert.deepEqual(await readdir(here).then((names) => names.filter((n) => n !== '.git').sort()), ['a.md', 'b.md'])
})

test('moving a page that exists only as a draft commits nothing', {
  skip: !hasGit && 'git is not installed',
}, async () => {
  const { here, git, files, push } = await setup({ 'a.md': '# A\n' })
  await draft(here, git, 'new.md', '# New\n')
  const headBefore = await git('rev-parse', 'HEAD')

  const sha = await commitTreeChange(
    git,
    files,
    change({ renames: [{ from: 'new.md', to: 'x/new.md' }] }),
    AUTHOR,
    push,
  )

  assert.equal(sha, null)
  assert.equal(await git('rev-parse', 'HEAD'), headBefore)
  assert.equal(await git('status', '--porcelain'), 'A  x/new.md\n')
})

test('deleting a folder commits every file in it gone with the meta, drops its drafts, and keeps other drafts', {
  skip: !hasGit && 'git is not installed',
}, async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
  const { here, git, files, push, remote } = await setup({
    '_meta.json': '{"order":["guides","b.md"]}\n',
    'b.md': '# B\n',
    'guides/_meta.json': '{"title":"Guides"}\n',
    'guides/a.md': '# A\n',
    'guides/img/x.png': png,
  })
  await draft(here, git, 'guides/a.md', '# A draft\n')
  await draft(here, git, 'guides/new.md', '# New\n')
  await writeFile(join(here, 'guides/scratch.md'), '# Not saved yet\n')
  await draft(here, git, 'b.md', '# B draft\n')

  const sha = await commitTreeChange(
    git,
    files,
    change({
      removals: ['guides'],
      published: new Map([['_meta.json', '{"order":["b.md"]}\n']]),
      message: 'Delete guides',
    }),
    AUTHOR,
    push,
  )

  assert.ok(sha)
  const remoteGit = gitIn(remote)
  assert.equal(await remoteGit('ls-tree', '-r', '--name-only', 'main'), '_meta.json\nb.md\n')
  assert.equal(await remoteGit('show', 'main:_meta.json'), '{"order":["b.md"]}\n')
  assert.equal(await remoteGit('show', 'main:b.md'), '# B\n')
  assert.equal(await remoteGit('log', '-1', '--format=%an %s', 'main'), 'Someone Delete guides\n')
  assert.equal(await git('status', '--porcelain', '--untracked-files=all'), 'M  b.md\n')
  assert.deepEqual(await readdir(here).then((names) => names.filter((n) => n !== '.git').sort()), [
    '_meta.json',
    'b.md',
  ])
})

test('a failed push leaves a deleted folder as it was: committed files byte for byte, drafts and pages never saved', {
  skip: !hasGit && 'git is not installed',
}, async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
  const { here, git, files, push, root, remote } = await setup({
    '_meta.json': '{"order":["guides","b.md"]}\n',
    'b.md': '# B\n',
    'guides/a.md': '# A\n',
    'guides/img/x.png': png,
  })
  // Someone else publishes first, so this clone's push is refused.
  const other = join(root, 'other')
  await run('git', ['clone', '--quiet', remote, other])
  await writeFile(join(other, 'z.md'), '# Z\n')
  await gitIn(other)('add', '-A')
  await gitIn(other)('commit', '--quiet', '-m', 'other')
  await gitIn(other)('push', '--quiet', 'origin', 'main')

  await draft(here, git, 'guides/a.md', '# A draft\n')
  await draft(here, git, 'guides/new.md', '# New\n')
  await writeFile(join(here, 'guides/scratch.md'), '# Not saved yet\n')
  const headBefore = await git('rev-parse', 'HEAD')
  const statusBefore = await git('status', '--porcelain', '--untracked-files=all')

  await assert.rejects(
    commitTreeChange(
      git,
      files,
      change({ removals: ['guides'], published: new Map([['_meta.json', '{"order":["b.md"]}\n']]) }),
      AUTHOR,
      push,
    ),
  )

  assert.equal(await git('rev-parse', 'HEAD'), headBefore)
  assert.equal(await git('status', '--porcelain', '--untracked-files=all'), statusBefore)
  assert.equal(await readFile(join(here, 'guides/a.md'), 'utf-8'), '# A draft\n')
  assert.equal(await git('show', ':guides/a.md'), '# A draft\n')
  assert.equal(await git('show', ':guides/new.md'), '# New\n')
  assert.equal(await readFile(join(here, 'guides/scratch.md'), 'utf-8'), '# Not saved yet\n')
  assert.deepEqual(await readFile(join(here, 'guides/img/x.png')), png)
  assert.equal(await readFile(join(here, '_meta.json'), 'utf-8'), '{"order":["guides","b.md"]}\n')
})

test('deleting a page that exists only as a draft removes it and commits nothing', {
  skip: !hasGit && 'git is not installed',
}, async () => {
  const { here, git, files, push } = await setup({ 'a.md': '# A\n' })
  await draft(here, git, 'notes/new.md', '# New\n')
  const headBefore = await git('rev-parse', 'HEAD')

  const sha = await commitTreeChange(git, files, change({ removals: ['notes/new.md'] }), AUTHOR, push)

  assert.equal(sha, null)
  assert.equal(await git('rev-parse', 'HEAD'), headBefore)
  assert.equal(await git('status', '--porcelain', '--untracked-files=all'), '')
  assert.deepEqual(await readdir(here).then((names) => names.filter((n) => n !== '.git')), ['a.md'])
})

test('deleting a folder whose name is a wildcard leaves the siblings it would match alone', {
  skip: !hasGit && 'git is not installed',
}, async () => {
  const { here, git, files, push, remote } = await setup({ 'guide*/a.md': '# A\n', 'guides/b.md': '# B\n' })
  await draft(here, git, 'guides/b.md', '# B draft\n')
  await writeFile(join(here, 'guides/new.md'), '# Not saved yet\n')

  const sha = await commitTreeChange(git, files, change({ removals: ['guide*'] }), AUTHOR, push)

  assert.ok(sha)
  assert.equal(await gitIn(remote)('ls-tree', '-r', '--name-only', 'main'), 'guides/b.md\n')
  assert.equal(await git('status', '--porcelain', '--untracked-files=all'), 'M  guides/b.md\n?? guides/new.md\n')
  assert.equal(await readFile(join(here, 'guides/new.md'), 'utf-8'), '# Not saved yet\n')
})

test('moving a folder whose name is a wildcard leaves the siblings it would match staged', {
  skip: !hasGit && 'git is not installed',
}, async () => {
  const { here, git, files, push, remote } = await setup({ 'guide*/a.md': '# A\n', 'guides/b.md': '# B\n' })
  await draft(here, git, 'guides/b.md', '# B draft\n')

  await commitTreeChange(git, files, change({ renames: [{ from: 'guide*', to: 'manual' }] }), AUTHOR, push)

  assert.equal(await gitIn(remote)('ls-tree', '-r', '--name-only', 'main'), 'guides/b.md\nmanual/a.md\n')
  assert.equal(await git('status', '--porcelain', '--untracked-files=all'), 'M  guides/b.md\n')
})
