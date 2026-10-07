/**
 * Resolves once `task` settles or `ms` have passed, whichever comes first, and
 * never rejects. The task itself keeps running: this bounds how long a caller
 * waits for it, not how long it takes.
 */
export function waitAtMost(task: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const elapsed = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
  })
  const settled = task.then(
    () => {},
    () => {},
  )
  return Promise.race([settled, elapsed]).finally(() => clearTimeout(timer))
}

/**
 * Coalesces a refresh per key. A call while that key's refresh is running
 * waits for the running one; a call within `intervalMs` of the last one
 * finishing returns at once. A failed refresh counts as finished, so a key
 * whose refresh keeps failing is retried once per interval rather than on
 * every call. The returned promise never rejects: reporting a failure is
 * `refresh`'s own job.
 */
export function throttledRefresh(
  refresh: (key: string) => Promise<void>,
  intervalMs: number,
  now: () => number = Date.now,
): (key: string) => Promise<void> {
  const finishedAt = new Map<string, number>()
  const running = new Map<string, Promise<void>>()
  return (key) => {
    const inFlight = running.get(key)
    if (inFlight) {
      return inFlight
    }
    const last = finishedAt.get(key)
    if (last !== undefined && now() - last < intervalMs) {
      return Promise.resolve()
    }
    const run = refresh(key)
      .catch(() => {})
      .finally(() => {
        finishedAt.set(key, now())
        running.delete(key)
      })
    running.set(key, run)
    return run
  }
}
