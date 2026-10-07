import host from '@opencroft/server'

import { docsPublishedRef, findDocNodeId, getDocsRoot, listDocNamespaces } from './docs-git'

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/

export interface DocSearchMatch {
  line: number
  text: string
  heading: string | null
}

export interface DocSearchResult {
  namespace: string
  path: string
  title: string | null
  matches: DocSearchMatch[]
}

interface RawMatch {
  line: number
  text: string
}

async function runGitGrep(root: string, ref: string, pattern: string, literal: boolean): Promise<string> {
  try {
    return await host.execFile('git', [
      '-c',
      'safe.directory=*',
      '-c',
      'core.quotePath=false',
      '-C',
      root,
      'grep',
      '-n',
      '-i',
      literal ? '-F' : '-E',
      '--',
      pattern,
      ref,
      '--',
      '*.md',
    ])
  } catch {
    // Unlike Node's util.promisify(execFile), host.execFile discards exit-code/stdout detail on a non-zero exit, so a "no matches" grep
    // exit (1, empty stdout) is indistinguishable here from a real git error. Treat any failure
    // as "no matches" — both cases resolve to an effectively empty result set.
    return ''
  }
}

async function runGitShow(root: string, ref: string, filePath: string): Promise<string> {
  try {
    return await host.execFile('git', ['-c', 'safe.directory=*', '-C', root, 'show', `${ref}:${filePath}`])
  } catch {
    return ''
  }
}

function parseGrep(stdout: string, maxResults: number): Map<string, RawMatch[]> {
  const byFile = new Map<string, RawMatch[]>()
  let total = 0
  for (const line of stdout.split('\n')) {
    if (!line) {
      continue
    }
    const m = line.match(/^[^:]+:([^:]+):(\d+):(.*)$/)
    if (!m) {
      continue
    }
    if (total >= maxResults) {
      break
    }
    const file = m[1]
    let arr = byFile.get(file)
    if (!arr) {
      arr = []
      byFile.set(file, arr)
    }
    arr.push({ line: Number(m[2]), text: m[3] })
    total += 1
  }
  return byFile
}

function extractTitle(lines: string[]): string | null {
  for (const line of lines) {
    const m = line.match(/^#\s+(.+?)\s*$/)
    if (m) {
      return m[1]
    }
  }
  return null
}

function nearestHeading(lines: string[], lineNo: number): string | null {
  for (let i = lineNo - 1; i >= 0; i--) {
    const m = lines[i]?.match(HEADING_RE)
    if (m) {
      return m[2]
    }
  }
  return null
}

async function enrichResults(
  namespace: string,
  root: string,
  ref: string,
  byFile: Map<string, RawMatch[]>,
): Promise<DocSearchResult[]> {
  const out: DocSearchResult[] = []
  for (const [file, raw] of byFile) {
    const content = await runGitShow(root, ref, file)
    const lines = content.split('\n')
    const title = extractTitle(lines)
    const matches: DocSearchMatch[] = raw.map((r) => ({
      line: r.line,
      text: r.text,
      heading: nearestHeading(lines, r.line),
    }))
    out.push({ namespace, path: file, title, matches })
  }
  return out
}

/** Convert a glob (`*` = any run of characters, `?` = one character) into an anchored, case-insensitive RegExp. */
function globToRegExp(glob: string): RegExp {
  const specialChars = /[.+^${}()|[\]\\]/g
  const escaped = glob.replace(specialChars, (c) => `\\${c}`).replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}

/**
 * Resolve a namespace argument to the list of namespace slugs to search. A plain slug (no `*`/`?`)
 * passes through unchanged, so an unknown namespace resolves to an empty result set downstream,
 * not an error here. A glob expands against every registered namespace (via
 * `listDocNamespaces`); an omitted
 * namespace behaves the same as the `*` glob and searches all of them.
 */
async function matchNamespaces(namespacePattern: string | undefined): Promise<string[]> {
  if (namespacePattern === undefined) {
    const all = await listDocNamespaces()
    return all.map((n) => n.namespace)
  }
  if (!/[*?]/.test(namespacePattern)) {
    return [namespacePattern]
  }
  const re = globToRegExp(namespacePattern)
  const all = await listDocNamespaces()
  return all.map((n) => n.namespace).filter((ns) => re.test(ns))
}

/**
 * Search the published version of a single docs namespace via `git grep`, then enrich each result
 * with the document's title (first H1) and the nearest preceding heading per match. Resolves to
 * an empty array (rather than throwing) when the namespace is unknown or has no clone yet.
 */
async function searchOneNamespace(
  namespace: string,
  pattern: string,
  maxResults: number,
  literal: boolean,
): Promise<DocSearchResult[]> {
  const nodeId = await findDocNodeId(namespace)
  const root = nodeId ? await getDocsRoot(nodeId) : null
  if (!nodeId || !root) {
    return []
  }
  // Results carry the namespace that was actually searched: `findDocNodeId`
  // treats a falsy namespace (e.g. "") as "none given" and falls back to the
  // first registered source, so the raw input could mislabel them.
  const actualNamespace = (await listDocNamespaces()).find((n) => n.id === nodeId)?.namespace ?? namespace
  const ref = await docsPublishedRef(nodeId)
  const stdout = await runGitGrep(root, ref, pattern, literal)
  const byFile = parseGrep(stdout, maxResults)
  return enrichResults(actualNamespace, root, ref, byFile)
}

/**
 * Search markdown files across the namespace(s) matching `namespacePattern`, which may be a plain
 * namespace slug, a glob (e.g. "team-*", "*") expanded against every registered namespace, or
 * omitted to search every registered namespace. `maxResults` caps the total number of matches
 * (not files) across all matched namespaces combined, consumed in `listDocNamespaces` order.
 * `pattern` is a case-insensitive extended regex, or plain text when `literal` is set.
 */
export async function searchDocs(
  namespacePattern: string | undefined,
  pattern: string,
  maxResults: number,
  { literal = false }: { literal?: boolean } = {},
): Promise<DocSearchResult[]> {
  if (!pattern.trim()) {
    return []
  }
  const namespaces = await matchNamespaces(namespacePattern)
  const out: DocSearchResult[] = []
  let remaining = maxResults
  for (const namespace of namespaces) {
    if (remaining <= 0) {
      break
    }
    const results = await searchOneNamespace(namespace, pattern, remaining, literal)
    remaining -= results.reduce((sum, r) => sum + r.matches.length, 0)
    out.push(...results)
  }
  return out
}
