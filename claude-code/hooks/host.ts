import type { ProcessRunInit, ProcessRunResult, Timer } from 'claude-code'

import type { AgentHistoryLogEntry, AgentHistoryStatus } from '../types'

/**
 * What the export and git code needs from the engine. The hooks module builds
 * it from `$`, which the engine reads from that file's source alone; every
 * other module works against this shape and never sees `$`.
 */
export type Host = {
  run: (argv: ReadonlyArray<string>, init?: ProcessRunInit) => Promise<ProcessRunResult>
  /** A child's whole standard output, streamed, so no size limit applies. */
  runText: (argv: ReadonlyArray<string>) => Promise<string>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  exists: (path: string) => Promise<boolean>
  size: (path: string) => Promise<number>
  /** Last modification, milliseconds since the epoch. */
  mtime: (path: string) => Promise<number>
  /** The home directory, for an export folder written with `~`. */
  home: () => Promise<string | undefined>
  now: () => Promise<number>
  sleep: (ms: number) => Promise<void>
  after: (ms: number, fn: () => void) => Timer
  status: (text: string | undefined) => void
  readStatus: () => Promise<AgentHistoryStatus>
  updateStatus: (change: (value: AgentHistoryStatus) => AgentHistoryStatus) => Promise<AgentHistoryStatus>
  updateLog: (change: (list: Array<AgentHistoryLogEntry>) => Array<AgentHistoryLogEntry>) => Promise<unknown>
}
