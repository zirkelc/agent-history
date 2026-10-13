/** What git can do with the export folder. */
export type AgentHistoryMode = 'unset' | 'export-only' | 'commit' | 'push'

/** The export folder as the last check found it. */
export type AgentHistoryRepo = {
  exportDir: string
  isRepo: boolean
  remote?: string
  branch?: string
}

/** One step of a sync, newest last in the log. */
export type AgentHistoryLogEntry = {
  at: number
  step: 'check' | 'init' | 'export' | 'commit' | 'push'
  isOk: boolean
  message: string
}

/** What the status line and the panel show. */
export type AgentHistoryStatus = {
  mode: AgentHistoryMode
  repo?: AgentHistoryRepo
  lastExportAt?: number
  lastCommit?: { sha: string; at: number }
  lastPushAt?: number
  /** Sessions exported since the last commit. */
  pending: Array<string>
  /** Set while the last step failed or the repository has no remote; cleared by the next success. */
  warning?: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-history': {
      status: AgentHistoryStatus
      log: Array<AgentHistoryLogEntry>
    }
  }
}
