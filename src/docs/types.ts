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

export type { DocSearchAnswer, DocSearchMatch, DocSearchResult } from '../../server/docs-search'

export interface NamespaceEntry {
  id: string
  namespace: string
  name: string
}
