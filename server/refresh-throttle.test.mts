import assert from 'node:assert/strict'
import { test } from 'node:test'

import { throttledRefresh, waitAtMost } from './refresh-throttle.ts'

const never = () => new Promise<void>(() => {})

function recorder(outcome: (key: string) => Promise<void> = async () => {}) {
  const calls: string[] = []
  const refresh = (key: string) => {
    calls.push(key)
    return outcome(key)
  }
  return { calls, refresh }
}

test('calls while a refresh runs share it', async () => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const { calls, refresh } = recorder(() => gate)
  const refreshOf = throttledRefresh(refresh, 1000, () => 0)
  const first = refreshOf('repo-a')
  const second = refreshOf('repo-a')
  assert.equal(first, second)
  release()
  await Promise.all([first, second])
  assert.deepEqual(calls, ['repo-a'])
})

test('a call within the interval after a refresh does not refresh again, one after it does', async () => {
  let clock = 0
  const { calls, refresh } = recorder()
  const refreshOf = throttledRefresh(refresh, 1000, () => clock)
  await refreshOf('repo-a')
  clock = 999
  await refreshOf('repo-a')
  assert.deepEqual(calls, ['repo-a'])
  clock = 1000
  await refreshOf('repo-a')
  assert.deepEqual(calls, ['repo-a', 'repo-a'])
})

test('each key is throttled on its own', async () => {
  const { calls, refresh } = recorder()
  const refreshOf = throttledRefresh(refresh, 1000, () => 0)
  await refreshOf('repo-a')
  await refreshOf('repo-b')
  await refreshOf('repo-a')
  assert.deepEqual(calls, ['repo-a', 'repo-b'])
})

test('a failed refresh resolves, and is retried only after the interval', async () => {
  let clock = 0
  const { calls, refresh } = recorder(async () => {
    throw new Error('remote unreachable')
  })
  const refreshOf = throttledRefresh(refresh, 1000, () => clock)
  await refreshOf('repo-a')
  clock = 500
  await refreshOf('repo-a')
  assert.deepEqual(calls, ['repo-a'])
  clock = 1500
  await refreshOf('repo-a')
  assert.deepEqual(calls, ['repo-a', 'repo-a'])
})

test('a read bounded by waitAtMost returns while its refresh never finishes, and so does the next one', async () => {
  const { calls, refresh } = recorder(never)
  const refreshOf = throttledRefresh(refresh, 1000, () => 0)
  let reads = 0
  const read = async () => {
    await waitAtMost(refreshOf('repo-a'), 10)
    reads += 1
  }
  await read()
  await read()
  assert.equal(reads, 2)
  // The second read joined the hung refresh rather than starting another.
  assert.deepEqual(calls, ['repo-a'])
})

// A deadline far longer than the test's own timeout: if waitAtMost waited for
// it instead of for the task, the test would fail by timing out.
test('waitAtMost returns as soon as the task settles, resolved or rejected', { timeout: 5000 }, async () => {
  await waitAtMost(Promise.resolve(), 1e9)
  await waitAtMost(Promise.reject(new Error('remote unreachable')), 1e9)
})
