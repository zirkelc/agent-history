import { isMetaLine } from './transcript'
import type { Filters, Line } from './transcript'

export type Format = 'jsonl' | 'markdown'

export type GitInfo = {
  repo: string
  branch?: string
  worktree: string
}

export type AgentMeta = {
  agentId: string
  agentType: string
  startedAt?: string
  updatedAt?: string
  turns: number
}

export type SessionMeta = {
  sessionId: string
  cwd?: string
  git: GitInfo | null
  startedAt?: string
  updatedAt?: string
  turns: number
  agents: Array<AgentMeta>
  export: {
    formats: Array<Format>
    filters: Filters
    exportedAt: string
  }
}

/** What the transcript itself says about its session, read from the whole, unfiltered lines. */
export type TranscriptFacts = {
  cwd?: string
  gitBranch?: string
  startedAt?: string
  updatedAt?: string
  turns: number
}

export function factsOf(lines: Array<Line>): TranscriptFacts {
  const stamped = lines.filter(line => typeof line.timestamp === 'string')
  const cwd = lines.find(line => typeof line.cwd === 'string')?.cwd
  const gitBranch = [...lines].reverse().find(line => typeof line.gitBranch === 'string' && line.gitBranch)?.gitBranch

  return {
    cwd,
    gitBranch,
    startedAt: stamped[0]?.timestamp,
    updatedAt: stamped[stamped.length - 1]?.timestamp,
    turns: lines.filter(isPromptLine).length,
  }
}

/** A turn starts with a prompt the person typed: a user message that is neither meta nor only tool results. */
function isPromptLine(line: Line): boolean {
  if (line.type !== 'user' || isMetaLine(line)) return false
  const content = line.message?.content
  if (typeof content === 'string') return content.trim().length > 0
  return Array.isArray(content) && content.some(item => item.type === 'text')
}

/** Keeps the agents an earlier export recorded and puts this one in its place, ordered by start. */
export function withAgent(agents: Array<AgentMeta>, agent: AgentMeta): Array<AgentMeta> {
  return [...agents.filter(one => one.agentId !== agent.agentId), agent].sort((a, b) =>
    (a.startedAt ?? '').localeCompare(b.startedAt ?? ''),
  )
}

/** The meta of an earlier export, or undefined when there is none or it does not parse. */
export function parseMeta(text: string | undefined): SessionMeta | undefined {
  if (text === undefined) return undefined
  try {
    const meta = JSON.parse(text) as SessionMeta
    return typeof meta.sessionId === 'string' ? meta : undefined
  } catch {
    return undefined
  }
}

export function serializeMeta(meta: SessionMeta): string {
  return JSON.stringify(meta, null, 2) + '\n'
}
