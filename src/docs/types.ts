// Shared types for the documentation browser UI, kept local to the extension
// since the host's server types are not available here.

export type { DocEntry } from '../../server/doc-tree'

export interface TocItem {
  id: string
  text: string
  level: number
}

export interface LogEntry {
  sha: string
  message: string
  author: string
  date: string
}

export interface DocSearchMatch {
  line: number
  text: string
  heading?: string
}

export interface DocSearchResult {
  namespace: string
  path: string
  title?: string
  matches: DocSearchMatch[]
}

export interface Anchor {
  quote: string
  prefix?: string
  suffix?: string
}

export interface Comment {
  id: string
  author: string
  message: string
  timestamp: number
  anchor?: Anchor
  replies: Comment[]
}

export interface NamespaceEntry {
  id: string
  namespace: string
  name: string
}

